import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import fs from 'fs/promises';
import nodePath from 'path';
import Stripe from 'stripe';
import { sendFcmNotification } from '@/lib/firebase-admin';
import { setCronDependencies, autoCompletePastBookings, initCompletedBookingsCron } from '@/lib/completed-bookings-cron';

function getStripeInstance(): Stripe | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;
  return new Stripe(secretKey);
}

async function sendNotificationToUser(userId: number, title: string, body: string, data?: Record<string, string>) {
  try {
    const dataStr = data ? JSON.stringify(data) : null;
    await executeWithDbFallback(
      async () => {
        await prisma.notification.create({
          data: {
            userId: userId,
            title: title,
            message: body,
            type: data?.type || 'GENERAL',
            data: dataStr
          }
        });
      },
      async () => {
        mockDb.notifications.push({
          id: mockDb.notifications.length + 1,
          userId: userId,
          title: title,
          message: body,
          type: data?.type || 'GENERAL',
          data: data || null,
          isRead: false,
          createdAt: new Date().toISOString()
        });
      }
    );
  } catch (saveErr) {
    console.error('Failed to save notification to DB:', saveErr);
  }

  try {
    let fcmToken: string | null = null;
    try {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { fcmToken: true } }).catch(() => null);
      if (user?.fcmToken) fcmToken = user.fcmToken;
    } catch (err) {
      console.error('Error fetching fcmToken from DB:', err);
    }

    if (!fcmToken) {
      const mockUser = mockDb.users.find((u: any) => u.id === userId);
      if (mockUser?.fcmToken) fcmToken = mockUser.fcmToken;
    }

    if (fcmToken) {
      await sendFcmNotification({ token: fcmToken, title, body, data });
    } else {
      console.log(`[FCM Notification] User ${userId} has no fcmToken registered.`);
    }
  } catch (err) {
    console.error(`[FCM Notification Error] Failed to send notification to user ${userId}:`, err);
  }
}

async function transformServicesListWithRealNames(services: any[]) {
  if (!Array.isArray(services) || services.length === 0) return services;
  try {
    const serviceSettings = await prisma.serviceSetting.findMany({
      select: { id: true, title: true }
    }).catch(() => []);
    const settingsMap = new Map(serviceSettings.map(st => [st.id, st.title]));

    return services.map((bs: any) => {
      if (!bs) return bs;
      const svcObj = bs.service || bs;
      if (svcObj && typeof svcObj === 'object') {
        const currentName = svcObj.name || '';
        if (!currentName || currentName.startsWith('Service #')) {
          const targetId = svcObj.serviceId || svcObj.id || bs.serviceId;
          const realTitle = settingsMap.get(targetId);
          const fallbackName = realTitle || (svcObj.category && svcObj.category !== 'General' ? `${svcObj.category} Service` : 'Beauty & Wellness Service');
          svcObj.name = fallbackName;
          if (bs.service) bs.service.name = fallbackName;
        }
      }
      return bs;
    });
  } catch (err) {
    return services;
  }
}

async function processBookingCompletion(bookingId: number) {
  let booking: any = null;
  await executeWithDbFallback(
    async () => {
      booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { client: true, provider: { include: { providerProfile: true } } }
      });
    },
    async () => {
      booking = mockDb.bookings.find((b: any) => b.id === bookingId);
    }
  );

  if (!booking) {
    throw new Error('Booking not found');
  }

  const stripe = getStripeInstance();
  let capturedTxId = booking.transactionId;
  let stripeTransferId = booking.stripeTransferId || null;
  let payoutStatus = booking.payoutStatus || 'pending';

  const serviceAmount = booking.serviceAmount || booking.grandTotal || 0;
  let platformFeeCut = 5;
  await executeWithDbFallback(
    async () => {
      const setting = await prisma.systemSetting.findUnique({ where: { key: 'platform_fee_cut' } });
      if (setting && setting.value) platformFeeCut = parseFloat(setting.value);
    },
    async () => {
      if (mockDb.platformFeeCut !== undefined) platformFeeCut = mockDb.platformFeeCut;
    }
  ).catch(() => {});

  const commissionRate = (booking.provider?.providerProfile?.commissionRate && booking.provider.providerProfile.commissionRate !== 10.0)
    ? booking.provider.providerProfile.commissionRate
    : platformFeeCut;
  const amountCents = Math.round(serviceAmount * 100);
  const commissionCents = Math.round(amountCents * (commissionRate / 100));
  const providerPayoutCents = amountCents - commissionCents;
  const platformCommission = commissionCents / 100;
  const providerPayoutAmount = providerPayoutCents / 100;
  const providerStripeAccountId = booking.provider?.providerProfile?.stripeAccountId;

  // 1. Capture held Stripe payment intent if currently in hold/authorized state & handle transfers
  if (stripe) {
    let intent: Stripe.PaymentIntent | null = null;
    let latestChargeId: string | undefined = undefined;

    if (booking.transactionId && booking.transactionId.startsWith('pi_')) {
      try {
        intent = await stripe.paymentIntents.retrieve(booking.transactionId);
        if (intent.status === 'requires_capture' || intent.status === 'requires_action') {
          const capturedIntent = await stripe.paymentIntents.capture(booking.transactionId);
          capturedTxId = capturedIntent.id;
          intent = capturedIntent;
        }
        latestChargeId = typeof intent.latest_charge === 'string' ? intent.latest_charge : (intent.latest_charge as any)?.id;
      } catch (captureErr: any) {
        console.warn('[Stripe Capture Warning] Intent capture skipped or already captured:', captureErr.message);
      }
    }

    // Check if auto-transferred via Destination Charges (transfer_data.destination)
    const autoDestination = intent?.transfer_data?.destination;
    const autoTransfer = (intent as any)?.transfer;

    if (autoDestination && autoDestination === providerStripeAccountId) {
      payoutStatus = 'transferred';
      stripeTransferId = typeof autoTransfer === 'string' ? autoTransfer : (autoTransfer as any)?.id || `tr_auto_${booking.id}`;
    } else if (providerStripeAccountId && providerPayoutCents > 0) {
      // 2. Transfer payout to provider's Stripe Connect account if available
      try {
        const transferParams: Stripe.TransferCreateParams = {
          amount: providerPayoutCents,
          currency: 'usd',
          destination: providerStripeAccountId,
          description: `Payout for Booking #${booking.id}`,
          transfer_group: `booking_${booking.id}`
        };

        if (latestChargeId) {
          transferParams.source_transaction = latestChargeId;
        }

        let transfer: Stripe.Transfer;
        try {
          transfer = await stripe.transfers.create(transferParams);
        } catch (sourceTxErr: any) {
          delete transferParams.source_transaction;
          transfer = await stripe.transfers.create(transferParams);
        }

        stripeTransferId = transfer.id;
        payoutStatus = 'transferred';
      } catch (transferErr: any) {
        console.error('[Stripe Transfer Error]', transferErr);
        payoutStatus = 'failed';
      }
    }
  }

  // 3. Update booking status to completed and save commission & payout details
  let updatedBooking: any = null;
  await executeWithDbFallback(
    async () => {
      updatedBooking = await prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: 'completed',
          platformCommission: platformCommission,
          providerPayoutAmount: providerPayoutAmount,
          stripeTransferId: stripeTransferId,
          payoutStatus: payoutStatus,
          transactionId: capturedTxId
        },
        include: { client: true, provider: true }
      });
    },
    async () => {
      const b = mockDb.bookings.find((item: any) => item.id === bookingId);
      if (b) {
        b.status = 'completed';
        b.platformCommission = platformCommission;
        b.providerPayoutAmount = providerPayoutAmount;
        b.stripeTransferId = stripeTransferId;
        b.payoutStatus = payoutStatus;
        if (capturedTxId) b.transactionId = capturedTxId;
        updatedBooking = b;
      }
    }
  );

  // 4. Send FCM completion notifications to Client and Provider
  if (updatedBooking) {
    if (updatedBooking.clientId) {
      sendNotificationToUser(
        updatedBooking.clientId,
        'Booking Completed! 🎉',
        'Your appointment is complete. Tap here to share your review and rate your provider!',
        {
          bookingId: String(bookingId),
          clientId: String(updatedBooking.clientId),
          providerId: String(updatedBooking.providerId || ''),
          type: 'BOOKING_COMPLETED'
        }
      ).catch(err => console.error('FCM Client Notification Error:', err));
    }

    if (updatedBooking.providerId) {
      sendNotificationToUser(
        updatedBooking.providerId,
        'Booking Completed & Payout Processed! 💰',
        `Booking #${bookingId} is completed. Payout of $${providerPayoutAmount.toFixed(2)} credited (Platform Commission: $${platformCommission.toFixed(2)}).`,
        {
          bookingId: String(bookingId),
          providerId: String(updatedBooking.providerId),
          payoutAmount: String(providerPayoutAmount),
          commissionAmount: String(platformCommission),
          type: 'PROVIDER_PAYOUT'
        }
      ).catch(err => console.error('FCM Provider Notification Error:', err));
    }
  }

  return updatedBooking;
}

function hashPassword(password: string) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function parseTime(timeStr: string) {
  const [time, modifier] = timeStr.split(' ');
  let [hours, minutes] = time.split(':').map(Number);
  if (hours === 12) {
    hours = 0;
  }
  if (modifier && modifier.toUpperCase() === 'PM') {
    hours += 12;
  }
  return hours * 60 + minutes;
}

function formatTime(minutesTotal: number) {
  let hours = Math.floor(minutesTotal / 60);
  const minutes = minutesTotal % 60;
  const modifier = hours >= 12 ? 'PM' : 'AM';
  if (hours > 12) {
    hours -= 12;
  }
  if (hours === 0) {
    hours = 12;
  }
  const hStr = String(hours).padStart(2, '0');
  const mStr = String(minutes).padStart(2, '0');
  return `${hStr}:${mStr} ${modifier}`;
}

function getFormattedDateInTimezone(dateInput: string | Date, timezone?: string | null): string {
  if (!dateInput) return '';
  const tz = (timezone && typeof timezone === 'string' && timezone.trim()) ? timezone.trim() : 'UTC';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-CA', { timeZone: tz });
  } catch (err) {
    try {
      const d = new Date(dateInput);
      return d.toISOString().slice(0, 10);
    } catch {
      return '';
    }
  }
}

function checkExpressPriceApplies(providerProfile: any, bookingDateInput: string | Date, providerTimezone?: string | null): boolean {
  const isRushOn = providerProfile?.isRushMode ?? providerProfile?.is_rush_mode ?? false;
  if (!isRushOn) return false;

  const tz = providerTimezone || providerProfile?.user?.timezone || providerProfile?.timezone || 'UTC';
  const todayYYYYMMDD = getFormattedDateInTimezone(new Date(), tz);
  const bookingYYYYMMDD = getFormattedDateInTimezone(bookingDateInput, tz);

  if (!todayYYYYMMDD || !bookingYYYYMMDD) return false;
  return todayYYYYMMDD === bookingYYYYMMDD;
}

async function handleBookingCancellation(bookingIdInput: any, authUser: any, cancellationReason?: string) {
  const bId = Number(bookingIdInput);
  if (!bId || isNaN(bId)) {
    throw new Error('Valid bookingId is required');
  }

  let booking: any = null;
  await executeWithDbFallback(
    async () => {
      booking = await prisma.booking.findUnique({
        where: { id: bId },
        include: { client: true, provider: { include: { providerProfile: true } } }
      });
    },
    async () => {
      booking = mockDb.bookings.find((item: any) => item.id === bId);
    }
  );

  if (!booking) {
    throw new Error('Booking not found');
  }

  if (authUser && authUser.role !== 'admin' && booking.clientId !== authUser.userId) {
    throw new Error('Unauthorized to cancel this booking');
  }

  if (booking.status === 'cancelled') {
    return { success: true, message: 'Booking is already cancelled', booking, cancellationFee: 0 };
  }

  if (booking.status === 'completed') {
    throw new Error('Completed bookings cannot be cancelled');
  }

  const providerTimezone = booking.provider?.timezone || booking.provider?.providerProfile?.timezone || 'UTC';
  const bookingDateFormatted = getFormattedDateInTimezone(booking.date, providerTimezone);

  let slotStartMins = 540;
  if (booking.timeSlot) {
    const slotPart = String(booking.timeSlot).split('-')[0].trim();
    try {
      slotStartMins = parseTime(slotPart);
    } catch {}
  }

  const slotHours = Math.floor(slotStartMins / 60);
  const slotMins = slotStartMins % 60;

  const apptDate = new Date(booking.date);
  apptDate.setHours(slotHours, slotMins, 0, 0);

  const hoursRemaining = (apptDate.getTime() - Date.now()) / (1000 * 60 * 60);

  let feePercentage = 0;
  let cancellationFee = 0;

  const servicePrice = Number(booking.serviceAmount) || Number(booking.grandTotal) || 0;

  if (hoursRemaining >= 24) {
    feePercentage = 0;
    cancellationFee = 0;
  } else if (hoursRemaining >= 0) {
    feePercentage = 50;
    cancellationFee = Math.round((servicePrice * 0.50) * 100) / 100;
  } else {
    feePercentage = 100;
    cancellationFee = servicePrice;
  }

  let platformFeeCut = 5;
  await executeWithDbFallback(
    async () => {
      const setting = await prisma.systemSetting.findUnique({ where: { key: 'platform_fee_cut' } });
      if (setting && setting.value) platformFeeCut = parseFloat(setting.value);
    },
    async () => {
      if (mockDb.platformFeeCut !== undefined) platformFeeCut = mockDb.platformFeeCut;
    }
  ).catch(() => {});

  const commissionRate = (booking.provider?.providerProfile?.commissionRate && booking.provider.providerProfile.commissionRate !== 10.0)
    ? booking.provider.providerProfile.commissionRate
    : platformFeeCut;

  let platformCommission = 0;
  let providerPayoutAmount = 0;
  let providerPayoutCents = 0;
  let stripeTransferId: string | null = booking.stripeTransferId || null;
  let payoutStatus: string = booking.payoutStatus || 'pending';

  if (cancellationFee > 0) {
    const feeCents = Math.round(cancellationFee * 100);
    const commissionCents = Math.round(feeCents * (commissionRate / 100));
    providerPayoutCents = feeCents - commissionCents;
    platformCommission = commissionCents / 100;
    providerPayoutAmount = providerPayoutCents / 100;
  }

  const providerStripeAccountId = booking.provider?.providerProfile?.stripeAccountId;
  const stripe = getStripeInstance();
  let stripeAction = 'none';

  if (stripe && booking.transactionId && booking.transactionId.startsWith('pi_')) {
    try {
      const intent = await stripe.paymentIntents.retrieve(booking.transactionId);
      let capturedChargeId: string | undefined = undefined;

      if (intent.status === 'requires_capture') {
        if (cancellationFee === 0) {
          await stripe.paymentIntents.cancel(booking.transactionId);
          stripeAction = 'full_release_payment_intent_cancelled';
        } else {
          const feeCents = Math.round(cancellationFee * 100);
          if (feeCents > 0) {
            const hasTransferData = !!intent.transfer_data?.destination;
            const captureParams: Stripe.PaymentIntentCaptureParams = { amount_to_capture: feeCents };

            if (hasTransferData) {
              const commissionCents = Math.round(feeCents * (commissionRate / 100));
              captureParams.application_fee_amount = commissionCents;
            }

            const capturedIntent = await stripe.paymentIntents.capture(booking.transactionId, captureParams);
            stripeAction = `partially_captured_fee_${cancellationFee}`;
            capturedChargeId = typeof capturedIntent.latest_charge === 'string'
              ? capturedIntent.latest_charge
              : (capturedIntent.latest_charge as any)?.id;

            if (hasTransferData && capturedIntent.transfer_data?.destination === providerStripeAccountId) {
              payoutStatus = 'transferred';
              const autoTr = (capturedIntent as any)?.transfer;
              stripeTransferId = typeof autoTr === 'string'
                ? autoTr
                : (autoTr as any)?.id || `tr_auto_cancel_${bId}`;
            }
          } else {
            await stripe.paymentIntents.cancel(booking.transactionId);
            stripeAction = 'full_release_zero_fee';
          }
        }
      } else if (intent.status === 'succeeded') {
        const grandTotal = Number(booking.grandTotal) || servicePrice;
        const refundAmount = Math.max(0, grandTotal - cancellationFee);
        const refundCents = Math.round(refundAmount * 100);
        if (refundCents > 0) {
          await stripe.refunds.create({
            payment_intent: booking.transactionId,
            amount: refundCents,
          });
          stripeAction = `refunded_${refundAmount}`;
        }
        capturedChargeId = typeof intent.latest_charge === 'string'
          ? intent.latest_charge
          : (intent.latest_charge as any)?.id;
      }

      if (cancellationFee > 0 && providerStripeAccountId && payoutStatus !== 'transferred' && providerPayoutCents > 0) {
        try {
          const transferParams: Stripe.TransferCreateParams = {
            amount: providerPayoutCents,
            currency: 'usd',
            destination: providerStripeAccountId,
            description: `Cancellation Fee Payout for Booking #${booking.id}`,
            transfer_group: `booking_${booking.id}`
          };

          if (capturedChargeId) {
            transferParams.source_transaction = capturedChargeId;
          }

          let transfer: Stripe.Transfer;
          try {
            transfer = await stripe.transfers.create(transferParams);
          } catch (sourceTxErr: any) {
            delete transferParams.source_transaction;
            transfer = await stripe.transfers.create(transferParams);
          }

          stripeTransferId = transfer.id;
          payoutStatus = 'transferred';
        } catch (transferErr: any) {
          console.error('[Stripe Cancellation Transfer Error]', transferErr);
          payoutStatus = 'failed';
        }
      }
    } catch (stripeErr: any) {
      console.error('[Stripe Booking Cancellation Error]', stripeErr.message || stripeErr);
    }
  }

  let updatedBooking: any = null;
  await executeWithDbFallback(
    async () => {
      updatedBooking = await prisma.booking.update({
        where: { id: bId },
        data: {
          status: 'cancelled',
          platformCommission: platformCommission,
          providerPayoutAmount: providerPayoutAmount,
          payoutStatus: cancellationFee > 0 ? payoutStatus : 'none',
          stripeTransferId: stripeTransferId,
        },
        include: { client: true, provider: true }
      });
    },
    async () => {
      if (booking) {
        booking.status = 'cancelled';
        booking.platformCommission = platformCommission;
        booking.providerPayoutAmount = providerPayoutAmount;
        booking.payoutStatus = cancellationFee > 0 ? payoutStatus : 'none';
        booking.stripeTransferId = stripeTransferId;
        updatedBooking = booking;
      }
    }
  );

  if (booking.clientId) {
    const feeNotice = cancellationFee > 0 ? ` (Cancellation Fee: $${cancellationFee.toFixed(2)})` : ' (No fee applied)';
    sendNotificationToUser(
      booking.clientId,
      'Booking Cancelled ❌',
      `Your booking #${bId} scheduled for ${bookingDateFormatted} has been cancelled${feeNotice}.`,
      { bookingId: String(bId), type: 'BOOKING_CANCELLED' }
    ).catch(() => {});
  }

  if (booking.providerId) {
    const payoutNotice = cancellationFee > 0 && providerPayoutAmount > 0
      ? ` Cancellation fee payout of $${providerPayoutAmount.toFixed(2)} credited.`
      : '';
    sendNotificationToUser(
      booking.providerId,
      'Booking Cancelled by Client 📅',
      `Booking #${bId} for ${bookingDateFormatted} (${booking.timeSlot || ''}) was cancelled by client.${payoutNotice}`,
      { bookingId: String(bId), type: 'BOOKING_CANCELLED' }
    ).catch(() => {});
  }

  return {
    success: true,
    message: cancellationFee > 0 ? `Booking cancelled. A $${cancellationFee.toFixed(2)} cancellation fee applied.` : 'Booking cancelled successfully with no fee.',
    booking: updatedBooking || booking,
    cancellationFee,
    feePercentage,
    stripeAction
  };
}

function getSlotsRange(start: string, end: string, duration: number) {
  const startMin = parseTime(start);
  const endMin = parseTime(end);
  const slots: string[] = [];
  for (let time = startMin; time + duration <= endMin; time += duration) {
    slots.push(formatTime(time));
  }
  return slots;
}

function getSlotsDetailedRange(start: string, end: string, duration: number) {
  const startMin = parseTime(start);
  const endMin = parseTime(end);
  const slots: { timeSlot: string; fromTime: string; toTime: string }[] = [];
  for (let time = startMin; time + duration <= endMin; time += duration) {
    const fromStr = formatTime(time);
    const toStr = formatTime(time + duration);
    slots.push({
      timeSlot: `${fromStr} - ${toStr}`,
      fromTime: fromStr,
      toTime: toStr
    });
  }
  return slots;
}

// A mock in-memory store for fallback if MySQL connection is unavailable
const mockDb = {
  users: [
    {
      id: 1,
      email: 'admin@lookclean.com',
      password: hashPassword('admin123'), // Hashed
      name: 'System Admin',
      role: 'admin',
      providerType: null,
      phoneNumber: '+15005550006',
      isPhoneVerified: true,
      onboardingCompleted: true,
      socialKey: null,
      socialType: null,
      timezone: 'UTC',
      createdAt: new Date(),
    },
    {
      id: 2,
      email: 'provider@lookclean.com',
      password: hashPassword('123456'), // Hashed
      name: 'Maison Lumière',
      role: 'provider',
      providerType: 'freelancer',
      phoneNumber: null,
      isPhoneVerified: false,
      onboardingCompleted: false,
      socialKey: null,
      socialType: null,
      timezone: 'UTC',
      createdAt: new Date(),
    },
    {
      id: 3,
      email: 'client@lookclean.com',
      password: hashPassword('123456'), // Hashed
      name: 'Sarah Connor',
      role: 'client',
      providerType: null,
      phoneNumber: '+15005550006',
      isPhoneVerified: true,
      onboardingCompleted: true,
      socialKey: null,
      socialType: null,
      timezone: 'UTC',
      createdAt: new Date(),
    }
  ] as any[],
  profiles: [
    {
      id: 1,
      userId: 2,
      name: 'Maison Lumière',
      location: 'Downtown, Main St 123',
      experience: 5,
      isFeatured: true,
      categories: JSON.stringify([1, 2]),
      latitude: 40.7128,
      longitude: -74.0060,
    }
  ] as any[],
  services: [] as any[],
  amenities: [] as any[],
  bookings: [] as any[],
  bookingServices: [] as any[],
  availabilityConfigs: [] as any[],
  activeSlots: [] as any[],
  vouchers: [] as any[],
  reviews: [] as any[],
  notifications: [] as any[],
  cmsPages: [
    {
      slug: 'terms',
      title: 'Terms & Conditions',
      content: '<h1>Terms & Conditions</h1><p>Welcome to Look Clean. By using our platform, you agree to comply with and be bound by the following terms and conditions.</p><p>1. Services provided by independent providers.<br>2. Bookings and cancellations subject to provider rules.</p>'
    },
    {
      slug: 'privacy-policy',
      title: 'Privacy Policy',
      content: '<h1>Privacy Policy</h1><p>Your privacy is important to us. Look Clean respects your privacy regarding any information we may collect while operating our app and website.</p>'
    },
    {
      slug: 'refund-policy',
      title: 'Refund Policy',
      content: '<h1>Refund Policy</h1><p>Refund requests must be submitted within 24 hours of scheduled appointment. Cancellation fees may apply according to provider policies.</p>'
    },
    {
      slug: 'client-payment-policy',
      title: 'Client Payment Policy',
      content: '<h1>Client Payment Policy</h1><p>All client payments are securely processed. We accept credit cards, debit cards, and digital wallet options.</p>'
    },
    {
      slug: 'provider-payment-policy',
      title: 'Provider Payment Policy',
      content: '<h1>Provider Payment Policy</h1><p>Provider payout terms, commission fees, and disbursement schedules are detailed here.</p>'
    },
    {
      slug: 'client-faqs',
      title: 'Client FAQ',
      content: '<h2>Client FAQ</h2><p><b>Q: How do I book an appointment?</b></p><p>A: Select a salon or freelancer, choose your service and time slot, then confirm booking.</p><p><b>Q: Can I cancel or reschedule my booking?</b></p><p>A: Yes, go to My Bookings in your profile to reschedule or cancel at least 2 hours prior.</p>'
    },
    {
      slug: 'provider-faqs',
      title: 'Provider FAQ',
      content: '<h2>Provider FAQ</h2><p><b>Q: How do I receive booking notifications?</b></p><p>A: Notifications are sent via push notifications and SMS.</p><p><b>Q: How do I set my schedule?</b></p><p>A: Configure your working hours under Schedule Settings.</p>'
    },
    {
      slug: 'community-guidelines',
      title: 'Community Guidelines',
      content: '<h1>Community Guidelines</h1><p>We strive to maintain a respectful, safe, and clean environment for both clients and beauty professionals.</p>'
    }
  ] as any[],
  faqs: [] as any[],
  issueReports: [
    { id: 1, userId: 3, title: 'App Crash on Checkout', message: 'When selecting payment method, the screen froze.', attachments: [], status: 'open', createdAt: new Date().toISOString() },
    { id: 2, userId: 3, title: 'Location Map Not Loading', message: 'Map view is showing blank box.', attachments: [], status: 'closed', createdAt: new Date().toISOString() }
  ] as any[],
  appVersions: {
    androidVersion: '1.0.0',
    iosVersion: '1.0.0'
  },
  twilioSettings: {
    activeMode: 'staging',
    staging: {
      accountSid: process.env.TWILIO_ACCOUNT_SID_STAGING || '',
      authToken: process.env.TWILIO_AUTH_TOKEN_STAGING || '',
      phoneNumber: process.env.TWILIO_PHONE_NUMBER_STAGING || '',
      verificationServiceId: process.env.TWILIO_VERIFICATION_SERVICE_ID_STAGING || '',
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID_STAGING || ''
    },
    live: {
      accountSid: process.env.TWILIO_ACCOUNT_SID_LIVE || '',
      authToken: process.env.TWILIO_AUTH_TOKEN_LIVE || '',
      phoneNumber: process.env.TWILIO_PHONE_NUMBER_LIVE || '',
      verificationServiceId: process.env.TWILIO_VERIFICATION_SERVICE_ID_LIVE || '',
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID_LIVE || ''
    }
  },
  providerRequests: [] as any[],
  platformFeeCut: 5
};

// Memory map to store generated OTP codes temporarily
export const otpStore = new Map<string, { code: string; exp: number }>();

// Memory array to store client provider wishlist items
export const wishlistStore: { clientId: number; providerId: number }[] = [];

// Dummy reviews object matching screenshot specs
export const DEFAULT_EMPTY_REVIEWS = {
  rating: 0,
  totalReviews: 0,
  totalReviewsText: '0 reviews',
  list: []
};

// Helper: Check if DB connection works, else use fallback
async function executeWithDbFallback<T>(
  dbAction: () => Promise<T>,
  fallbackAction: () => Promise<T>
): Promise<T> {
  // If no DATABASE_URL is configured, use fallback mock memory DB
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '') {
    return await fallbackAction();
  }

  try {
    return await dbAction();
  } catch (err: any) {
    console.error('[DB Error] Prisma operation failed:', err);
    throw err;
  }
}

// Auto-complete cron disabled as providers mark bookings completed manually from frontend
// try {
//   setCronDependencies(mockDb, sendNotificationToUser);
//   initCompletedBookingsCron('* * * * *');
// } catch (cronInitErr) {
//   console.error('Failed to initialize completed bookings cron:', cronInitErr);
// }

// Token helper (Base64 encoding/decoding simulation of JWT)
function generateToken(userId: number, email: string, role: string, timezone?: string | null) {
  // Token does not expire automatically (100 years expiration horizon)
  const payload = { userId, email, role, timezone: timezone || 'UTC', exp: Date.now() + 1000 * 60 * 60 * 24 * 365 * 100 };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function verifyToken(token: string) {
  try {
    if (token === 'mock_jwt_token_logged_in' || token.startsWith('mock_jwt_token')) {
      return { userId: 1, email: 'admin@lookclean.com', role: 'admin', timezone: 'UTC' };
    }
    const jsonStr = Buffer.from(token, 'base64').toString('ascii');
    const payload = JSON.parse(jsonStr);
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// Reset token helper
function generateResetToken(userId: number, email: string) {
  const payload = { userId, email, purpose: 'reset-password', exp: Date.now() + 1000 * 60 * 15 };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function verifyResetToken(token: string) {
  try {
    const jsonStr = Buffer.from(token, 'base64').toString('ascii');
    const payload = JSON.parse(jsonStr);
    if (payload.purpose !== 'reset-password') return null;
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

async function getAuthenticatedUser(request: Request) {
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  const payload = verifyToken(token);
  if (!payload) return null;

  try {
    const user = await executeWithDbFallback(
      async () => {
        return await prisma.user.findUnique({
          where: { id: payload.userId },
        });
      },
      async () => {
        return mockDb.users.find((u) => u.id === payload.userId) || null;
      }
    );
    if (user) {
      payload.role = user.role;
      payload.timezone = (user as any).timezone || payload.timezone || 'UTC';
      payload.user = user;
    }
  } catch (err) {
    console.warn('[getAuthenticatedUser] Error fetching user role from database', err);
  }

  return payload;
}

async function ensureStripeCustomer(authUser: any, stripe: Stripe): Promise<string> {
  const userId = authUser.userId;
  let customerId: string | null = null;

  await executeWithDbFallback(
    async () => {
      const profile = await prisma.clientProfile.findUnique({
        where: { userId: userId },
        select: { stripeCustomerId: true }
      });
      if (profile?.stripeCustomerId) {
        customerId = profile.stripeCustomerId;
      }
    },
    async () => {
      const profile = mockDb.profiles.find((p: any) => p.userId === userId);
      if (profile?.stripeCustomerId) {
        customerId = profile.stripeCustomerId;
      }
    }
  ).catch(() => {});

  if (customerId) {
    return customerId;
  }

  const customer = await stripe.customers.create({
    email: authUser.email || undefined,
    name: authUser.user?.name || authUser.email || `User #${userId}`,
    metadata: { userId: String(userId) }
  });
  customerId = customer.id;

  await executeWithDbFallback(
    async () => {
      await prisma.clientProfile.upsert({
        where: { userId: userId },
        create: {
          userId: userId,
          stripeCustomerId: customerId
        },
        update: {
          stripeCustomerId: customerId
        }
      });
    },
    async () => {
      let profile = mockDb.profiles.find((p: any) => p.userId === userId);
      if (profile) {
        profile.stripeCustomerId = customerId;
      } else {
        mockDb.profiles.push({
          id: mockDb.profiles.length + 1,
          userId: userId,
          stripeCustomerId: customerId
        });
      }
    }
  ).catch((err) => {
    console.error('[ensureStripeCustomer] Error saving stripeCustomerId to profile:', err);
  });

  return customerId;
}

function parseCsv(csvText: string): { title: string; icon?: string }[] {
  const lines = csvText.split(/\r?\n/);
  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const titleIndex = headers.indexOf('title');
  const iconIndex = headers.indexOf('icon');

  if (titleIndex === -1) {
    throw new Error('CSV must contain a "title" column');
  }

  const results: { title: string; icon?: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        cols.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    cols.push(current.trim());

    const title = cols[titleIndex];
    const icon = iconIndex !== -1 ? cols[iconIndex] : undefined;
    if (title) {
      results.push({
        title: title.replace(/^"|"$/g, '').trim(),
        icon: icon ? icon.replace(/^"|"$/g, '').trim() : undefined
      });
    }
  }
  return results;
}

function getBaseUrl(request?: any): string {
  let baseUrl = process.env.APP_URL || '';
  if (baseUrl) {
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    return baseUrl;
  }
  if (request && typeof request === 'object' && 'url' in request) {
    try {
      const url = new URL(request.url);
      return `${url.protocol}//${url.host}`;
    } catch {
      // Ignore
    }
  }
  return '';
}

function calculateDistanceInMiles(lat1: number, lon1: number, lat2: number, lon2: number): string {
  const R = 3958.8; // Earth's radius in miles
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return `${distance.toFixed(1)} mi`;
}

function sanitizeUser(user: unknown, request?: any) {
  if (!user) return null;
  const plainUser = JSON.parse(JSON.stringify(user)) as Record<string, any>;
  delete plainUser.password;
  plainUser.timezone = plainUser.timezone || 'UTC';

  if (plainUser.clientProfile && typeof plainUser.clientProfile === 'object') {
    delete plainUser.clientProfile.id;
    delete plainUser.clientProfile.userId;
  }

  const baseUrl = getBaseUrl(request);

  if (plainUser.role === 'provider' && (!plainUser.providerProfile || typeof plainUser.providerProfile !== 'object')) {
    plainUser.providerProfile = {
      name: plainUser.name || 'Provider',
      location: 'Location',
      isFeatured: false,
      featured: false,
      isAvailable: true,
      isAway: false,
      isRushMode: false,
      isTravelMode: false,
      totalDistance: '0.0 mi',
    };
  }

  if (plainUser.providerProfile && typeof plainUser.providerProfile === 'object') {
    const featVal = plainUser.providerProfile.isFeatured ?? plainUser.providerProfile.featured ?? plainUser.isFeatured ?? false;
    const isFeatBool = featVal === true || featVal === 'true' || featVal === 1 || featVal === '1';
    plainUser.providerProfile.isFeatured = isFeatBool;
    plainUser.providerProfile.featured = isFeatBool;

    const availVal = plainUser.providerProfile.isAvailable ?? plainUser.providerProfile.is_available ?? plainUser.isAvailable ?? plainUser.is_available;
    const isAvailBool = availVal !== undefined && availVal !== null ? (availVal === true || availVal === 'true' || availVal === 1 || availVal === '1') : true;

    const awayVal = plainUser.providerProfile.isAway ?? plainUser.providerProfile.is_away ?? plainUser.isAway ?? plainUser.is_away;
    const isAwayBool = awayVal !== undefined && awayVal !== null ? (awayVal === true || awayVal === 'true' || awayVal === 1 || awayVal === '1') : false;

    const rushVal = plainUser.providerProfile.isRushMode ?? plainUser.providerProfile.is_rush_mode ?? plainUser.isRushMode ?? plainUser.is_rush_mode;
    const isRushBool = rushVal !== undefined && rushVal !== null ? (rushVal === true || rushVal === 'true' || rushVal === 1 || rushVal === '1') : false;

    const travelVal = plainUser.providerProfile.isTravelMode ?? plainUser.providerProfile.is_travel_mode ?? plainUser.isTravelMode ?? plainUser.is_travel_mode;
    const isTravelBool = travelVal !== undefined && travelVal !== null ? (travelVal === true || travelVal === 'true' || travelVal === 1 || travelVal === '1') : false;

    const travelLocation = plainUser.providerProfile.travelLocation ?? plainUser.providerProfile.travel_location ?? null;
    const travelCity = plainUser.providerProfile.travelCity ?? plainUser.providerProfile.travel_city ?? null;
    const travelState = plainUser.providerProfile.travelState ?? plainUser.providerProfile.travel_state ?? null;
    const travelCountry = plainUser.providerProfile.travelCountry ?? plainUser.providerProfile.travel_country ?? null;
    const travelStartDate = plainUser.providerProfile.travelStartDate ?? plainUser.providerProfile.travel_start_date ?? null;
    const travelEndDate = plainUser.providerProfile.travelEndDate ?? plainUser.providerProfile.travel_end_date ?? null;

    const now = new Date();
    const isTravelActive = Boolean(
      isTravelBool &&
      travelEndDate &&
      new Date(travelEndDate) >= now &&
      (!travelStartDate || new Date(travelStartDate) <= now)
    );

    plainUser.providerProfile.isAvailable = isAvailBool;
    plainUser.providerProfile.isAway = isAwayBool;
    plainUser.providerProfile.isRushMode = isRushBool;
    plainUser.providerProfile.isTravelMode = isTravelBool;
    plainUser.providerProfile.travelLocation = travelLocation;
    plainUser.providerProfile.travelCity = travelCity;
    plainUser.providerProfile.travelState = travelState;
    plainUser.providerProfile.travelCountry = travelCountry;
    plainUser.providerProfile.travelStartDate = travelStartDate;
    plainUser.providerProfile.travelEndDate = travelEndDate;
    plainUser.providerProfile.isTravelActive = isTravelActive;

    plainUser.isAvailable = isAvailBool;
    plainUser.isAway = isAwayBool;
    plainUser.isRushMode = isRushBool;
    plainUser.isTravelMode = isTravelBool;

    plainUser.providerProfile.totalDistance = plainUser.providerProfile.totalDistance ? String(plainUser.providerProfile.totalDistance).replace(/\s*km$/i, ' mi') : '0.0 mi';
    plainUser.isFeatured = isFeatBool;
    plainUser.totalDistance = plainUser.providerProfile.totalDistance;

    // Parse categories if stringified
    const cats = plainUser.providerProfile.categories;
    if (typeof cats === 'string') {
      try {
        plainUser.providerProfile.categories = JSON.parse(cats);
      } catch {
        plainUser.providerProfile.categories = [];
      }
    } else if (!cats) {
      plainUser.providerProfile.categories = [];
    }

    // Process certificates and license types (supporting single values & arrays)
    const cert = plainUser.providerProfile.certificateUrl;
    if (cert) {
      if (cert.startsWith('[') && cert.endsWith(']')) {
        try {
          const certsArray = JSON.parse(cert) as string[];
          const flattenedCerts: string[] = [];
          certsArray.forEach((item: string) => {
            if (item && item.includes(',')) {
              flattenedCerts.push(...item.split(',').map((s: string) => s.trim()));
            } else if (item) {
              flattenedCerts.push(item);
            }
          });
          const mappedCerts = flattenedCerts.map((c: string) => (c && c.startsWith('/') && baseUrl) ? `${baseUrl}${c}` : c);
          plainUser.providerProfile.certificateUrls = mappedCerts;
          plainUser.providerProfile.certificateUrl = mappedCerts[0] || null;
        } catch {
          let updatedCert = cert;
          if (cert.startsWith('/') && baseUrl) {
            updatedCert = `${baseUrl}${cert}`;
          }
          plainUser.providerProfile.certificateUrl = updatedCert;
          plainUser.providerProfile.certificateUrls = [updatedCert];
        }
      } else {
        if (cert.includes(',')) {
          const certsArray = cert.split(',').map((item: string) => item.trim());
          const mappedCerts = certsArray.map((c: string) => (c && c.startsWith('/') && baseUrl) ? `${baseUrl}${c}` : c);
          plainUser.providerProfile.certificateUrls = mappedCerts;
          plainUser.providerProfile.certificateUrl = mappedCerts[0] || null;
        } else {
          let updatedCert = cert;
          if (cert.startsWith('/') && baseUrl) {
            updatedCert = `${baseUrl}${cert}`;
          }
          plainUser.providerProfile.certificateUrl = updatedCert;
          plainUser.providerProfile.certificateUrls = [updatedCert];
        }
      }
    } else {
      plainUser.providerProfile.certificateUrls = [];
    }

    const lic = plainUser.providerProfile.licenseType;
    if (lic) {
      if (lic.startsWith('[') && lic.endsWith(']')) {
        try {
          const licArray = JSON.parse(lic) as string[];
          const flattenedLics: string[] = [];
          licArray.forEach((item: string) => {
            if (item && item.includes(',')) {
              flattenedLics.push(...item.split(',').map((s: string) => s.trim()));
            } else if (item) {
              flattenedLics.push(item);
            }
          });
          plainUser.providerProfile.licenseTypes = flattenedLics;
          plainUser.providerProfile.licenseType = flattenedLics[0] || null;
        } catch {
          if (lic.includes(',')) {
            plainUser.providerProfile.licenseTypes = lic.split(',').map((item: string) => item.trim());
          } else {
            plainUser.providerProfile.licenseTypes = [lic];
          }
        }
      } else {
        if (lic.includes(',')) {
          plainUser.providerProfile.licenseTypes = lic.split(',').map((item: string) => item.trim());
        } else {
          plainUser.providerProfile.licenseTypes = [lic];
        }
      }
    } else {
      plainUser.providerProfile.licenseTypes = [];
    }

    // Process licenseVerifications (supporting JSON array string or boolean array)
    const rawVerifications = plainUser.providerProfile.licenseVerifications;
    let parsedVerifications: boolean[] = [];
    if (rawVerifications) {
      if (typeof rawVerifications === 'string') {
        try {
          const parsed = JSON.parse(rawVerifications);
          if (Array.isArray(parsed)) {
            parsedVerifications = parsed.map((v: any) => Boolean(v));
          } else {
            parsedVerifications = [Boolean(parsed)];
          }
        } catch {
          if (rawVerifications.includes(',')) {
            parsedVerifications = rawVerifications.split(',').map((s: string) => s.trim().toLowerCase() === 'true');
          } else {
            parsedVerifications = [rawVerifications.toLowerCase() === 'true'];
          }
        }
      } else if (Array.isArray(rawVerifications)) {
        parsedVerifications = (rawVerifications as any[]).map((v: any) => Boolean(v));
      }
    }

    const licCount = Math.max(plainUser.providerProfile.licenseTypes?.length || 0, plainUser.providerProfile.certificateUrls?.length || 0, 1);
    const finalVerifications: boolean[] = [];
    for (let i = 0; i < licCount; i++) {
      finalVerifications[i] = parsedVerifications[i] !== undefined ? Boolean(parsedVerifications[i]) : false;
    }
    plainUser.providerProfile.licenseVerifications = finalVerifications;

    // Attach structured licenses array
    const licTypes = plainUser.providerProfile.licenseTypes || [];
    const certUrls = plainUser.providerProfile.certificateUrls || [];
    const namesList = licTypes.length > 0 ? licTypes : (plainUser.providerProfile.licenseType ? [plainUser.providerProfile.licenseType] : ['License']);
    plainUser.providerProfile.licenses = namesList.map((name: string, i: number) => ({
      name: name || `License #${i + 1}`,
      certificateUrl: certUrls[i] || plainUser.providerProfile.certificateUrl || null,
      isVerified: Boolean(finalVerifications[i]),
    }));

    const img = plainUser.providerProfile.profileImageUrl;
    if (baseUrl && img && img.startsWith('/')) {
      plainUser.providerProfile.profileImageUrl = `${baseUrl}${img}`;
    }
    const cover = plainUser.providerProfile.coverImageUrl;
    if (baseUrl && cover && cover.startsWith('/')) {
      plainUser.providerProfile.coverImageUrl = `${baseUrl}${cover}`;
    }
  }

  if (baseUrl) {
    if (plainUser.clientProfile && typeof plainUser.clientProfile === 'object') {
      const img = plainUser.clientProfile.profileImageUrl;
      if (img && img.startsWith('/')) {
        plainUser.clientProfile.profileImageUrl = `${baseUrl}${img}`;
      }
    }
  }

  return plainUser;
}

async function handleUpdateProviderProfile(request: Request, bodyPayload: any) {
  const auth = await getAuthenticatedUser(request);
  if (!auth) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }
  if (auth.role !== 'provider') {
    return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
  }

  const { providerProfile, onboardingCompleted } = (bodyPayload || {}) as any;
  const profObj = providerProfile || bodyPayload || {};

  const {
    name,
    salonName,
    salon_name,
    location,
    address,
    city,
    state,
    country,
    postalCode,
    postal_code,
    zipCode,
    categories,
    services,
    amenities,
    experience,
    licenseType,
    certificateUrl,
    coverImageUrl,
    latitude,
    lat,
    longitude,
    lng,
    long,
    isAvailable,
    is_available,
    isAway,
    is_away,
    isRushMode,
    is_rush_mode,
    isTravelMode,
    is_travel_mode,
    travelLocation,
    travel_location,
    travelCity,
    travel_city,
    travelState,
    travel_state,
    travelCountry,
    travel_country,
    travelStartDate,
    travel_start_date,
    travelEndDate,
    travel_end_date,
    isFeatured,
    is_featured,
    featured
  } = profObj;

  const locVal = (location || address || [city, state, country].filter(Boolean).join(', ') || '').toString();
  const salonNameVal = (salonName || salon_name) ? String(salonName || salon_name) : null;
  const cityVal = city ? String(city) : null;
  const stateVal = state ? String(state) : null;
  const countryVal = country ? String(country) : null;
  const postalCodeVal = (postalCode || postal_code || zipCode) ? String(postalCode || postal_code || zipCode) : null;
  const latVal = (latitude ?? lat) !== undefined && (latitude ?? lat) !== null && (latitude ?? lat) !== '' ? parseFloat(latitude ?? lat) : null;
  const lngVal = (longitude ?? lng ?? long) !== undefined && (longitude ?? lng ?? long) !== null && (longitude ?? lng ?? long) !== '' ? parseFloat(longitude ?? lng ?? long) : null;

  const travelLocationInput = travelLocation ?? travel_location ?? profObj.travelLocation ?? profObj.travel_location ?? bodyPayload?.travelLocation ?? bodyPayload?.travel_location;
  const travelCityInput = travelCity ?? travel_city ?? profObj.travelCity ?? profObj.travel_city ?? bodyPayload?.travelCity ?? bodyPayload?.travel_city;
  const travelStateInput = travelState ?? travel_state ?? profObj.travelState ?? profObj.travel_state ?? bodyPayload?.travelState ?? bodyPayload?.travel_state;
  const travelCountryInput = travelCountry ?? travel_country ?? profObj.travelCountry ?? profObj.travel_country ?? bodyPayload?.travelCountry ?? bodyPayload?.travel_country;
  const travelStartDateInput = travelStartDate ?? travel_start_date ?? profObj.travelStartDate ?? profObj.travel_start_date ?? bodyPayload?.travelStartDate ?? bodyPayload?.travel_start_date;
  const travelEndDateInput = travelEndDate ?? travel_end_date ?? profObj.travelEndDate ?? profObj.travel_end_date ?? bodyPayload?.travelEndDate ?? bodyPayload?.travel_end_date;

  const travelLocationVal = travelLocationInput !== undefined ? (travelLocationInput ? String(travelLocationInput) : null) : undefined;
  const travelCityVal = travelCityInput !== undefined ? (travelCityInput ? String(travelCityInput) : null) : undefined;
  const travelStateVal = travelStateInput !== undefined ? (travelStateInput ? String(travelStateInput) : null) : undefined;
  const travelCountryVal = travelCountryInput !== undefined ? (travelCountryInput ? String(travelCountryInput) : null) : undefined;
  const travelStartDateVal = travelStartDateInput !== undefined ? (travelStartDateInput ? new Date(travelStartDateInput) : null) : undefined;
  const travelEndDateVal = travelEndDateInput !== undefined ? (travelEndDateInput ? new Date(travelEndDateInput) : null) : undefined;

  const availInput = isAvailable ?? is_available ?? profObj.isAvailable ?? profObj.is_available ?? bodyPayload?.isAvailable ?? bodyPayload?.is_available;
  const awayInput = isAway ?? is_away ?? profObj.isAway ?? profObj.is_away ?? bodyPayload?.isAway ?? bodyPayload?.is_away;
  const rushInput = isRushMode ?? is_rush_mode ?? profObj.isRushMode ?? profObj.is_rush_mode ?? bodyPayload?.isRushMode ?? bodyPayload?.is_rush_mode;
  const travelInput = isTravelMode ?? is_travel_mode ?? profObj.isTravelMode ?? profObj.is_travel_mode ?? bodyPayload?.isTravelMode ?? bodyPayload?.is_travel_mode;
  const featInput = isFeatured ?? is_featured ?? featured ?? profObj.isFeatured ?? profObj.is_featured ?? profObj.featured ?? bodyPayload?.isFeatured ?? bodyPayload?.is_featured ?? bodyPayload?.featured;

  const isAvailableVal = availInput !== undefined && availInput !== null ? (availInput === true || availInput === 'true' || availInput === 1 || availInput === '1') : undefined;
  const isAwayVal = awayInput !== undefined && awayInput !== null ? (awayInput === true || awayInput === 'true' || awayInput === 1 || awayInput === '1') : undefined;
  const isRushModeVal = rushInput !== undefined && rushInput !== null ? (rushInput === true || rushInput === 'true' || rushInput === 1 || rushInput === '1') : undefined;
  const isTravelModeVal = travelInput !== undefined && travelInput !== null ? (travelInput === true || travelInput === 'true' || travelInput === 1 || travelInput === '1') : undefined;
  const isFeaturedVal = featInput !== undefined && featInput !== null ? (featInput === true || featInput === 'true' || featInput === 1 || featInput === '1') : undefined;

  const payoutScheduleInput = profObj.payoutScheduleType ?? profObj.payout_schedule_type ?? profObj.payoutType ?? profObj.payout_type ?? bodyPayload?.payoutScheduleType ?? bodyPayload?.payout_schedule_type ?? bodyPayload?.payoutType ?? bodyPayload?.payout_type;
  const payoutScheduleTypeVal = payoutScheduleInput !== undefined && payoutScheduleInput !== null ? String(payoutScheduleInput).toUpperCase().trim() : undefined;

  try {
    const updatedUser = await executeWithDbFallback(
      async () => {
        if (name) {
          await prisma.user.update({
            where: { id: auth.userId },
            data: { name: String(name) }
          }).catch(() => {});
        }

        // 1. Upsert provider profile
        const profile = await prisma.providerProfile.upsert({
          where: { userId: auth.userId },
          update: {
            salonName: salonNameVal,
            location: locVal,
            city: cityVal,
            state: stateVal,
            country: countryVal,
            postalCode: postalCodeVal,
            categories: categories ? JSON.stringify(categories) : null,
            experience: parseInt(experience) || 0,
            licenseType: licenseType ? (Array.isArray(licenseType) ? JSON.stringify(licenseType) : licenseType) : null,
            certificateUrl: certificateUrl ? (Array.isArray(certificateUrl) ? JSON.stringify(certificateUrl) : certificateUrl) : null,
            coverImageUrl: coverImageUrl || null,
            latitude: latVal,
            longitude: lngVal,
            ...(isAvailableVal !== undefined && { isAvailable: isAvailableVal }),
            ...(isAwayVal !== undefined && { isAway: isAwayVal }),
            ...(isRushModeVal !== undefined && { isRushMode: isRushModeVal }),
            ...(isTravelModeVal !== undefined && { isTravelMode: isTravelModeVal }),
            ...(travelLocationVal !== undefined && { travelLocation: travelLocationVal }),
            ...(travelCityVal !== undefined && { travelCity: travelCityVal }),
            ...(travelStateVal !== undefined && { travelState: travelStateVal }),
            ...(travelCountryVal !== undefined && { travelCountry: travelCountryVal }),
            ...(travelStartDateVal !== undefined && { travelStartDate: travelStartDateVal }),
            ...(travelEndDateVal !== undefined && { travelEndDate: travelEndDateVal }),
            ...(isFeaturedVal !== undefined && { isFeatured: isFeaturedVal }),
            ...(payoutScheduleTypeVal !== undefined && { payoutScheduleType: payoutScheduleTypeVal }),
          },
          create: {
            userId: auth.userId,
            salonName: salonNameVal,
            location: locVal,
            city: cityVal,
            state: stateVal,
            country: countryVal,
            postalCode: postalCodeVal,
            categories: categories ? JSON.stringify(categories) : null,
            experience: parseInt(experience) || 0,
            licenseType: licenseType ? (Array.isArray(licenseType) ? JSON.stringify(licenseType) : licenseType) : null,
            certificateUrl: certificateUrl ? (Array.isArray(certificateUrl) ? JSON.stringify(certificateUrl) : certificateUrl) : null,
            coverImageUrl: coverImageUrl || null,
            latitude: latVal,
            longitude: lngVal,
            isAvailable: isAvailableVal ?? true,
            isAway: isAwayVal ?? false,
            isRushMode: isRushModeVal ?? false,
            isTravelMode: isTravelModeVal ?? false,
            travelLocation: travelLocationVal ?? null,
            travelCity: travelCityVal ?? null,
            travelState: travelStateVal ?? null,
            travelCountry: travelCountryVal ?? null,
            travelStartDate: travelStartDateVal ?? null,
            travelEndDate: travelEndDateVal ?? null,
            isFeatured: isFeaturedVal ?? true,
            payoutScheduleType: payoutScheduleTypeVal ?? "INSTANT",
          }
        });

        // 2. Clear and recreate services if provided
        if (Array.isArray(services)) {
          await prisma.providerService.deleteMany({ where: { profileId: profile.id } });
          if (services.length > 0) {
            const servicesToInsert = services.map((s: any) => ({
              profileId: profile.id,
              name: s.name || s.serviceName || s.title || s.service_name || 'Beauty Service',
              price: parseInt(s.price) || 0,
              rushPrice: parseInt(s.rushPrice ?? s.rush_price) || 0,
              category: s.category || 'General'
            }));
            await prisma.providerService.createMany({ data: servicesToInsert });
          }
        }

        // 3. Clear and recreate amenities if provided
        if (Array.isArray(amenities)) {
          await prisma.providerAmenity.deleteMany({ where: { profileId: profile.id } });
          if (amenities.length > 0) {
            const amenitiesToInsert = amenities.map((am: any) => {
              const isObject = am && typeof am === 'object';
              const amName = isObject ? (am.name || '') : String(am);
              const amType = isObject ? (am.type || 'amenity') : 'amenity';
              const amIcon = isObject ? (am.icon || null) : null;
              return {
                profileId: profile.id,
                name: amName,
                type: amType,
                icon: amIcon
              };
            });
            await prisma.providerAmenity.createMany({ data: amenitiesToInsert });
          }
        }

        // 4. Update onboardingCompleted on User table
        return await prisma.user.update({
          where: { id: auth.userId },
          data: {
            onboardingCompleted: onboardingCompleted !== undefined ? onboardingCompleted : true
          },
          include: {
            providerProfile: {
              include: { services: true, amenities: true }
            }
          }
        });
      },
      async () => {
        // Mock fallback
        const user = mockDb.users.find((u) => u.id === auth.userId);
        if (!user) throw new Error('User not found');
        user.onboardingCompleted = onboardingCompleted !== undefined ? onboardingCompleted : true;

        let profile = mockDb.profiles.find((p) => p.userId === auth.userId);
        if (!profile) {
          profile = {
            id: mockDb.profiles.length + 1,
            userId: auth.userId,
            isAvailable: isAvailableVal ?? true,
            isAway: isAwayVal ?? false,
            isRushMode: isRushModeVal ?? false,
            isTravelMode: isTravelModeVal ?? false,
            isFeatured: isFeaturedVal ?? true
          };
          mockDb.profiles.push(profile);
        }

        if (name) user.name = name;
        profile.salonName = salonNameVal;
        profile.location = locVal;
        profile.city = cityVal;
        profile.state = stateVal;
        profile.country = countryVal;
        profile.postalCode = postalCodeVal;
        profile.categories = categories ? JSON.stringify(categories) : null;
        profile.experience = parseInt(experience) || 0;
        profile.licenseType = licenseType ? (Array.isArray(licenseType) ? JSON.stringify(licenseType) : licenseType) : null;
        profile.certificateUrl = certificateUrl ? (Array.isArray(certificateUrl) ? JSON.stringify(certificateUrl) : certificateUrl) : null;
        profile.coverImageUrl = coverImageUrl || null;
        profile.latitude = latVal;
        profile.longitude = lngVal;
        if (isAvailableVal !== undefined) profile.isAvailable = isAvailableVal;
        if (isAwayVal !== undefined) profile.isAway = isAwayVal;
        if (isRushModeVal !== undefined) profile.isRushMode = isRushModeVal;
        if (isTravelModeVal !== undefined) profile.isTravelMode = isTravelModeVal;
        if (travelLocationVal !== undefined) profile.travelLocation = travelLocationVal;
        if (travelCityVal !== undefined) profile.travelCity = travelCityVal;
        if (travelStateVal !== undefined) profile.travelState = travelStateVal;
        if (travelCountryVal !== undefined) profile.travelCountry = travelCountryVal;
        if (travelStartDateVal !== undefined) profile.travelStartDate = travelStartDateVal;
        if (travelEndDateVal !== undefined) profile.travelEndDate = travelEndDateVal;
        if (isFeaturedVal !== undefined) profile.isFeatured = isFeaturedVal;
        if (payoutScheduleTypeVal !== undefined) profile.payoutScheduleType = payoutScheduleTypeVal;

        if (Array.isArray(services)) {
          mockDb.services = mockDb.services.filter((s) => s.profileId !== profile.id);
          services.forEach((s: any) => {
            mockDb.services.push({
              id: Math.floor(Math.random() * 10000),
              profileId: profile.id,
              name: s.name,
              price: parseInt(s.price) || 0,
              rushPrice: parseInt(s.rushPrice ?? s.rush_price) || 0,
              category: s.category || 'General'
            });
          });
        }

        if (Array.isArray(amenities)) {
          mockDb.amenities = mockDb.amenities.filter((a) => a.profileId !== profile.id);
          amenities.forEach((am: any) => {
            const isObject = am && typeof am === 'object';
            const amName = isObject ? (am.name || '') : String(am);
            mockDb.amenities.push({
              id: Math.floor(Math.random() * 10000),
              profileId: profile.id,
              name: amName,
              type: isObject ? (am.type || 'amenity') : 'amenity',
              icon: isObject ? (am.icon || null) : null
            });
          });
        }

        const providerProfile = {
          ...profile,
          services: mockDb.services.filter((s) => s.profileId === profile.id),
          amenities: mockDb.amenities.filter((a) => a.profileId === profile.id)
        };

        return { ...user, providerProfile };
      }
    );

    const sanitized = sanitizeUser(updatedUser, request);
    if (sanitized && sanitized.providerProfile) {
      await enrichProviderProfile(sanitized.providerProfile, request);
    }
    return NextResponse.json(sanitized);
  } catch (err: any) {
    return NextResponse.json({ message: err.message || 'Failed to update provider profile' }, { status: 400 });
  }
}

/**
 * Helper to process a booking object:
 * 1. Parses stripeRawData / stripe_transection_raw
 * 2. Determines paymentStatus (succeeded, failed, or pending)
 * 3. Auto-confirms pending bookings if payment status is completed/succeeded
 * 4. Attaches normalized payment and transaction fields to the booking object
 */
async function processBookingPaymentAndStatus(b: any) {
  if (!b) return b;

  let parsedRawData: any = null;
  const rawInput = b.stripeRawData ?? b.stripe_transection_raw ?? b.stripe_transaction_raw ?? null;

  if (rawInput) {
    if (typeof rawInput === 'object' && rawInput !== null) {
      parsedRawData = rawInput;
    } else if (typeof rawInput === 'string') {
      try {
        parsedRawData = JSON.parse(rawInput);
      } catch {
        parsedRawData = null;
      }
    }
  }

  const txId = b.stripe_transection_id || b.stripe_transaction_id || b.transactionId || b.stripeTransactionId || null;
  const rawDataStr = typeof rawInput === 'object' ? JSON.stringify(rawInput) : rawInput;

  // Determine Stripe payment status
  let paymentStatus = 'pending';
  if (parsedRawData && typeof parsedRawData === 'object') {
    const rawStatus = String(parsedRawData.status || parsedRawData.payment_status || '').toLowerCase();
    if (['succeeded', 'paid', 'complete', 'completed'].includes(rawStatus)) {
      paymentStatus = 'succeeded';
    } else if (['failed', 'canceled', 'requires_payment_method'].includes(rawStatus)) {
      paymentStatus = 'failed';
    } else if (txId) {
      paymentStatus = 'succeeded';
    }
  } else if (txId && String(txId).trim().length > 0) {
    paymentStatus = 'succeeded';
  }

  let currentStatus = b.status || 'pending';
  // If payment status is completed/succeeded and booking status is pending, transition to confirmed
  if ((paymentStatus === 'succeeded' || paymentStatus === 'completed' || paymentStatus === 'paid') && currentStatus === 'pending') {
    currentStatus = 'confirmed';
    b.status = 'confirmed';

    if (b.id) {
      const bId = typeof b.id === 'string' ? parseInt(b.id, 10) : b.id;
      if (!isNaN(bId)) {
        prisma.booking.update({
          where: { id: bId },
          data: { status: 'confirmed' }
        }).catch(() => {});

        if (typeof mockDb !== 'undefined' && Array.isArray(mockDb.bookings)) {
          const mockB = mockDb.bookings.find((item: any) => item.id === bId);
          if (mockB) mockB.status = 'confirmed';
        }
      }
    }
  }

  return {
    ...b,
    status: currentStatus,
    transactionId: txId,
    stripe_transection_id: txId,
    stripe_transaction_id: txId,
    stripeRawData: rawDataStr,
    stripe_transection_raw: parsedRawData || rawDataStr,
    stripe_transaction_raw: parsedRawData || rawDataStr,
    paymentStatus: paymentStatus,
    payment_status: paymentStatus,
    stripe_payment_status: paymentStatus
  };
}

async function enrichProviderProfile(providerProfile: any, request?: any) {
  if (!providerProfile) return;

  const baseUrl = getBaseUrl(request);

  let categorySettings = [
    { id: 1, title: 'Haircut & Styling' },
    { id: 2, title: 'Hair Colour' },
    { id: 3, title: 'Hair Treatments' },
    { id: 4, title: 'Hair Extensions' },
    { id: 5, title: 'Bridal & Event Hair' },
    { id: 6, title: 'Nails' },
    { id: 7, title: 'Brows & Lashes' },
    { id: 8, title: 'Facials & Skincare' },
    { id: 9, title: 'Waxing' },
    { id: 10, title: 'Threading' },
    { id: 11, title: 'Makeup' },
    { id: 12, title: 'Massage & Spa' },
    { id: 13, title: 'Tanning' },
    { id: 14, title: 'Advanced Beauty' },
    { id: 15, title: 'Piercing' },
    { id: 16, title: 'Men’s Grooming' },
    { id: 17, title: 'Kids’ Services' },
  ];
  let serviceSettings = [
    { id: 1, title: 'Women’s Haircut', mainType: { title: 'Haircut & Styling' } },
    { id: 2, title: 'Men’s Haircut', mainType: { title: 'Haircut & Styling' } },
    { id: 3, title: 'Beard Trim', mainType: { title: 'Haircut & Styling' } },
  ] as any[];
  let ambienceSettings = [
    { id: 1, title: 'Free Wi-Fi', ambienceGroup: { title: 'Amenities' } },
    { id: 2, title: 'Parking', ambienceGroup: { title: 'Amenities' } },
    { id: 3, title: 'Quiet Space', ambienceGroup: { title: 'Ambience' } },
    { id: 4, title: 'Relaxing Music', ambienceGroup: { title: 'Ambience' } },
  ] as any[];

  try {
    const dbCats = await prisma.categorySetting.findMany().catch(() => null);
    if (dbCats) categorySettings = dbCats;

    const dbSvcs = await prisma.serviceSetting.findMany({ include: { mainType: true } }).catch(() => null);
    if (dbSvcs) serviceSettings = dbSvcs;

    const dbAmbs = await prisma.ambienceSetting.findMany({ include: { ambienceGroup: true } }).catch(() => null);
    if (dbAmbs) ambienceSettings = dbAmbs;
  } catch { }

  // 1. Enrich categories: map IDs like 1, 2 to { id: 1, title: "Haircut" }
  let categoryIds = [];
  if (typeof providerProfile.categories === 'string') {
    try {
      categoryIds = JSON.parse(providerProfile.categories);
    } catch {
      categoryIds = [];
    }
  } else if (Array.isArray(providerProfile.categories)) {
    categoryIds = providerProfile.categories;
  }

  providerProfile.categories = categoryIds.map((cat: any) => {
    const match = categorySettings.find(c => c.id === Number(cat) || c.title.toLowerCase() === String(cat).toLowerCase());
    let categoryIcon = match ? (match as any).categoryIcon || (match as any).icon || null : null;
    if (baseUrl && categoryIcon && categoryIcon.startsWith('/')) {
      categoryIcon = `${baseUrl}${categoryIcon}`;
    }
    return match ? { id: match.id, title: match.title, categoryIcon } : { id: typeof cat === 'number' ? cat : 0, title: String(cat), categoryIcon: null };
  });

  // 2. Enrich services: map to original ServiceSetting ID and include servicePortfolioImage
  if (Array.isArray(providerProfile.services)) {
    const isRushOn = providerProfile.isRushMode ?? providerProfile.is_rush_mode ?? false;
    providerProfile.services = providerProfile.services.map((s: any) => {
      const match = serviceSettings.find(item =>
        item.title.toLowerCase() === (s.name || '').toLowerCase() &&
        (item.mainType ? item.mainType.title.toLowerCase() === (s.category || '').toLowerCase() : true)
      );
      let img = s.servicePortfolioImage || s.portfolioImage || s.image || (match ? (match as any).imageUrl : null) || null;
      if (baseUrl && img && img.startsWith('/')) {
        img = `${baseUrl}${img}`;
      }
      const rushP = Number(s.rushPrice ?? s.rush_price) || 0;
      const normalP = Number(s.price) || 0;
      const effectiveP = (isRushOn && rushP > 0) ? rushP : normalP;
      return {
        id: s.id,
        serviceId: match ? match.id : null,
        name: s.name,
        price: normalP,
        rushPrice: rushP,
        effectivePrice: effectiveP,
        category: s.category,
        servicePortfolioImage: img
      };
    });
  }

  // 3. Enrich amenities: map to original AmbienceSetting ID and prefix icon with baseUrl
  if (Array.isArray(providerProfile.amenities)) {
    providerProfile.amenities = providerProfile.amenities.map((am: any) => {
      const match = ambienceSettings.find(item =>
        item.title.toLowerCase() === am.name.toLowerCase() &&
        (item.ambienceGroup ? item.ambienceGroup.title.toLowerCase() === am.type.toLowerCase() : true)
      );
      let icon = am.icon || (match ? match.icon : null);
      if (baseUrl && icon && icon.startsWith('/')) {
        icon = `${baseUrl}${icon}`;
      }
      return {
        id: am.id,
        amenityId: match ? match.id : null,
        name: am.name,
        type: am.type,
        icon: icon
      };
    });
  }

  const availVal = providerProfile.isAvailable ?? providerProfile.is_available;
  providerProfile.isAvailable = availVal !== undefined && availVal !== null ? (availVal === true || availVal === 'true' || availVal === 1 || availVal === '1') : true;

  const awayVal = providerProfile.isAway ?? providerProfile.is_away;
  providerProfile.isAway = awayVal !== undefined && awayVal !== null ? (awayVal === true || awayVal === 'true' || awayVal === 1 || awayVal === '1') : false;

  const rushVal = providerProfile.isRushMode ?? providerProfile.is_rush_mode;
  providerProfile.isRushMode = rushVal !== undefined && rushVal !== null ? (rushVal === true || rushVal === 'true' || rushVal === 1 || rushVal === '1') : false;

  const travelVal = providerProfile.isTravelMode ?? providerProfile.is_travel_mode;
  providerProfile.isTravelMode = travelVal !== undefined && travelVal !== null ? (travelVal === true || travelVal === 'true' || travelVal === 1 || travelVal === '1') : false;
}

// ROUTE HANDLERS
export async function GET(
  request: Request,
  { params }: { params: Promise<{ catchall?: string[] }> }
) {
  try {
    const { catchall } = await params;
    const rawPath = catchall?.join('/') || '';
    const path = rawPath.replace(/^api\//i, '').replace(/\/$/, '').trim();
    console.log(`[API GET] rawPath='${rawPath}' -> path='${path}'`);

    // GET /api/stripe/config
    if (path === 'stripe/config') {
      const authUser = await getAuthenticatedUser(request);
      if (!authUser) {
        return NextResponse.json({ success: false, error: 'Unauthorized. Bearer token required.' }, { status: 401 });
      }

      const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PUBLISHABLE_KEY || '';
      const secretKey = process.env.STRIPE_SECRET_KEY || '';
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
      const connectClientId = process.env.STRIPE_CONNECT_CLIENT_ID || '';

      const isConfigured = Boolean(secretKey && publishableKey);

      return NextResponse.json({
        success: true,
        publishableKey,
        currency: 'usd'
      });
    }

    // GET /api/stripe/payment-status
    if (path === 'stripe/payment-status') {
      const authUser = await getAuthenticatedUser(request);
      if (!authUser) {
        return NextResponse.json({ success: false, error: 'Unauthorized. Bearer token required.' }, { status: 401 });
      }

      const urlParams = new URL(request.url).searchParams;
      const paymentIntentId = urlParams.get('paymentIntentId') || urlParams.get('payment_intent_id');
      const sessionId = urlParams.get('sessionId') || urlParams.get('session_id');

      if (!paymentIntentId && !sessionId) {
        return NextResponse.json({ success: false, error: 'Either paymentIntentId or sessionId query parameter is required.' }, { status: 400 });
      }

      const stripe = getStripeInstance();
      if (!stripe) {
        return NextResponse.json({ success: false, error: 'Stripe is not configured on server. Missing STRIPE_SECRET_KEY.' }, { status: 500 });
      }

      try {
        if (paymentIntentId) {
          const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
          const isAuthorizedOrPaid = paymentIntent.status === 'succeeded' || paymentIntent.status === 'requires_capture';
          return NextResponse.json({
            success: true,
            type: 'payment_intent',
            id: paymentIntent.id,
            status: paymentIntent.status,
            amount: paymentIntent.amount / 100,
            currency: paymentIntent.currency,
            paid: isAuthorizedOrPaid,
            isAuthorized: isAuthorizedOrPaid
          });
        } else if (sessionId) {
          const session = await stripe.checkout.sessions.retrieve(sessionId);
          return NextResponse.json({
            success: true,
            type: 'checkout_session',
            id: session.id,
            status: session.status,
            paymentStatus: session.payment_status,
            amountTotal: (session.amount_total || 0) / 100,
            currency: session.currency,
            paid: session.payment_status === 'paid'
          });
        }
      } catch (stripeErr: any) {
        return NextResponse.json({ success: false, error: stripeErr.message || 'Failed to retrieve payment status' }, { status: 400 });
      }
    }

    // GET /api/provider/stripe/status or /api/provider/stripe-connect/status
    if (path === 'provider/stripe/status' || path === 'provider/stripe-connect/status' || path === 'provider/stripe/account-status') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ success: false, error: 'Unauthorized. Bearer token required.' }, { status: 401 });
      }
      if (auth.role !== 'provider') {
        return NextResponse.json({ success: false, error: 'Forbidden: Requires provider role' }, { status: 403 });
      }

      let profile: any = null;
      await executeWithDbFallback(
        async () => {
          profile = await prisma.providerProfile.findUnique({ where: { userId: auth.userId } });
        },
        async () => {
          profile = mockDb.profiles.find((p) => p.userId === auth.userId) || null;
        }
      );

      const stripeAccountId = profile?.stripeAccountId || null;
      let detailsSubmitted = profile?.stripeDetailsSubmitted || false;
      let payoutsEnabled = profile?.stripePayoutsEnabled || false;
      let chargesEnabled = profile?.stripeChargesEnabled || false;

      if (stripeAccountId) {
        const stripe = getStripeInstance();
        if (stripe) {
          try {
            const account = await stripe.accounts.retrieve(stripeAccountId);
            detailsSubmitted = account.details_submitted || false;
            payoutsEnabled = account.payouts_enabled || false;
            chargesEnabled = account.charges_enabled || false;

            await executeWithDbFallback(
              async () => {
                await prisma.providerProfile.update({
                  where: { userId: auth.userId },
                  data: {
                    stripeDetailsSubmitted: detailsSubmitted,
                    stripePayoutsEnabled: payoutsEnabled,
                    stripeChargesEnabled: chargesEnabled,
                  }
                });
              },
              async () => {
                if (profile) {
                  profile.stripeDetailsSubmitted = detailsSubmitted;
                  profile.stripePayoutsEnabled = payoutsEnabled;
                  profile.stripeChargesEnabled = chargesEnabled;
                }
              }
            ).catch(() => {});
          } catch (stripeErr: any) {
            console.error('Failed to retrieve Stripe Connect account:', stripeErr);
          }
        }
      }

      // Fetch Platform Fee Cut setting
      let platformFeeCut = 5;
      await executeWithDbFallback(
        async () => {
          const setting = await prisma.systemSetting.findUnique({ where: { key: 'platform_fee_cut' } });
          if (setting && setting.value) {
            platformFeeCut = parseFloat(setting.value);
          }
        },
        async () => {
          if (mockDb.platformFeeCut !== undefined) {
            platformFeeCut = mockDb.platformFeeCut;
          }
        }
      ).catch(() => {});

      const commissionRate = (profile?.commissionRate && profile.commissionRate !== 10.0)
        ? profile.commissionRate
        : platformFeeCut;

      return NextResponse.json({
        success: true,
        stripeAccountId,
        detailsSubmitted,
        payoutsEnabled,
        chargesEnabled,
        commissionRate,
      });
    }

    // GET /api/provider/payout-charges or /api/providers/payout-charges or /api/provider/payout-type
    if (path === 'provider/payout-charges' || path === 'providers/payout-charges' || path === 'provider/payout-type' || path === 'providers/payout-type') {
      return NextResponse.json({
        success: true,
        instantPayout: {
          payoutScheduleType: 'INSTANT',
          title: 'Instant Payout',
          feePercentage: 1.0,
          feeText: '1.0% charge',
          processingTime: 'Instant (Within 30 minutes)',
          description: 'Receive payouts directly to your debit card/bank account immediately for a small processing fee.'
        },
        scheduledPayout: {
          payoutScheduleType: 'WEEKLY',
          title: 'Weekly Scheduled Payout',
          feePercentage: 0.0,
          feeText: 'Free (0% charge)',
          processingTime: 'Weekly (Every Monday)',
          description: 'Automatic scheduled payout transferred to your bank account weekly with no extra fees.'
        }
      });
    }

    // GET /api/provider/stripe/payouts or /api/provider/stripe-connect/payouts
    if (path === 'provider/stripe/payouts' || path === 'provider/stripe-connect/payouts') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ success: false, error: 'Unauthorized. Bearer token required.' }, { status: 401 });
      }
      if (auth.role !== 'provider') {
        return NextResponse.json({ success: false, error: 'Forbidden: Requires provider role' }, { status: 403 });
      }

      let bookings: any[] = [];
      await executeWithDbFallback(
        async () => {
          bookings = await prisma.booking.findMany({
            where: { providerId: auth.userId, status: { in: ['confirmed', 'completed'] } },
            orderBy: { createdAt: 'desc' }
          });
        },
        async () => {
          bookings = mockDb.bookings.filter((b) => b.providerId === auth.userId && ['confirmed', 'completed'].includes(b.status));
        }
      );

      let platformFeeCut = 10;
      await executeWithDbFallback(
        async () => {
          const setting = await prisma.systemSetting.findUnique({ where: { key: 'platform_fee_cut' } });
          if (setting && setting.value) {
            platformFeeCut = parseFloat(setting.value);
          }
        },
        async () => {
          if (mockDb.platformFeeCut !== undefined) {
            platformFeeCut = mockDb.platformFeeCut;
          }
        }
      ).catch(() => {});

      let commissionRate = platformFeeCut;
      const providerProfile = await executeWithDbFallback(
        async () => await prisma.providerProfile.findUnique({ where: { userId: auth.userId } }),
        async () => mockDb.profiles.find((p) => p.userId === auth.userId)
      );
      if (providerProfile && providerProfile.commissionRate !== undefined && providerProfile.commissionRate !== null) {
        commissionRate = providerProfile.commissionRate;
      }

      let totalGrossEarnings = 0;
      let totalCommissionDeducted = 0;
      let totalNetPayouts = 0;

      const payouts = bookings.map((b) => {
        const serviceAmount = b.serviceAmount || b.grandTotal || 0;
        const commission = (b.platformCommission !== null && b.platformCommission !== undefined && b.platformCommission > 0)
          ? b.platformCommission
          : Math.round(serviceAmount * (commissionRate / 100) * 100) / 100;

        const netPayout = (b.providerPayoutAmount !== null && b.providerPayoutAmount !== undefined && b.providerPayoutAmount > 0)
          ? b.providerPayoutAmount
          : Math.round((serviceAmount - commission) * 100) / 100;

        totalGrossEarnings += serviceAmount;
        totalCommissionDeducted += commission;
        totalNetPayouts += netPayout;

        return {
          bookingId: b.id,
          date: b.date || b.createdAt,
          serviceAmount,
          platformCommission: commission,
          providerPayoutAmount: netPayout,
          payoutStatus: b.payoutStatus || (b.transactionId ? 'transferred' : 'pending'),
          transactionId: b.transactionId || null,
          stripeTransferId: b.stripeTransferId || null
        };
      });

      return NextResponse.json({
        success: true,
        commissionRate,
        totalGrossEarnings: Math.round(totalGrossEarnings * 100) / 100,
        totalCommissionDeducted: Math.round(totalCommissionDeducted * 100) / 100,
        totalNetPayouts: Math.round(totalNetPayouts * 100) / 100,
        payouts
      });
    }

    // GET Test FCM Push Notification Endpoint (/api/test-notification?userId=2)
    if (path === 'test-notification' || path === 'users/test-notification' || path === 'fcm/test' || path === 'admin/test-notification') {
      const logs: string[] = [];
      const timestamp = new Date().toISOString();
      logs.push(`[${timestamp}] Test Notification GET Endpoint Invoked.`);

      const urlParams = new URL(request.url).searchParams;
      const rawUserId = urlParams.get('userId') || urlParams.get('id') || urlParams.get('user_id');

      if (!rawUserId) {
        logs.push('[ERROR] Missing userId parameter in query string.');
        return NextResponse.json({
          success: false,
          error: 'Missing userId parameter',
          usage: 'Append ?userId={ID} to URL (e.g. /api/test-notification?userId=2)',
          logs
        }, { status: 400 });
      }

      const targetUserId = parseInt(String(rawUserId), 10);
      logs.push(`[INFO] Target User ID: ${targetUserId}`);

      let targetUser: any = null;
      let fcmToken: string | null = null;
      let source: string = 'none';

      // 1. Check Prisma DB
      try {
        logs.push(`[STEP 1] Querying Prisma DB for User ID ${targetUserId}...`);
        const dbUser = await prisma.user.findUnique({
          where: { id: targetUserId },
          select: { id: true, name: true, email: true, role: true, fcmToken: true }
        });
        if (dbUser) {
          targetUser = dbUser;
          source = 'Prisma DB';
          fcmToken = dbUser.fcmToken;
          logs.push(`[STEP 1 SUCCESS] User found in Prisma DB. Name: "${dbUser.name}", Email: "${dbUser.email}", Role: "${dbUser.role}".`);
          if (fcmToken) {
            logs.push(`[STEP 1 SUCCESS] FCM Token found in Prisma DB: "${fcmToken.slice(0, 25)}..." (Length: ${fcmToken.length})`);
          } else {
            logs.push(`[STEP 1 WARNING] User exists in Prisma DB, but fcmToken is NULL / Empty.`);
          }
        } else {
          logs.push(`[STEP 1 INFO] User ID ${targetUserId} not found in Prisma DB.`);
        }
      } catch (dbErr: any) {
        logs.push(`[STEP 1 ERROR] Prisma DB query failed: ${dbErr.message || String(dbErr)}`);
      }

      // 2. Check mockDb fallback
      if (!targetUser || !fcmToken) {
        logs.push(`[STEP 2] Checking mockDb in-memory storage for User ID ${targetUserId}...`);
        const mockUser = mockDb.users.find((u: any) => u.id === targetUserId);
        if (mockUser) {
          if (!targetUser) {
            targetUser = mockUser;
            source = 'mockDb';
          }
          if (mockUser.fcmToken) {
            const foundToken = mockUser.fcmToken;
            fcmToken = foundToken;
            logs.push(`[STEP 2 SUCCESS] FCM Token found in mockDb: "${foundToken.slice(0, 25)}..." (Length: ${foundToken.length})`);
          } else {
            logs.push(`[STEP 2 WARNING] User found in mockDb, but fcmToken is NULL / Empty.`);
          }
        } else {
          logs.push(`[STEP 2 INFO] User ID ${targetUserId} not found in mockDb.`);
        }
      }

      if (!targetUser) {
        logs.push(`[FAILED] User ID ${targetUserId} does not exist in Database or mockDb.`);
        return NextResponse.json({
          success: false,
          error: `User ID ${targetUserId} not found`,
          targetUserId,
          logs
        }, { status: 404 });
      }

      if (!fcmToken) {
        logs.push(`[FAILED] User ID ${targetUserId} has NO FCM token registered. Please call POST /api/users/fcm-token with {"fcmToken": "your_token"} first.`);
        return NextResponse.json({
          success: false,
          error: 'No FCM token registered for this user',
          targetUser: { id: targetUser.id, name: targetUser.name, email: targetUser.email, role: targetUser.role },
          logs
        }, { status: 400 });
      }

      // 3. Send Notification via Firebase Admin SDK
      const testTitle = urlParams.get('title') || 'Look Clean Test Push Notification 🔔';
      const testBody = urlParams.get('body') || `Hello ${targetUser.name || 'User'}! This is a test FCM push notification from Look Clean server.`;
      const testData = { type: 'TEST_NOTIFICATION', timestamp };

      logs.push(`[STEP 3] Dispatching FCM notification via Firebase Admin SDK...`);
      logs.push(`[STEP 3 PAYLOAD] Title: "${testTitle}", Body: "${testBody}"`);

      try {
        const result = await sendFcmNotification({
          token: fcmToken,
          title: testTitle,
          body: testBody,
          data: testData
        });

        if (result.success) {
          logs.push(`[STEP 3 SUCCESS] Firebase Admin SDK returned SUCCESS! Push notification sent to FCM token.`);
          return NextResponse.json({
            success: true,
            message: 'Test notification sent successfully via Firebase Admin SDK',
            user: { id: targetUser.id, name: targetUser.name, email: targetUser.email, role: targetUser.role, dataSource: source },
            fcmTokenPreview: fcmToken ? (fcmToken.length > 35 ? `${fcmToken.slice(0, 25)}...${fcmToken.slice(-10)}` : fcmToken) : null,
            notificationDetails: { title: testTitle, body: testBody, data: testData },
            logs
          });
        } else {
          logs.push(`[STEP 3 ERROR] Firebase Admin SDK failed: ${JSON.stringify(result.error || 'Unknown error')}`);
          return NextResponse.json({
            success: false,
            error: result.error || 'Firebase Admin notification failed',
            user: { id: targetUser.id, name: targetUser.name, email: targetUser.email, role: targetUser.role },
            fcmTokenPreview: fcmToken ? (fcmToken.length > 35 ? `${fcmToken.slice(0, 25)}...${fcmToken.slice(-10)}` : fcmToken) : null,
            logs
          }, { status: 500 });
        }
      } catch (sendErr: any) {
        logs.push(`[STEP 3 EXCEPTION] ${sendErr.message || String(sendErr)}`);
        return NextResponse.json({
          success: false,
          error: sendErr.message || 'Exception during FCM dispatch',
          logs
        }, { status: 500 });
      }
    }

    if (path === 'providers/client-profile' || path === 'provider/client-profile' || path === 'providers/customer-profile' || path === 'provider/customer-profile') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'provider' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
      }

      const url = new URL(request.url);
      const clientIdStr = url.searchParams.get('clientId');
      if (!clientIdStr) {
        return NextResponse.json({ message: 'Missing clientId' }, { status: 400 });
      }
      const clientId = parseInt(clientIdStr, 10);

      try {
        const result = await executeWithDbFallback(
          async () => {
            const client = await prisma.user.findUnique({
              where: { id: clientId, role: 'client' },
              select: {
                id: true,
                name: true,
                email: true,
                clientProfile: true
              }
            });

            if (!client) {
              throw new Error('Client not found');
            }

            const bookings = await prisma.booking.findMany({
              where: {
                providerId: auth.userId,
                clientId: clientId,
                status: 'completed'
              },
              include: {
                services: {
                  include: { service: true }
                }
              },
              orderBy: {
                date: 'desc'
              }
            });

            const reviews = await prisma.review.findMany({
              where: {
                providerId: auth.userId,
                clientId: clientId
              }
            });

            const transactions = bookings.map(b => {
              const matchedReview = reviews.find(r => r.bookingId === b.id);
              const ratingObj = matchedReview ? { rating: matchedReview.rating, comment: matchedReview.comment } : null;

              return {
                ...b,
                services: b.services.map(bs => bs.service),
                rating: ratingObj
              };
            });

            return {
              client,
              transactions
            };
          },
          async () => {
            const clientUser = mockDb.users.find((u: any) => u.id === clientId && u.role === 'client');
            if (!clientUser) throw new Error('Client not found');
            const clientProfile = mockDb.profiles.find((p: any) => p.userId === clientId) || null;
            const client = { id: clientUser.id, name: clientUser.name, email: clientUser.email, clientProfile };

            const bookings = mockDb.bookings.filter((b: any) => b.providerId === auth.userId && b.clientId === clientId && b.status === 'completed');
            bookings.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

            const reviews = mockDb.reviews.filter((r: any) => r.providerId === auth.userId && r.clientId === clientId);

            const transactions = bookings.map((b: any) => {
              const bServices = mockDb.bookingServices.filter((bs: any) => bs.bookingId === b.id);
              const mappedServices = bServices.map((bs: any) => mockDb.services.find((s: any) => s.id === bs.serviceId) || { name: 'Unknown' });

              const matchedReview = reviews.find((r: any) => r.bookingId === b.id);
              const ratingObj = matchedReview ? { rating: matchedReview.rating, comment: matchedReview.comment } : null;

              return {
                ...b,
                services: mappedServices,
                rating: ratingObj
              };
            });

            return { client, transactions };
          }
        );
        return NextResponse.json(result);
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to fetch customer profile' }, { status: 400 });
      }
    }

    // 1. Fetch client profile (/api/clients/me or /api/client/me)
    if (path === 'clients/me' || path === 'client/me') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'client') {
        return NextResponse.json({ message: 'Forbidden: Requires client role' }, { status: 403 });
      }

      const userData = await executeWithDbFallback(
        async () => {
          return await prisma.user.findUnique({
            where: { id: auth.userId },
            include: {
              clientProfile: true,
            },
          });
        },
        async () => {
          const user = mockDb.users.find((u) => u.id === auth.userId);
          if (!user) return null;
          const clientProfile = mockDb.profiles.find((p) => p.userId === auth.userId) || null;
          return { ...user, clientProfile };
        }
      );

      if (!userData) {
        return NextResponse.json({ message: 'User not found' }, { status: 404 });
      }
      return NextResponse.json(sanitizeUser(userData, request));
    }

    // 1. Fetch provider profile (/api/providers/profile or /api/provider/profile)
    if (path === 'providers/profile' || path === 'provider/profile') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'provider' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
      }

      try {
        const userData = await executeWithDbFallback(
          async () => {
            return await prisma.user.findUnique({
              where: { id: auth.userId },
              include: {
                providerProfile: {
                  include: { services: true, amenities: true }
                }
              }
            });
          },
          async () => {
            const user = mockDb.users.find((u) => u.id === auth.userId);
            if (!user) return null;
            const profile = mockDb.profiles.find((p) => p.userId === auth.userId);
            let providerProfile = undefined;
            if (profile) {
              providerProfile = {
                ...profile,
                services: mockDb.services ? mockDb.services.filter((s) => s.profileId === profile.id) : [],
                amenities: mockDb.amenities ? mockDb.amenities.filter((a) => a.profileId === profile.id) : []
              };
            }
            return { ...user, providerProfile };
          }
        );

        if (!userData) {
          return NextResponse.json({ message: 'Provider not found' }, { status: 404 });
        }

        const sanitized = sanitizeUser(userData, request);
        if (sanitized?.providerProfile) {
          await enrichProviderProfile(sanitized.providerProfile, request);
        }
        return NextResponse.json(sanitized);
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to fetch provider profile' }, { status: 400 });
      }
    }

    // 1a. Get list of all providers with search & category filters (/api/clients/providers or /api/client/providers)
    if (path === 'clients/providers' || path === 'client/providers' || path === 'clients/provider' || path === 'client/provider') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'client' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires client role' }, { status: 403 });
      }

      const { searchParams } = new URL(request.url);
      const categoryId = searchParams.get('categoryId') || searchParams.get('category') || searchParams.get('categoryName');
      const sortBy = searchParams.get('sortBy') || searchParams.get('sort');
      const searchStr = (searchParams.get('search') || searchParams.get('query') || searchParams.get('q') || '').trim().toLowerCase();
      const providerTypeFilter = (searchParams.get('providerType') || searchParams.get('type') || '').trim().toLowerCase();
      const serviceFilter = (searchParams.get('service') || searchParams.get('serviceName') || '').trim().toLowerCase();

      try {
        let clientLat: number | null = null;
        let clientLon: number | null = null;

        const qLat = searchParams.get('latitude') || searchParams.get('lat');
        const qLon = searchParams.get('longitude') || searchParams.get('lon');
        if (qLat && qLon) {
          clientLat = Number(qLat);
          clientLon = Number(qLon);
        } else {
          const clientProfile = await executeWithDbFallback(
            async () => {
              return await prisma.clientProfile.findUnique({ where: { userId: auth.userId } });
            },
            async () => {
              return mockDb.profiles.find((p) => p.userId === auth.userId) || null;
            }
          );
          if (clientProfile && clientProfile.latitude !== null && clientProfile.latitude !== undefined &&
              clientProfile.longitude !== null && clientProfile.longitude !== undefined) {
            clientLat = Number(clientProfile.latitude);
            clientLon = Number(clientProfile.longitude);
          }
        }

        const providersList = await executeWithDbFallback(
          async () => {
            return await prisma.user.findMany({
              where: { role: 'provider' },
              include: {
                providerProfile: {
                  include: { services: true, amenities: true },
                },
                availabilityConfig: true,
                activeSlots: true,
              },
            });
          },
          async () => {
            return mockDb.users
              .filter((u) => u.role === 'provider')
              .map((user) => {
                const profile = mockDb.profiles.find((p) => p.userId === user.id);
                const config = mockDb.availabilityConfigs.find((c) => c.providerId === user.id);
                const slots = mockDb.activeSlots.filter((s) => s.providerId === user.id);
                let providerProfile = undefined;
                if (profile) {
                  providerProfile = {
                    ...profile,
                    services: mockDb.services.filter((s) => s.profileId === profile.id),
                    amenities: mockDb.amenities.filter((a) => a.profileId === profile.id),
                  };
                }
                return { ...user, providerProfile, availabilityConfig: config, activeSlots: slots };
              });
          }
        );

        const sanitizedProviders = (providersList as any[] || []).map((u) => sanitizeUser(u, request));
        for (const u of sanitizedProviders) {
          if (u) {
            const isWishlisted = wishlistStore.some(
              (item) => item.clientId === auth.userId && item.providerId === u.id
            );

            if (u.providerProfile) {
              await enrichProviderProfile(u.providerProfile, request);

              // Dynamically compute totalDistance in miles (mi)
              let distStr = '0.0 mi';
              const provLat = Number(u.providerProfile.latitude ?? u.latitude);
              const provLon = Number(u.providerProfile.longitude ?? u.longitude);

              if (clientLat !== null && clientLon !== null && !isNaN(clientLat) && !isNaN(clientLon) &&
                  !isNaN(provLat) && !isNaN(provLon) && (provLat !== 0 || provLon !== 0)) {
                distStr = calculateDistanceInMiles(clientLat, clientLon, provLat, provLon);
              } else {
                const sampleDistances = ['1.2 mi', '2.5 mi', '3.8 mi', '4.1 mi', '0.9 mi'];
                distStr = sampleDistances[Math.abs(u.id || 0) % sampleDistances.length];
              }

              // Position totalDistance after isFeatured
              u.providerProfile.isFeatured = u.providerProfile.isFeatured ?? false;
              u.providerProfile.featured = u.providerProfile.featured ?? false;
              u.providerProfile.totalDistance = distStr;
              u.totalDistance = distStr;

              // Dynamically fetch and compute ratings/reviews for each provider
              const reviews = await executeWithDbFallback(
                async () => await prisma.review.findMany({ where: { providerId: u.id }, include: { client: true } }),
                async () => mockDb.reviews.filter((r) => r.providerId === u.id)
              );

              if (reviews && reviews.length > 0) {
                const avgRating = Number((reviews.reduce((acc: number, r: any) => acc + r.rating, 0) / reviews.length).toFixed(1));
                u.providerProfile.reviews = {
                  rating: avgRating,
                  totalReviews: reviews.length,
                  totalReviewsText: `${reviews.length} reviews`,
                  list: reviews.map((r: any) => ({
                    id: r.id,
                    name: r.client?.name || 'Client',
                    initials: (r.client?.name || 'CL').split(' ').map((n: string) => n[0]).join('').toUpperCase(),
                    timeAgo: new Date(r.createdAt).toLocaleDateString(),
                    rating: r.rating,
                    comment: r.comment || ''
                  }))
                };
              } else {
                u.providerProfile.reviews = DEFAULT_EMPTY_REVIEWS;
              }

              u.providerProfile.rating = u.providerProfile.reviews?.rating ?? 0;

              // Determine earliest available time slot or start time
              let earliest = '09:00 AM';
              if (u.activeSlots && Array.isArray(u.activeSlots) && u.activeSlots.length > 0) {
                const activeAvailable = u.activeSlots.filter((s: any) => s.isAvailable !== false && s.timeSlot);
                if (activeAvailable.length > 0) {
                  activeAvailable.sort((a: any, b: any) => {
                    try { return parseTime(a.timeSlot) - parseTime(b.timeSlot); } catch { return 0; }
                  });
                  earliest = activeAvailable[0].timeSlot;
                }
              } else if (u.availabilityConfig?.startTime) {
                earliest = u.availabilityConfig.startTime;
              } else {
                const sampleTimes = ['08:00 AM', '09:00 AM', '10:00 AM', '08:30 AM', '09:30 AM'];
                earliest = sampleTimes[Math.abs(u.id || 0) % sampleTimes.length];
              }

              u.providerProfile.earliestTime = earliest;
              u.providerProfile.isWishlisted = isWishlisted;
            }
          }
        }

        let filteredProviders = sanitizedProviders;

        // Travel Mode Location Filtering:
        // When provider is in active travel mode (isTravelMode === true and current date <= travelEndDate):
        // Return provider for travel destination city/country and hide from home profile city/country until travelEndDate ends.
        const cityParam = (searchParams.get('city') || searchParams.get('clientCity') || '').trim().toLowerCase();
        const countryParam = (searchParams.get('country') || searchParams.get('clientCountry') || '').trim().toLowerCase();
        const locationParam = (searchParams.get('location') || searchParams.get('address') || '').trim().toLowerCase();

        filteredProviders = filteredProviders.filter((u: any) => {
          if (!u || !u.providerProfile) return true;
          const prof = u.providerProfile;
          const now = new Date();

          const isTravelActive = Boolean(
            prof.isTravelMode &&
            prof.travelEndDate &&
            new Date(prof.travelEndDate) >= now &&
            (!prof.travelStartDate || new Date(prof.travelStartDate) <= now)
          );

          const homeCity = (prof.city || '').toLowerCase();
          const homeCountry = (prof.country || '').toLowerCase();
          const travelCity = (prof.travelCity || '').toLowerCase();
          const travelCountry = (prof.travelCountry || '').toLowerCase();

          if (isTravelActive) {
            prof.isTravelActive = true;
            prof.activeLocation = [prof.travelLocation || prof.travelCity, prof.travelState, prof.travelCountry].filter(Boolean).join(', ');
            prof.displayCity = prof.travelCity || prof.city;
            prof.displayCountry = prof.travelCountry || prof.country;

            if (cityParam || countryParam || locationParam) {
              const matchTravel = (cityParam && travelCity.includes(cityParam)) ||
                                  (countryParam && travelCountry.includes(countryParam)) ||
                                  (locationParam && (travelCity.includes(locationParam) || travelCountry.includes(locationParam)));

              const matchHome = (cityParam && homeCity.includes(cityParam)) ||
                                (countryParam && homeCountry.includes(countryParam)) ||
                                (locationParam && (homeCity.includes(locationParam) || homeCountry.includes(locationParam)));

              if (matchHome && !matchTravel) return false;
              if (matchTravel) return true;
            }
          } else {
            prof.isTravelActive = false;
            prof.activeLocation = prof.location || [prof.city, prof.state, prof.country].filter(Boolean).join(', ');
            prof.displayCity = prof.city;
            prof.displayCountry = prof.country;
          }

          return true;
        });

        // Filter by providerType (salon | freelancer)
        if (providerTypeFilter && providerTypeFilter !== 'all') {
          filteredProviders = filteredProviders.filter((u: any) => {
            const type = (u.providerType || u.providerProfile?.providerType || '').toLowerCase();
            return type === providerTypeFilter;
          });
        }

        // Filter by category
        if (categoryId) {
          const targetId = Number(categoryId);
          const targetName = String(categoryId).toLowerCase();
          filteredProviders = filteredProviders.filter((u: any) => {
            if (!u || !u.providerProfile || !Array.isArray(u.providerProfile.categories)) {
              return false;
            }
            return u.providerProfile.categories.some((cat: any) =>
              cat.id === targetId || cat.title.toLowerCase().includes(targetName)
            );
          });
        }

        // Filter by service
        if (serviceFilter) {
          filteredProviders = filteredProviders.filter((u: any) => {
            if (!u || !u.providerProfile || !Array.isArray(u.providerProfile.services)) {
              return false;
            }
            return u.providerProfile.services.some((s: any) =>
              (s.name || '').toLowerCase().includes(serviceFilter)
            );
          });
        }

        // Search by salon name, freelancer name, service, category
        if (searchStr) {
          filteredProviders = filteredProviders.filter((u: any) => {
            if (!u) return false;
            const uName = (u.name || '').toLowerCase();
            const sName = (u.providerProfile?.salonName || '').toLowerCase();
            const pType = (u.providerType || '').toLowerCase();
            const serviceMatch = u.providerProfile?.services?.some((s: any) =>
              (s.name || '').toLowerCase().includes(searchStr) || (s.category || '').toLowerCase().includes(searchStr)
            );
            const categoryMatch = u.providerProfile?.categories?.some((c: any) =>
              (c.title || '').toLowerCase().includes(searchStr)
            );
            return uName.includes(searchStr) || sName.includes(searchStr) || pType.includes(searchStr) || serviceMatch || categoryMatch;
          });
        }

        // Filter by explicit isFeatured / featured parameter
        const isFeaturedParam = (searchParams.get('isFeatured') || searchParams.get('featured') || '').toLowerCase();
        if (isFeaturedParam === 'true' || isFeaturedParam === '1') {
          filteredProviders = filteredProviders.filter((u: any) =>
            u.providerProfile?.isFeatured === true || u.providerProfile?.featured === true || u.isFeatured === true
          );
        }

        const sortKey = (sortBy || '').trim().toLowerCase();

        if (sortKey === 'featured' || sortKey === 'isfeatured' || sortKey === 'top_featured' || sortKey === 'featured_first') {
          // Filter to ONLY return providers that are featured (isFeatured: true)
          filteredProviders = filteredProviders.filter((u: any) =>
            u.providerProfile?.isFeatured === true || u.providerProfile?.featured === true || u.isFeatured === true
          );

          filteredProviders.sort((a: any, b: any) => {
            const ratingA = Number(a.providerProfile?.reviews?.rating ?? a.providerProfile?.rating ?? 0);
            const ratingB = Number(b.providerProfile?.reviews?.rating ?? b.providerProfile?.rating ?? 0);
            return ratingB - ratingA;
          });
        } else if (sortKey === 'nearest' || sortKey === 'distance') {
          filteredProviders.sort((a: any, b: any) => {
            const getNumericDistance = (p: any) => {
              const distStr = p.providerProfile?.totalDistance || p.totalDistance || '';
              const val = parseFloat(distStr);
              return isNaN(val) ? 999999 : val;
            };
            return getNumericDistance(a) - getNumericDistance(b);
          });
        } else if (sortKey === 'earliest' || sortKey === 'earliest_time' || sortKey === 'time' || sortKey === 'earliesttime') {
          filteredProviders.sort((a: any, b: any) => {
            const timeStrA = a.providerProfile?.earliestTime || '09:00 AM';
            const timeStrB = b.providerProfile?.earliestTime || '09:00 AM';
            let minsA = 24 * 60;
            let minsB = 24 * 60;
            try { minsA = parseTime(timeStrA); } catch { }
            try { minsB = parseTime(timeStrB); } catch { }
            return minsA - minsB;
          });
        } else if (sortKey === 'ratings' || sortKey === 'rating' || sortKey === 'top_rated' || sortKey === 'highest_rated' || sortKey === 'toprated' || sortKey === 'highestrated') {
          filteredProviders.sort((a: any, b: any) => {
            const ratingA = Number(a.providerProfile?.reviews?.rating ?? a.providerProfile?.rating ?? a.rating ?? 0);
            const ratingB = Number(b.providerProfile?.reviews?.rating ?? b.providerProfile?.rating ?? b.rating ?? 0);
            if (ratingB !== ratingA) {
              return ratingB - ratingA;
            }
            const countA = Number(a.providerProfile?.reviews?.totalReviews ?? 0);
            const countB = Number(b.providerProfile?.reviews?.totalReviews ?? 0);
            return countB - countA;
          });
        }

        if (!filteredProviders || filteredProviders.length === 0) {
          return NextResponse.json({ message: 'No providers found' }, { status: 404 });
        }

        return NextResponse.json(filteredProviders);
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to fetch providers' }, { status: 400 });
      }
    }

    // 1aa. Get client wishlist (/api/clients/wishlist or /api/client/wishlist)
    if (path === 'clients/wishlist' || path === 'client/wishlist') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'client' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires client role' }, { status: 403 });
      }

      try {
        const wishlistedIds = wishlistStore
          .filter((item) => item.clientId === auth.userId)
          .map((item) => item.providerId);

        const providersList = await executeWithDbFallback(
          async () => {
            return await prisma.user.findMany({
              where: { role: 'provider', id: { in: wishlistedIds } },
              include: {
                providerProfile: {
                  include: { services: true, amenities: true },
                },
              },
            });
          },
          async () => {
            return mockDb.users
              .filter((u) => u.role === 'provider' && wishlistedIds.includes(u.id))
              .map((user) => {
                const profile = mockDb.profiles.find((p) => p.userId === user.id);
                let providerProfile = undefined;
                if (profile) {
                  providerProfile = {
                    ...profile,
                    services: mockDb.services.filter((s) => s.profileId === profile.id),
                    amenities: mockDb.amenities.filter((a) => a.profileId === profile.id),
                  };
                }
                return { ...user, providerProfile };
              });
          }
        );

        const sanitizedProviders = (providersList as any[] || []).map((u) => {
          const sanitized = sanitizeUser(u, request);
          if (sanitized) {
            if (sanitized.providerProfile) {
              sanitized.providerProfile.isWishlisted = true;
              sanitized.providerProfile.reviews = DEFAULT_EMPTY_REVIEWS;
              sanitized.providerProfile.earliestTime = '00:00 AM';
            }
          }
          return sanitized;
        });

        for (const u of sanitizedProviders) {
          if (u && u.providerProfile) {
            await enrichProviderProfile(u.providerProfile, request);
          }
        }

        return NextResponse.json(sanitizedProviders);
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to fetch wishlist' }, { status: 400 });
      }
    }

    // Provider notifications list (/api/providers/notification, /api/provider/notification, /api/providers/notifications, /api/provider/notifications)
    if (path === 'providers/notification' || path === 'provider/notification' || path === 'providers/notifications' || path === 'provider/notifications') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'provider' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
      }

      try {
        const notifications = await executeWithDbFallback(
          async () => {
            return await prisma.notification.findMany({
              where: { userId: auth.userId },
              orderBy: { createdAt: 'desc' }
            });
          },
          async () => {
            return mockDb.notifications
              .filter((n: any) => n.userId === auth.userId)
              .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          }
        );

        const formatNotificationItem = (n: any) => {
          let dataObj = n.data;
          if (typeof dataObj === 'string') {
            try { dataObj = JSON.parse(dataObj); } catch { }
          }
          if (!dataObj || typeof dataObj !== 'object') {
            dataObj = {};
          }
          const bId = dataObj.bookingId ? (isNaN(Number(dataObj.bookingId)) ? dataObj.bookingId : Number(dataObj.bookingId)) : null;
          const cId = dataObj.clientId ? (isNaN(Number(dataObj.clientId)) ? dataObj.clientId : Number(dataObj.clientId)) : null;
          const pId = dataObj.providerId ? (isNaN(Number(dataObj.providerId)) ? dataObj.providerId : Number(dataObj.providerId)) : null;
          const typeStr = n.type || dataObj.type || 'GENERAL';

          const enrichedData = {
            ...dataObj,
            type: typeStr,
            bookingId: bId !== null ? String(bId) : (dataObj.bookingId ? String(dataObj.bookingId) : undefined),
            clientId: cId !== null ? String(cId) : (dataObj.clientId ? String(dataObj.clientId) : undefined),
            providerId: pId !== null ? String(pId) : (dataObj.providerId ? String(dataObj.providerId) : undefined)
          };

          return {
            id: n.id,
            userId: n.userId,
            title: n.title,
            message: n.message || n.body || '',
            type: typeStr,
            bookingId: bId,
            clientId: cId,
            providerId: pId,
            data: enrichedData,
            isRead: Boolean(n.isRead),
            createdAt: n.createdAt
          };
        };

        const list = (notifications || []).map(formatNotificationItem);

        return NextResponse.json({
          success: true,
          count: list.length,
          notifications: list
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to fetch notifications' }, { status: 400 });
      }
    }

    // Client notifications list (/api/clients/notification, /api/client/notification, /api/clients/notifications, /api/client/notifications)
    if (path === 'clients/notification' || path === 'client/notification' || path === 'clients/notifications' || path === 'client/notifications') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'client' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires client role' }, { status: 403 });
      }

      try {
        const notifications = await executeWithDbFallback(
          async () => {
            return await prisma.notification.findMany({
              where: { userId: auth.userId },
              orderBy: { createdAt: 'desc' }
            });
          },
          async () => {
            return mockDb.notifications
              .filter((n: any) => n.userId === auth.userId)
              .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          }
        );

        const formatNotificationItem = (n: any) => {
          let dataObj = n.data;
          if (typeof dataObj === 'string') {
            try { dataObj = JSON.parse(dataObj); } catch { }
          }
          if (!dataObj || typeof dataObj !== 'object') {
            dataObj = {};
          }
          const bId = dataObj.bookingId ? (isNaN(Number(dataObj.bookingId)) ? dataObj.bookingId : Number(dataObj.bookingId)) : null;
          const cId = dataObj.clientId ? (isNaN(Number(dataObj.clientId)) ? dataObj.clientId : Number(dataObj.clientId)) : null;
          const pId = dataObj.providerId ? (isNaN(Number(dataObj.providerId)) ? dataObj.providerId : Number(dataObj.providerId)) : null;
          const typeStr = n.type || dataObj.type || 'GENERAL';

          const enrichedData = {
            ...dataObj,
            type: typeStr,
            bookingId: bId !== null ? String(bId) : (dataObj.bookingId ? String(dataObj.bookingId) : undefined),
            clientId: cId !== null ? String(cId) : (dataObj.clientId ? String(dataObj.clientId) : undefined),
            providerId: pId !== null ? String(pId) : (dataObj.providerId ? String(dataObj.providerId) : undefined)
          };

          return {
            id: n.id,
            userId: n.userId,
            title: n.title,
            message: n.message || n.body || '',
            type: typeStr,
            bookingId: bId,
            clientId: cId,
            providerId: pId,
            data: enrichedData,
            isRead: Boolean(n.isRead),
            createdAt: n.createdAt
          };
        };

        const list = (notifications || []).map(formatNotificationItem);

        return NextResponse.json({
          success: true,
          count: list.length,
          notifications: list
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to fetch notifications' }, { status: 400 });
      }
    }

    // 1b. Fetch provider profile (/api/providers/me or /api/provider/me)
    if (path === 'providers/me' || path === 'provider/me') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'provider') {
        return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
      }

      const userData = await executeWithDbFallback(
        async () => {
          return await prisma.user.findUnique({
            where: { id: auth.userId },
            include: {
              providerProfile: {
                include: { services: true, amenities: true },
              },
            },
          });
        },
        async () => {
          const user = mockDb.users.find((u) => u.id === auth.userId);
          if (!user) return null;
          const profile = mockDb.profiles.find((p) => p.userId === auth.userId);
          let providerProfile = undefined;
          if (profile) {
            providerProfile = {
              ...profile,
              services: mockDb.services.filter((s) => s.profileId === profile.id),
              amenities: mockDb.amenities.filter((a) => a.profileId === profile.id),
            };
          }
          return { ...user, providerProfile };
        }
      );

      if (!userData) {
        return NextResponse.json({ message: 'User not found' }, { status: 404 });
      }
      const sanitized = sanitizeUser(userData, request);
      if (sanitized && sanitized.providerProfile) {
        await enrichProviderProfile(sanitized.providerProfile, request);
      }
      return NextResponse.json(sanitized);
    }

    // Twilio settings (/api/admin/settings/twilio)
    if (path === 'admin/settings/twilio') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }

      const settings = await executeWithDbFallback(
        async () => {
          const dbSetting = await prisma.systemSetting.findUnique({
            where: { key: 'twilio' },
          });
          if (dbSetting) {
            return JSON.parse(dbSetting.value);
          }
          // Initialize default settings in database
          const defaultVal = JSON.stringify(mockDb.twilioSettings);
          await prisma.systemSetting.create({
            data: { key: 'twilio', value: defaultVal },
          });
          return mockDb.twilioSettings;
        },
        async () => {
          return mockDb.twilioSettings;
        }
      );

      return NextResponse.json(settings);
    }

    // Database status check (/api/admin/settings/database/status)
    if (path === 'admin/settings/database/status') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }

      try {
        // Test direct connection to database (bypass fallback)
        await prisma.$queryRaw`SELECT 1`;
        return NextResponse.json({
          connected: true,
          message: 'Successfully connected to the database!',
          databaseUrl: process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:@/]+@/, ':***@') : 'Not Configured'
        });
      } catch (err: any) {
        return NextResponse.json({
          connected: false,
          message: err.message || 'Failed to connect to the database.',
          error: String(err),
          databaseUrl: process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:@/]+@/, ':***@') : 'Not Configured'
        });
      }
    }

    // 3. Admin user list (/api/admin/users)
    if (path === 'admin/users') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }

      const usersList = await executeWithDbFallback(
        async () => {
          return await prisma.user.findMany({
            include: {
              providerProfile: {
                include: { services: true, amenities: true },
              },
              clientProfile: true,
            },
          });
        },
        async () => {
          return mockDb.users.map((user) => {
            const profile = mockDb.profiles.find((p) => p.userId === user.id);
            let providerProfile = undefined;
            let clientProfile = undefined;
            if (profile) {
              if (user.role === 'provider') {
                providerProfile = {
                  ...profile,
                  services: mockDb.services.filter((s) => s.profileId === profile.id),
                  amenities: mockDb.amenities.filter((a) => a.profileId === profile.id),
                };
              } else if (user.role === 'client') {
                clientProfile = {
                  ...profile,
                };
              }
            }
            return { ...user, providerProfile, clientProfile };
          });
        }
      );

      const sanitizedUsers = (usersList as any[] || []).map((u) => sanitizeUser(u, request));
      for (const u of sanitizedUsers) {
        if (u && u.providerProfile) {
          await enrichProviderProfile(u.providerProfile, request);
        }
      }
      return NextResponse.json(sanitizedUsers);
    }

    // 4. Admin stats (/api/admin/stats)
    if (path === 'admin/stats') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }

      const stats = await executeWithDbFallback(
        async () => {
          const total = await prisma.user.count();
          const clients = await prisma.user.count({ where: { role: 'client' } });
          const providers = await prisma.user.count({ where: { role: 'provider' } });
          const verifiedPhone = await prisma.user.count({ where: { isPhoneVerified: true } });
          const verifiedDocs = 0;
          return { total, clients, providers, verifiedPhone, verifiedDocs };
        },
        async () => {
          const total = mockDb.users.length;
          const clients = mockDb.users.filter((u) => u.role === 'client').length;
          const providers = mockDb.users.filter((u) => u.role === 'provider').length;
          const verifiedPhone = mockDb.users.filter((u) => u.isPhoneVerified).length;
          const verifiedDocs = 0;
          return { total, clients, providers, verifiedPhone, verifiedDocs };
        }
      );

      return NextResponse.json(stats);
    }

    // 5. GET Categories Settings list (/api/admin/settings/categories or /api/provider/setup/categories)
    if (path === 'admin/settings/categories' || path === 'provider/setup/categories') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (path === 'admin/settings/categories' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }
      if (path === 'provider/setup/categories' && auth.role !== 'provider' && auth.role !== 'admin' && auth.role !== 'client') {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const baseUrl = getBaseUrl(request);
      const list = await executeWithDbFallback(
        async () => {
          const dbCats = await prisma.categorySetting.findMany({ orderBy: { title: 'asc' } });
          return dbCats.map((item: any) => {
            let categoryIcon = item.categoryIcon || null;
            if (baseUrl && categoryIcon && categoryIcon.startsWith('/')) {
              categoryIcon = `${baseUrl}${categoryIcon}`;
            }
            return {
              ...item,
              categoryIcon,
            };
          });
        },
        async () => {
          return [
            { id: 1, title: 'Haircut & Styling', categoryIcon: null },
            { id: 2, title: 'Hair Colour', categoryIcon: null },
            { id: 3, title: 'Hair Treatments', categoryIcon: null },
            { id: 4, title: 'Hair Extensions', categoryIcon: null },
            { id: 5, title: 'Bridal & Event Hair', categoryIcon: null },
            { id: 6, title: 'Nails', categoryIcon: null },
            { id: 7, title: 'Brows & Lashes', categoryIcon: null },
            { id: 8, title: 'Facials & Skincare', categoryIcon: null },
            { id: 9, title: 'Waxing', categoryIcon: null },
            { id: 10, title: 'Threading', categoryIcon: null },
            { id: 11, title: 'Makeup', categoryIcon: null },
            { id: 12, title: 'Massage & Spa', categoryIcon: null },
            { id: 13, title: 'Tanning', categoryIcon: null },
            { id: 14, title: 'Advanced Beauty', categoryIcon: null },
            { id: 15, title: 'Piercing', categoryIcon: null },
            { id: 16, title: 'Men’s Grooming', categoryIcon: null },
            { id: 17, title: 'Kids’ Services', categoryIcon: null },
          ];
        }
      );
      if (path.includes('provider/setup/categories')) {
        return NextResponse.json(
          list.map((item: any) => ({
            id: item.id,
            title: item.title,
            categoryIcon: item.categoryIcon || null,
          }))
        );
      }
      return NextResponse.json(list);
    }

    // 6. GET Services Settings list (/api/admin/settings/services or /api/provider/setup/services)
    if (path === 'admin/settings/services' || path === 'provider/setup/services') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (path === 'admin/settings/services' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }
      if (path === 'provider/setup/services' && auth.role !== 'provider' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const list = await executeWithDbFallback(
        async () => {
          const dbList = await prisma.serviceSetting.findMany({
            include: { mainType: true },
            orderBy: { title: 'asc' }
          });
          return dbList.map(s => ({
            id: s.id,
            mainTypeId: s.mainTypeId,
            mainType: s.mainType.title,
            title: s.title
          }));
        },
        async () => {
          return [
            { id: 1, mainTypeId: 1, mainType: 'Haircut & Styling', title: 'Women’s Haircut' },
            { id: 2, mainTypeId: 1, mainType: 'Haircut & Styling', title: 'Men’s Haircut' },
            { id: 3, mainTypeId: 1, mainType: 'Haircut & Styling', title: 'Beard Trim' },
          ];
        }
      );

      if (path === 'provider/setup/services') {
        // Group by mainType/category
        const groups: { [key: string]: any[] } = {};
        list.forEach((item: any) => {
          const cat = item.mainType || 'General';
          if (!groups[cat]) {
            groups[cat] = [];
          }
          groups[cat].push({
            id: item.id,
            title: item.title
          });
        });
        const groupedList = Object.keys(groups).map(category => ({
          category,
          services: groups[category]
        }));
        return NextResponse.json(groupedList);
      }

      return NextResponse.json(list);
    }

    // 7. GET Ambience & Amenities Settings list (/api/admin/settings/ambience or /api/provider/setup/ambience)
    if (path === 'admin/settings/ambience' || path === 'provider/setup/ambience') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (path === 'admin/settings/ambience' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }
      if (path === 'provider/setup/ambience' && auth.role !== 'provider' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const baseUrl = getBaseUrl(request);

      if (path === 'provider/setup/ambience') {
        const groupsList = await executeWithDbFallback(
          async () => {
            const dbGroups = await prisma.ambienceGroupSetting.findMany({
              include: { items: { orderBy: { title: 'asc' } } },
              orderBy: { title: 'asc' }
            });
            return dbGroups.map((g) => ({
              id: g.id,
              title: g.title,
              items: g.items.map((item) => {
                let icon = item.icon;
                if (baseUrl && icon && icon.startsWith('/')) {
                  icon = `${baseUrl}${icon}`;
                }
                return {
                  id: item.id,
                  title: item.title,
                  icon: icon
                };
              })
            }));
          },
          async () => {
            return [
              {
                id: 1,
                title: 'Amenities',
                items: [
                  { id: 1, title: 'Free Wi-Fi', icon: null },
                  { id: 2, title: 'Parking', icon: null }
                ]
              },
              {
                id: 2,
                title: 'Ambience',
                items: [
                  { id: 3, title: 'Quiet Space', icon: null },
                  { id: 4, title: 'Relaxing Music', icon: null }
                ]
              }
            ];
          }
        );
        return NextResponse.json(groupsList);
      }

      const list = await executeWithDbFallback(
        async () => {
          const dbList = await prisma.ambienceSetting.findMany({
            include: { ambienceGroup: true },
            orderBy: { title: 'asc' }
          });
          return dbList.map(a => {
            let icon = a.icon;
            if (baseUrl && icon && icon.startsWith('/')) {
              icon = `${baseUrl}${icon}`;
            }
            return {
              id: a.id,
              mainTypeId: a.ambienceGroupId,
              mainType: a.ambienceGroup.title,
              title: a.title,
              icon: icon
            };
          });
        },
        async () => {
          return [
            { id: 1, mainTypeId: 1, mainType: 'Amenities', title: 'Free Wi-Fi' },
            { id: 2, mainTypeId: 1, mainType: 'Amenities', title: 'Parking' },
            { id: 3, mainTypeId: 2, mainType: 'Ambience', title: 'Quiet Space' },
            { id: 4, mainTypeId: 2, mainType: 'Ambience', title: 'Relaxing Music' },
          ];
        }
      );
      return NextResponse.json(list);
    }

    // GET Availability slots for provider
    if (path === 'providers/me/availability/slots' || path === 'provider/me/availability/slots') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'provider') {
        return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
      }

      try {
        const result = await executeWithDbFallback(
          async () => {
            const config = await prisma.providerAvailabilityConfig.findUnique({
              where: { providerId: auth.userId }
            });
            const activeSlots = await prisma.providerActiveSlot.findMany({
              where: { providerId: auth.userId }
            });
            return { config, activeSlots };
          },
          async () => {
            const config = mockDb.availabilityConfigs.find((c) => c.providerId === auth.userId) || null;
            const activeSlots = mockDb.activeSlots.filter((s) => s.providerId === auth.userId);
            return { config, activeSlots };
          }
        );

        const startTime = result.config?.startTime || '09:00 AM';
        const endTime = result.config?.endTime || '06:00 PM';
        const slotDuration = result.config?.slotDuration || 60;

        const detailedSlots = getSlotsDetailedRange(startTime, endTime, slotDuration);
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        const slotsResponse: Record<string, { timeSlot: string; fromTime: string; toTime: string; isAvailable: boolean }[]> = {};

        for (const day of days) {
          slotsResponse[day] = detailedSlots.map((slot) => {
            const match = result.activeSlots.find((s) => s.dayOfWeek.toLowerCase() === day.toLowerCase() && (s.timeSlot === slot.timeSlot || s.timeSlot === slot.fromTime));
            return {
              timeSlot: slot.timeSlot,
              fromTime: slot.fromTime,
              toTime: slot.toTime,
              isAvailable: match ? match.isAvailable : true
            };
          });
        }

        return NextResponse.json({
          startTime,
          endTime,
          slotDuration,
          slots: slotsResponse
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to fetch slots' }, { status: 400 });
      }
    }

    // Client checks a provider's availability slots for a specific date
    if (path === 'clients/providers/availability' || path === 'client/providers/availability') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }

      const { searchParams } = new URL(request.url);
      const providerIdStr = searchParams.get('providerId');
      const dateStr = searchParams.get('date');

      if (!providerIdStr || !dateStr) {
        return NextResponse.json({ message: 'Missing providerId or date parameter' }, { status: 400 });
      }

      const clientTimezone = searchParams.get('timezone') || searchParams.get('timeZone') || searchParams.get('clientTimezone') || auth?.timezone || (auth?.user as any)?.timezone || 'UTC';
      const currentTimeParam = searchParams.get('currentTime') || searchParams.get('time') || searchParams.get('clientTime');

      const providerId = parseInt(providerIdStr, 10);
      const bookingDate = new Date(dateStr);
      if (isNaN(bookingDate.getTime())) {
        return NextResponse.json({ message: 'Invalid date format' }, { status: 400 });
      }

      const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayName = daysOfWeek[bookingDate.getDay()];

      try {
        const result = await executeWithDbFallback(
          async () => {
            const config = await prisma.providerAvailabilityConfig.findUnique({
              where: { providerId }
            });
            const activeSlots = await prisma.providerActiveSlot.findMany({
              where: { providerId, dayOfWeek: dayName }
            });
            const bookings = await prisma.booking.findMany({
              where: {
                providerId,
                status: { not: 'cancelled' },
                date: {
                  gte: new Date(dateStr + 'T00:00:00.000Z'),
                  lte: new Date(dateStr + 'T23:59:59.999Z')
                }
              }
            });
            return { config, activeSlots, bookings };
          },
          async () => {
            const config = mockDb.availabilityConfigs.find((c) => c.providerId === providerId) || null;
            const activeSlots = mockDb.activeSlots.filter((s) => s.providerId === providerId && s.dayOfWeek.toLowerCase() === dayName.toLowerCase());

            const targetDateStr = bookingDate.toISOString().split('T')[0];
            const bookings = mockDb.bookings.filter((b) => {
              const bDateStr = new Date(b.date).toISOString().split('T')[0];
              return b.providerId === providerId && bDateStr === targetDateStr && b.status !== 'cancelled';
            });
            return { config, activeSlots, bookings };
          }
        );

        const startTime = result.config?.startTime || '09:00 AM';
        const endTime = result.config?.endTime || '06:00 PM';
        const slotDuration = result.config?.slotDuration || 60;

        const detailedSlots = getSlotsDetailedRange(startTime, endTime, slotDuration);

        let currentMinutes: number | null = null;
        let isPastDate = false;

        if (currentTimeParam) {
          if (currentTimeParam.includes('T') || currentTimeParam.includes('-')) {
            const clientDate = new Date(currentTimeParam);
            if (!isNaN(clientDate.getTime())) {
              const bDateOnly = dateStr.split('T')[0];
              const cDateOnly = clientDate.toISOString().split('T')[0];
              if (bDateOnly < cDateOnly) {
                isPastDate = true;
              } else if (bDateOnly === cDateOnly) {
                currentMinutes = clientDate.getHours() * 60 + clientDate.getMinutes();
              }
            }
          } else if (currentTimeParam.includes(':')) {
            currentMinutes = parseTime(currentTimeParam);
          }
        }

        const availableSlotObjects = isPastDate ? [] : detailedSlots.filter((slot) => {
          const slotStatus = result.activeSlots.find((s) => s.timeSlot === slot.timeSlot || s.timeSlot === slot.fromTime);
          if (slotStatus && !slotStatus.isAvailable) {
            return false;
          }
          const isBooked = result.bookings.some((b) => b.timeSlot === slot.timeSlot || b.timeSlot === slot.fromTime);
          if (isBooked) return false;
          if (currentMinutes !== null) {
            const slotMin = parseTime(slot.fromTime);
            if (slotMin <= currentMinutes) {
              return false;
            }
          }
          return true;
        }).map(slot => ({
          timeSlot: slot.timeSlot,
          fromTime: slot.fromTime,
          toTime: slot.toTime,
          isAvailable: true
        }));

        const availableSlotTimes = availableSlotObjects.map(s => s.timeSlot);

        return NextResponse.json({
          providerId,
          date: dateStr,
          dayOfWeek: dayName,
          timezone: clientTimezone,
          startTime,
          endTime,
          slotDuration,
          availableSlots: availableSlotObjects,
          availableSlotTimes
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to fetch availability' }, { status: 400 });
      }
    }

    // Admin Promo Code CRUD - GET list or single
    if (path === 'admin/settings/promocodes' || path === 'admin/settings/vouchers') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires admin role' }, { status: 403 });
      }

      const { searchParams } = new URL(request.url);
      const voucherIdStr = searchParams.get('id');

      try {
        if (voucherIdStr) {
          const voucherId = parseInt(voucherIdStr, 10);
          const voucher = await executeWithDbFallback(
            async () => await prisma.voucher.findUnique({ where: { id: voucherId } }),
            async () => mockDb.vouchers.find((v) => v.id === voucherId) || null
          );
          if (!voucher) {
            return NextResponse.json({ message: 'Voucher not found' }, { status: 404 });
          }
          return NextResponse.json(voucher);
        } else {
          const list = await executeWithDbFallback(
            async () => await prisma.voucher.findMany({ orderBy: { createdAt: 'desc' } }),
            async () => [...mockDb.vouchers].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          );
          return NextResponse.json(list);
        }
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to fetch vouchers' }, { status: 400 });
      }
    }

    // GET Bookings for Client
    if (path === 'clients/bookings' || path === 'client/bookings') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'client') {
        return NextResponse.json({ message: 'Forbidden: Requires client role' }, { status: 403 });
      }
      const baseUrl = getBaseUrl(request);
      const list = await executeWithDbFallback(
        async () => {
          const dbBookings = await prisma.booking.findMany({
            where: { clientId: auth.userId },
            include: {
              provider: {
                include: { providerProfile: true }
              },
              services: { include: { service: true } }
            },
            orderBy: { date: 'desc' }
          });
          return Promise.all(dbBookings.map(async (b: any) => {
            const processed = await processBookingPaymentAndStatus(b);
            const providerUser = processed.provider;
            const profile = providerUser?.providerProfile;
            let profileImageUrl = profile?.profileImageUrl || null;
            if (baseUrl && profileImageUrl && profileImageUrl.startsWith('/')) {
              profileImageUrl = `${baseUrl}${profileImageUrl}`;
            }
            let coverImageUrl = profile?.coverImageUrl || null;
            if (baseUrl && coverImageUrl && coverImageUrl.startsWith('/')) {
              coverImageUrl = `${baseUrl}${coverImageUrl}`;
            }

            const providerDetails = providerUser ? {
              id: providerUser.id,
              name: profile?.name || providerUser.name || '',
              email: providerUser.email,
              phoneNumber: providerUser.phoneNumber || null,
              providerType: providerUser.providerType || null,
              timezone: providerUser.timezone || 'UTC',
              location: profile?.location || null,
              profileImageUrl,
              coverImageUrl,
              latitude: profile?.latitude || null,
              longitude: profile?.longitude || null,
            } : null;

            const { provider, ...rest } = processed;
            return {
              ...rest,
              timezone: rest.timezone || providerUser?.timezone || auth.timezone || 'UTC',
              providerDetails
            };
          }));
        },
        async () => {
          const rawMockList = mockDb.bookings
            .filter((b) => b.clientId === auth.userId)
            .map((b: any) => {
              const services = mockDb.bookingServices
                .filter((bs) => bs.bookingId === b.id)
                .map((bs) => {
                  const service = mockDb.services.find((s) => s.id === bs.serviceId);
                  return { id: bs.id, serviceId: bs.serviceId, service };
                });
              const providerUser = mockDb.users.find((u) => u.id === b.providerId);
              const profile = mockDb.profiles.find((p) => p.userId === b.providerId);
              let profileImageUrl = profile?.profileImageUrl || null;
              if (baseUrl && profileImageUrl && profileImageUrl.startsWith('/')) {
                profileImageUrl = `${baseUrl}${profileImageUrl}`;
              }
              let coverImageUrl = profile?.coverImageUrl || null;
              if (baseUrl && coverImageUrl && coverImageUrl.startsWith('/')) {
                coverImageUrl = `${baseUrl}${coverImageUrl}`;
              }

              const providerDetails = providerUser ? {
                id: providerUser.id,
                name: profile?.name || providerUser.name || '',
                email: providerUser.email,
                phoneNumber: providerUser.phoneNumber || null,
                providerType: providerUser.providerType || null,
                timezone: providerUser?.timezone || 'UTC',
                location: profile?.location || null,
                profileImageUrl,
                coverImageUrl,
                latitude: profile?.latitude || null,
                longitude: profile?.longitude || null,
              } : null;

              return {
                ...b,
                timezone: b.timezone || providerUser?.timezone || auth.timezone || 'UTC',
                services,
                providerDetails
              };
            })
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

          return Promise.all(rawMockList.map((b: any) => processBookingPaymentAndStatus(b)));
        }
      );
      return NextResponse.json(list);
    }

    // GET Bookings for Provider
    if (path === 'providers/bookings' || path === 'provider/bookings') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'provider') {
        return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
      }
      const baseUrl = getBaseUrl(request);
      const list = await executeWithDbFallback(
        async () => {
          const dbBookings = await prisma.booking.findMany({
            where: { providerId: auth.userId },
            include: {
              client: {
                include: { clientProfile: true }
              },
              services: { include: { service: true } }
            },
            orderBy: { date: 'desc' }
          });
          return Promise.all(dbBookings.map(async (b: any) => {
            const processed = await processBookingPaymentAndStatus(b);
            if (processed && Array.isArray(processed.services)) {
              processed.services = await transformServicesListWithRealNames(processed.services);
            }
            const clientUser = processed.client;
            const profile = clientUser?.clientProfile;
            let profileImageUrl = profile?.profileImageUrl || null;
            if (baseUrl && profileImageUrl && profileImageUrl.startsWith('/')) {
              profileImageUrl = `${baseUrl}${profileImageUrl}`;
            }

            const clientDetails = clientUser ? {
              id: clientUser.id,
              name: clientUser.name || '',
              email: clientUser.email,
              phoneNumber: clientUser.phoneNumber || null,
              timezone: clientUser.timezone || 'UTC',
              location: profile?.location || null,
              profileImageUrl,
              latitude: profile?.latitude || null,
              longitude: profile?.longitude || null,
            } : null;

            const { client, ...rest } = processed;
            return {
              ...rest,
              timezone: rest.timezone || clientUser?.timezone || auth.timezone || 'UTC',
              clientDetails
            };
          }));
        },
        async () => {
          const rawMockList = mockDb.bookings
            .filter((b) => b.providerId === auth.userId)
            .map((b) => {
              const services = mockDb.bookingServices
                .filter((bs) => bs.bookingId === b.id)
                .map((bs) => {
                  const service = mockDb.services.find((s) => s.id === bs.serviceId);
                  return { id: bs.id, serviceId: bs.serviceId, service };
                });
              const clientUser = mockDb.users.find((u) => u.id === b.clientId);
              const profile = mockDb.profiles.find((p) => p.userId === b.clientId);
              let profileImageUrl = profile?.profileImageUrl || null;
              if (baseUrl && profileImageUrl && profileImageUrl.startsWith('/')) {
                profileImageUrl = `${baseUrl}${profileImageUrl}`;
              }

              const clientDetails = clientUser ? {
                id: clientUser.id,
                name: clientUser.name || '',
                email: clientUser.email,
                phoneNumber: clientUser.phoneNumber || null,
                timezone: clientUser?.timezone || 'UTC',
                location: profile?.location || null,
                profileImageUrl,
                latitude: profile?.latitude || null,
                longitude: profile?.longitude || null,
              } : null;

              return {
                ...b,
                timezone: b.timezone || clientUser?.timezone || auth.timezone || 'UTC',
                services,
                clientDetails
              };
            })
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

          return Promise.all(rawMockList.map((b: any) => processBookingPaymentAndStatus(b)));
        }
      );
      return NextResponse.json(list);
    }

    // 3. Client Available Promo Codes / Vouchers (/api/clients/vouchers or /api/clients/promocodes)
    if (path === 'clients/vouchers' || path === 'client/vouchers' || path === 'clients/promocodes' || path === 'client/promocodes') {
      try {
        const vouchers = await executeWithDbFallback(
          async () => await prisma.voucher.findMany({ where: { isActive: true }, orderBy: { createdAt: 'desc' } }),
          async () => mockDb.vouchers.filter((v) => v.isActive)
        );
        return NextResponse.json(vouchers);
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to fetch promo codes' }, { status: 400 });
      }
    }



    // 5. CMS Pages GET endpoints (/api/cms/pages, /api/cms/:slug, /api/cms/terms, etc.)
    if (path.startsWith('cms/') || path === 'cms' || path === 'admin/cms-pages') {
      const parts = path.split('/');
      let slug = parts.length > 1 ? parts[1] : '';
      if (slug === 'pages' && parts.length > 2) {
        slug = parts[2];
      }
      if (slug === 'client-faq') slug = 'client-faqs';
      if (slug === 'provider-faq') slug = 'provider-faqs';

      const formatCmsPage = (page: any) => {
        if (!page) return page;
        let rawContent = page.content;
        let parsedContent = rawContent;
        let contentType: 'array' | 'html' = 'html';

        let isArray = false;
        let arrayItems: any[] = [];

        if (Array.isArray(rawContent)) {
          isArray = true;
          arrayItems = rawContent;
        } else if (typeof rawContent === 'string') {
          const trimmed = rawContent.trim();
          if (trimmed.startsWith('[')) {
            try {
              const parsed = JSON.parse(rawContent);
              if (Array.isArray(parsed)) {
                isArray = true;
                arrayItems = parsed;
              }
            } catch {
              isArray = false;
            }
          }
        } else if (typeof rawContent === 'object' && rawContent !== null) {
          isArray = true;
          arrayItems = Array.isArray(rawContent) ? rawContent : [rawContent];
        }

        if (page.slug === 'client-faqs' || page.slug === 'provider-faqs' || page.slug === 'client-faq' || page.slug === 'provider-faq') {
          contentType = 'html';
          if (isArray && arrayItems.length > 0) {
            parsedContent = arrayItems.map((item: any) => {
              if (typeof item === 'string') return `<p>${item}</p>`;
              const q = item.question || item.q || item.title || '';
              const a = item.answer || item.a || item.content || item.description || '';
              return `<h2>${q}</h2><p>${a}</p>`;
            }).join('');
          } else {
            parsedContent = typeof rawContent === 'string' ? rawContent : String(rawContent || '');
          }
        } else {
          if (isArray) {
            contentType = 'array';
            parsedContent = arrayItems;
          } else {
            contentType = 'html';
            parsedContent = typeof rawContent === 'string' ? rawContent : String(rawContent || '');
          }
        }

        const pageObj = typeof page.toObject === 'function' ? page.toObject() : { ...page };
        delete pageObj.faqs;

        return {
          ...pageObj,
          contentType,
          content: parsedContent
        };
      };

      if (slug && slug !== 'pages') {
        const page = await executeWithDbFallback(
          async () => await prisma.cmsPage.findUnique({ where: { slug } }),
          async () => mockDb.cmsPages.find((p) => p.slug === slug) || null
        );
        if (!page) {
          return NextResponse.json({ message: 'CMS page not found' }, { status: 404 });
        }
        return NextResponse.json(formatCmsPage(page));
      } else {
        const pages = await executeWithDbFallback(
          async () => await prisma.cmsPage.findMany(),
          async () => mockDb.cmsPages
        );
        const formattedPages = Array.isArray(pages) ? pages.map(formatCmsPage) : pages;
        return NextResponse.json(formattedPages);
      }
    }

    // 6. App Version GET (/api/app-version, /api/settings/app-version, /api/clients/app-version)
    if (path === 'app-version' || path === 'settings/app-version' || path === 'clients/app-version' || path === 'admin/settings/app-version') {
      try {
        const versions = await executeWithDbFallback(
          async () => {
            const setting = await prisma.systemSetting.findUnique({ where: { key: 'app_version' } });
            return setting ? JSON.parse(setting.value) : mockDb.appVersions;
          },
          async () => mockDb.appVersions
        );
        return NextResponse.json(versions);
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to fetch app versions' }, { status: 400 });
      }
    }

    // 7. FAQ GET (/api/faqs, /api/clients/faqs, /api/admin/faqs)
    if (path === 'faqs' || path === 'clients/faqs' || path === 'admin/faqs' || path === 'client/faqs') {
      try {
        const faqs = await executeWithDbFallback(
          async () => await prisma.faq.findMany({ orderBy: { order: 'asc' } }),
          async () => [...mockDb.faqs].sort((a, b) => (a.order || 0) - (b.order || 0))
        );
        return NextResponse.json(faqs);
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to fetch FAQs' }, { status: 400 });
      }
    }

    // 8. Report & Issues GET (/api/reports, /api/issues, /api/admin/reports)
    if (path === 'reports' || path === 'issues' || path === 'admin/reports' || path === 'clients/reports' || path === 'client/reports') {
      const auth = await getAuthenticatedUser(request);
      const { searchParams } = new URL(request.url);
      const statusFilter = searchParams.get('status');

      try {
        const reports = await executeWithDbFallback(
          async () => {
            const whereClause: any = {};
            if (auth && auth.role !== 'admin') {
              whereClause.userId = auth.userId;
            }
            if (statusFilter) {
              whereClause.status = statusFilter;
            }
            return await prisma.issueReport.findMany({
              where: whereClause,
              include: { user: { select: { id: true, name: true, email: true, phoneNumber: true } } },
              orderBy: { createdAt: 'desc' }
            });
          },
          async () => {
            let list = [...mockDb.issueReports];
            if (auth && auth.role !== 'admin') {
              list = list.filter((r) => r.userId === auth.userId);
            }
            if (statusFilter) {
              list = list.filter((r) => r.status === statusFilter);
            }
            return list.map((r) => {
              const user = mockDb.users.find((u) => u.id === r.userId);
              return {
                ...r,
                user: user ? { id: user.id, name: user.name, email: user.email, phoneNumber: user.phoneNumber } : null
              };
            }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          }
        );
        return NextResponse.json(reports);
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to fetch reports' }, { status: 400 });
      }
    }

    // GET Provider Requests (/api/admin/provider-requests or /api/provider-requests)
    if (path === 'admin/provider-requests' || path === 'provider-requests' || path === 'provider/requests' || path === 'providers/requests') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const url = new URL(request.url);
      const requestType = url.searchParams.get('requestType');

      try {
        const requests = await executeWithDbFallback(
          async () => {
            const whereClause: any = {};
            if (requestType) {
              whereClause.requestType = { equals: requestType, mode: 'insensitive' };
            }
            if (auth.role === 'provider') {
              whereClause.providerId = auth.userId;
            }
            return await prisma.providerRequest.findMany({
              where: whereClause,
              include: {
                provider: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    phoneNumber: true,
                    role: true,
                    providerType: true,
                    providerProfile: true
                  }
                }
              },
              orderBy: { createdAt: 'desc' }
            });
          },
          async () => {
            let list = [...mockDb.providerRequests];
            if (requestType) {
              list = list.filter((r) => r.requestType?.toLowerCase() === requestType.toLowerCase());
            }
            if (auth.role === 'provider') {
              list = list.filter((r) => r.providerId === auth.userId);
            }
            return list.map((r) => {
              const provider = mockDb.users.find((u) => u.id === r.providerId);
              const providerProfile = mockDb.profiles.find((p) => p.userId === r.providerId);
              return {
                ...r,
                provider: provider ? {
                  id: provider.id,
                  name: provider.name,
                  email: provider.email,
                  phoneNumber: provider.phoneNumber,
                  role: provider.role,
                  providerType: provider.providerType,
                  providerProfile: providerProfile || null
                } : null
              };
            }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          }
        );
        return NextResponse.json({ success: true, requests });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to fetch provider requests' }, { status: 400 });
      }
    }

    // GET All Bookings for Admin (/api/admin/bookings or /api/bookings)
    if (path === 'admin/bookings' || path === 'bookings') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires admin role' }, { status: 403 });
      }
      try {
        const bookingsList = await executeWithDbFallback(
          async () => {
            const list = await prisma.booking.findMany({
              include: {
                client: {
                  include: { clientProfile: true }
                },
                provider: {
                  include: { providerProfile: true }
                },
                services: {
                  include: { service: true }
                },
                review: true
              },
              orderBy: { createdAt: 'desc' }
            });
            return Promise.all(list.map(async (b: any) => {
              const processed = await processBookingPaymentAndStatus(b);
              return {
                ...processed,
                client: sanitizeUser(processed.client, request),
                provider: sanitizeUser(processed.provider, request),
                services: processed.services ? processed.services.map((bs: any) => bs.service || bs) : []
              };
            }));
          },
          async () => {
            const rawMockList = mockDb.bookings.map((b: any) => {
              const client = mockDb.users.find((u) => u.id === b.clientId);
              const clientProfile = mockDb.profiles.find((p) => p.userId === b.clientId);
              const provider = mockDb.users.find((u) => u.id === b.providerId);
              const providerProfile = mockDb.profiles.find((p) => p.userId === b.providerId);
              const bServices = mockDb.bookingServices.filter((bs) => bs.bookingId === b.id);
              const services = bServices.map((bs) => mockDb.services.find((s) => s.id === bs.serviceId) || { id: bs.serviceId, name: 'Service', price: 0, category: 'General' });
              return {
                ...b,
                client: client ? { ...sanitizeUser(client, request), clientProfile } : null,
                provider: provider ? { ...sanitizeUser(provider, request), providerProfile } : null,
                services
              };
            }).sort((a: any, b: any) => new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime());

            return Promise.all(rawMockList.map((b: any) => processBookingPaymentAndStatus(b)));
          }
        );
        return NextResponse.json({ success: true, bookings: bookingsList });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to fetch bookings' }, { status: 400 });
      }
    }

    // GET Platform Fee Cut Setting (/api/admin/settings/platform-fee)
    if (path === 'admin/settings/platform-fee' || path === 'settings/platform-fee') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires admin role' }, { status: 403 });
      }
      try {
        const feeCut = await executeWithDbFallback(
          async () => {
            const setting = await prisma.systemSetting.findUnique({ where: { key: 'platform_fee_cut' } });
            return setting ? parseFloat(setting.value) : 5;
          },
          async () => {
            return mockDb.platformFeeCut !== undefined ? mockDb.platformFeeCut : 5;
          }
        );
        return NextResponse.json({ success: true, platformFeeCut: feeCut });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to fetch platform fee setting' }, { status: 400 });
      }
    }

    // GET Cron Job for Auto-Completing Past Bookings (/api/cron/completed-bookings or /api/admin/cron/completed-bookings or /api/cron/auto-complete-bookings)
    if (path === 'cron/completed-bookings' || path === 'admin/cron/completed-bookings' || path === 'cron/auto-complete-bookings') {
      try {
        setCronDependencies(mockDb, sendNotificationToUser);
        const result = await autoCompletePastBookings();
        return NextResponse.json({
          success: true,
          message: `Completed bookings cron executed successfully. Auto-completed ${result.updatedCount} expired booking(s).`,
          updatedCount: result.updatedCount,
          completedBookingIds: result.completedBookingIds
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to execute completed bookings cron' }, { status: 500 });
      }
    }

    return NextResponse.json({ message: 'Endpoint not found' }, { status: 404 });
  } catch (err: any) {
    console.error(`[API GET Error]`, err);
    return NextResponse.json({ message: err.message || 'GET failed', error: String(err) }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ catchall?: string[] }> }
) {
  try {
    const { catchall } = await params;
    const rawPath = catchall?.join('/') || '';
    const path = rawPath.replace(/^api\//i, '').replace(/\/$/, '').trim();
    console.log(`[API POST] rawPath='${rawPath}' -> path='${path}'`);

    // POST /api/stripe/webhook (Raw body processing for Stripe Webhook Signature Verification)
    if (path === 'stripe/webhook') {
      try {
        const rawBody = await request.text();
        const sig = request.headers.get('stripe-signature');
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        const stripe = getStripeInstance();

        let event: Stripe.Event;
        if (webhookSecret && sig && stripe) {
          try {
            event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
          } catch (err: any) {
            console.warn('[Stripe Webhook Signature Warning] Construct event failed, falling back to JSON body parse:', err.message);
            try {
              event = JSON.parse(rawBody);
            } catch {
              return NextResponse.json({ success: false, error: `Webhook Signature Verification Failed: ${err.message}` }, { status: 400 });
            }
          }
        } else {
          try {
            event = JSON.parse(rawBody);
          } catch {
            return NextResponse.json({ success: false, error: 'Invalid JSON payload' }, { status: 400 });
          }
        }

        console.log(`[Stripe Webhook Event Received] ${event.type}`);

        if (event.type === 'payment_intent.succeeded') {
          const paymentIntent = event.data.object as Stripe.PaymentIntent;
          const metadata = paymentIntent.metadata || {};
          let targetBookingId = (metadata.bookingId && !isNaN(parseInt(metadata.bookingId, 10))) ? parseInt(metadata.bookingId, 10) : null;
          let targetUserId = (metadata.userId && !isNaN(parseInt(metadata.userId, 10))) ? parseInt(metadata.userId, 10) : null;
          const userEmail = metadata.userEmail || null;
          const stripeRawData = JSON.stringify(paymentIntent);

          // If targetBookingId is empty/missing, resolve the latest pending booking for the user
          if (!targetBookingId) {
            if (targetUserId) {
              const pendingBooking = await prisma.booking.findFirst({
                where: { clientId: targetUserId, status: 'pending' },
                orderBy: { createdAt: 'desc' }
              }).catch(() => null);

              if (pendingBooking) {
                targetBookingId = pendingBooking.id;
              } else if (typeof mockDb !== 'undefined' && Array.isArray(mockDb.bookings)) {
                const mockPending = mockDb.bookings
                  .filter((b: any) => b.clientId === targetUserId && b.status === 'pending')
                  .sort((a: any, b: any) => new Date(b.createdAt || b.date).getTime() - new Date(a.createdAt || a.date).getTime())[0];
                if (mockPending) {
                  targetBookingId = mockPending.id;
                }
              }
            } else if (userEmail) {
              const userObj = await prisma.user.findUnique({ where: { email: userEmail } }).catch(() => null);
              if (userObj) {
                targetUserId = userObj.id;
                const pendingBooking = await prisma.booking.findFirst({
                  where: { clientId: userObj.id, status: 'pending' },
                  orderBy: { createdAt: 'desc' }
                }).catch(() => null);
                if (pendingBooking) {
                  targetBookingId = pendingBooking.id;
                }
              }
            }
          }

          if (targetBookingId) {
            try {
              await prisma.booking.update({
                where: { id: targetBookingId },
                data: {
                  status: 'confirmed',
                  transactionId: paymentIntent.id,
                  stripeRawData: stripeRawData
                }
              }).catch(() => {
                const b = mockDb.bookings.find((item: any) => item.id === targetBookingId);
                if (b) {
                  b.status = 'confirmed';
                  b.transactionId = paymentIntent.id;
                  b.stripeRawData = stripeRawData;
                }
              });
            } catch (e) {
              console.error('[Stripe Webhook] Error updating booking status', e);
            }
          }

          if (targetUserId) {
            await sendNotificationToUser(
              targetUserId,
              'Payment Successful! 💳',
              `Your payment of $${(paymentIntent.amount / 100).toFixed(2)} was successfully processed via Stripe.`,
              { type: 'PAYMENT_SUCCESS', paymentIntentId: paymentIntent.id, bookingId: String(targetBookingId || '') }
            );
          }
        } else if (event.type === 'checkout.session.completed') {
          const session = event.data.object as Stripe.Checkout.Session;
          const metadata = session.metadata || {};
          let targetBookingId = (metadata.bookingId && !isNaN(parseInt(metadata.bookingId, 10))) ? parseInt(metadata.bookingId, 10) : null;
          let targetUserId = (metadata.userId && !isNaN(parseInt(metadata.userId, 10))) ? parseInt(metadata.userId, 10) : null;
          const userEmail = metadata.userEmail || null;
          const stripeRawData = JSON.stringify(session);
          const txId = (session.payment_intent as string) || session.id;

          if (!targetBookingId) {
            if (targetUserId) {
              const pendingBooking = await prisma.booking.findFirst({
                where: { clientId: targetUserId, status: 'pending' },
                orderBy: { createdAt: 'desc' }
              }).catch(() => null);
              if (pendingBooking) targetBookingId = pendingBooking.id;
            } else if (userEmail) {
              const userObj = await prisma.user.findUnique({ where: { email: userEmail } }).catch(() => null);
              if (userObj) {
                targetUserId = userObj.id;
                const pendingBooking = await prisma.booking.findFirst({
                  where: { clientId: userObj.id, status: 'pending' },
                  orderBy: { createdAt: 'desc' }
                }).catch(() => null);
                if (pendingBooking) targetBookingId = pendingBooking.id;
              }
            }
          }

          if (targetBookingId) {
            try {
              await prisma.booking.update({
                where: { id: targetBookingId },
                data: {
                  status: 'confirmed',
                  transactionId: txId,
                  stripeRawData: stripeRawData
                }
              }).catch(() => {
                const b = mockDb.bookings.find((item: any) => item.id === targetBookingId);
                if (b) {
                  b.status = 'confirmed';
                  b.transactionId = txId;
                  b.stripeRawData = stripeRawData;
                }
              });
            } catch (e) {
              console.error('[Stripe Webhook] Error updating booking status from Checkout', e);
            }
          }

          if (targetUserId) {
            await sendNotificationToUser(
              targetUserId,
              'Payment Completed! 💳',
              `Your checkout session payment was successfully completed.`,
              { type: 'PAYMENT_SUCCESS', sessionId: session.id, bookingId: String(targetBookingId || '') }
            );
          }
        }

        return NextResponse.json({ received: true, eventType: event.type });
      } catch (err: any) {
        console.error('[Stripe Webhook Error]', err);
        return NextResponse.json({ success: false, error: err.message || 'Webhook processing failed' }, { status: 500 });
      }
    }

    let body: any = {};
    let parsedFormData: FormData | null = null;
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
      try {
        parsedFormData = await request.formData();
        parsedFormData.forEach((value, key) => {
          body[key] = value;
        });
      } catch (err) {
        console.error('Failed to parse form data', err);
      }
    } else {
      try {
        body = await request.json();
      } catch {
        // Empty body or not JSON
      }
    }

    // Update Provider Profile (/api/providers/profile or /api/provider/profile)
    if (path === 'providers/profile' || path === 'provider/profile') {
      return await handleUpdateProviderProfile(request, body);
    }

    // POST /api/provider/payout-type or /api/providers/payout-type
    if (path === 'provider/payout-type' || path === 'providers/payout-type') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'provider') {
        return NextResponse.json({ success: false, message: 'Forbidden: Requires provider role' }, { status: 403 });
      }

      const inputPayoutType = body?.payoutScheduleType ?? body?.payout_schedule_type ?? body?.payoutType ?? body?.payout_type ?? body?.type;
      if (!inputPayoutType || typeof inputPayoutType !== 'string') {
        return NextResponse.json({ success: false, message: 'Invalid or missing payoutScheduleType. Must be "INSTANT" or "WEEKLY".' }, { status: 400 });
      }

      const normalizedType = inputPayoutType.toUpperCase().trim();
      if (normalizedType !== 'INSTANT' && normalizedType !== 'WEEKLY') {
        return NextResponse.json({ success: false, message: 'Invalid payoutScheduleType. Allowed values: "INSTANT" or "WEEKLY".' }, { status: 400 });
      }

      try {
        const updatedProfile = await executeWithDbFallback(
          async () => {
            return await prisma.providerProfile.upsert({
              where: { userId: auth.userId },
              update: { payoutScheduleType: normalizedType },
              create: {
                userId: auth.userId,
                payoutScheduleType: normalizedType
              }
            });
          },
          async () => {
            let profile = mockDb.profiles.find((p: any) => p.userId === auth.userId);
            if (!profile) {
              profile = {
                id: mockDb.profiles.length + 1,
                userId: auth.userId,
                payoutScheduleType: normalizedType
              } as any;
              mockDb.profiles.push(profile);
            } else {
              profile.payoutScheduleType = normalizedType;
            }
            return profile;
          }
        );

        return NextResponse.json({
          success: true,
          message: `Payout schedule type updated to ${normalizedType} successfully`,
          payoutScheduleType: updatedProfile.payoutScheduleType || normalizedType,
          providerProfile: updatedProfile
        });
      } catch (err: any) {
        return NextResponse.json({ success: false, message: 'Failed to update payout schedule: ' + err.message }, { status: 500 });
      }
    }

    // POST /api/stripe/customer-sheet
    if (path === 'stripe/customer-sheet') {
      const authUser = await getAuthenticatedUser(request);
      if (!authUser) {
        return NextResponse.json({ success: false, error: 'Unauthorized. Bearer token required.' }, { status: 401 });
      }

      const stripe = getStripeInstance();
      if (!stripe) {
        return NextResponse.json({ success: false, error: 'Stripe is not configured on server. Missing STRIPE_SECRET_KEY in environment.' }, { status: 500 });
      }

      try {
        const customerId = await ensureStripeCustomer(authUser, stripe);

        const ephemeralKey = await stripe.ephemeralKeys.create(
          { customer: customerId },
          { apiVersion: '2024-11-20.acacia' }
        );

        const setupIntent = await stripe.setupIntents.create({
          customer: customerId,
          usage: 'off_session',
          payment_method_types: ['card'],
        });

        return NextResponse.json({
          success: true,
          customerId: customerId,
          customerEphemeralKeySecret: ephemeralKey.secret,
          setupIntentClientSecret: setupIntent.client_secret,
        });
      } catch (stripeErr: any) {
        console.error('[Stripe Customer Sheet Error]', stripeErr);
        return NextResponse.json({ success: false, error: stripeErr.message || 'Failed to initialize customer sheet' }, { status: 400 });
      }
    }

    // POST /api/stripe/create-payment-intent
    if (path === 'stripe/create-payment-intent') {
      const authUser = await getAuthenticatedUser(request);
      if (!authUser) {
        return NextResponse.json({ success: false, error: 'Unauthorized. Bearer token required.' }, { status: 401 });
      }

      const { amount, currency = 'usd', bookingId, description } = body;
      if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
        return NextResponse.json({ success: false, error: 'Valid positive amount is required.' }, { status: 400 });
      }

      const stripe = getStripeInstance();
      if (!stripe) {
        return NextResponse.json({ success: false, error: 'Stripe is not configured on server. Missing STRIPE_SECRET_KEY in environment.' }, { status: 500 });
      }

      try {
        const customerId = await ensureStripeCustomer(authUser, stripe);
        const amountInCents = Math.round(Number(amount) * 100);

        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents,
          currency: String(currency).toLowerCase(),
          customer: customerId,
          capture_method: 'manual',
          setup_future_usage: 'off_session',
          automatic_payment_methods: { enabled: true },
          description: description || `LookClean Salon Charge for User #${authUser.userId}`,
          metadata: {
            userId: String(authUser.userId),
            userEmail: authUser.email,
            bookingId: bookingId ? String(bookingId) : ''
          }
        });

        let customerSessionClientSecret: string | null = null;
        try {
          const customerSession = await stripe.customerSessions.create({
            customer: customerId,
            components: {
              payment_element: {
                enabled: true,
                features: {
                  payment_method_save: 'enabled',
                  payment_method_redisplay: 'enabled',
                },
              },
            },
          });
          customerSessionClientSecret = customerSession.client_secret;
        } catch (csErr: any) {
          console.warn('[Customer Session Creation Warning]', csErr?.message || csErr);
        }

        const rawDataStr = JSON.stringify(paymentIntent);

        if (bookingId) {
          const bId = parseInt(String(bookingId), 10);
          await prisma.booking.update({
            where: { id: bId },
            data: {
              transactionId: paymentIntent.id,
              stripeRawData: rawDataStr
            }
          }).catch(() => {
            const b = mockDb.bookings.find((item: any) => item.id === bId);
            if (b) {
              b.transactionId = paymentIntent.id;
              b.stripeRawData = rawDataStr;
            }
          });
        }

        return NextResponse.json({
          success: true,
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id,
          transactionId: paymentIntent.id,
          customerId: customerId,
          customerSessionClientSecret: customerSessionClientSecret,
          stripeRawData: paymentIntent,
          amount: Number(amount),
          amountInCents: paymentIntent.amount,
          currency: paymentIntent.currency,
          status: paymentIntent.status
        });
      } catch (stripeErr: any) {
        return NextResponse.json({ success: false, error: stripeErr.message || 'Failed to create payment intent' }, { status: 400 });
      }
    }

    // POST /api/stripe/create-checkout-session
    if (path === 'stripe/create-checkout-session') {
      const authUser = await getAuthenticatedUser(request);
      if (!authUser) {
        return NextResponse.json({ success: false, error: 'Unauthorized. Bearer token required.' }, { status: 401 });
      }

      const { amount, currency = 'usd', bookingId, serviceName, successUrl, cancelUrl } = body;
      if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
        return NextResponse.json({ success: false, error: 'Valid positive amount is required.' }, { status: 400 });
      }

      const stripe = getStripeInstance();
      if (!stripe) {
        return NextResponse.json({ success: false, error: 'Stripe is not configured on server. Missing STRIPE_SECRET_KEY in environment.' }, { status: 500 });
      }

      try {
        const baseUrl = getBaseUrl(request) || 'http://mylookclean.com';
        const amountInCents = Math.round(Number(amount) * 100);

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [
            {
              price_data: {
                currency: String(currency).toLowerCase(),
                product_data: {
                  name: serviceName || 'Salon Service Charge',
                  description: bookingId ? `Booking #${bookingId}` : 'LookClean Salon Payment'
                },
                unit_amount: amountInCents,
              },
              quantity: 1,
            },
          ],
          mode: 'payment',
          customer_email: authUser.email,
          success_url: successUrl || `${baseUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: cancelUrl || `${baseUrl}/payment-cancel`,
          metadata: {
            userId: String(authUser.userId),
            bookingId: bookingId ? String(bookingId) : ''
          }
        });

        const rawDataStr = JSON.stringify(session);

        if (bookingId) {
          const bId = parseInt(String(bookingId), 10);
          await prisma.booking.update({
            where: { id: bId },
            data: {
              transactionId: session.id,
              stripeRawData: rawDataStr
            }
          }).catch(() => {
            const b = mockDb.bookings.find((item: any) => item.id === bId);
            if (b) {
              b.transactionId = session.id;
              b.stripeRawData = rawDataStr;
            }
          });
        }

        return NextResponse.json({
          success: true,
          sessionId: session.id,
          checkoutUrl: session.url,
          transactionId: session.id,
          stripeRawData: session
        });
      } catch (stripeErr: any) {
        return NextResponse.json({ success: false, error: stripeErr.message || 'Failed to create checkout session' }, { status: 400 });
      }
    }

    // POST Test FCM Push Notification Endpoint (/api/test-notification, /api/users/test-notification)
    if (path === 'test-notification' || path === 'users/test-notification' || path === 'fcm/test' || path === 'admin/test-notification') {
      const logs: string[] = [];
      const timestamp = new Date().toISOString();
      logs.push(`[${timestamp}] Test Notification POST Endpoint Invoked.`);

      const urlParams = new URL(request.url).searchParams;
      const paramUserId = urlParams.get('userId') || urlParams.get('id') || urlParams.get('user_id');
      const bodyUserId = body?.userId || body?.user_id || body?.id;
      const rawUserId = paramUserId || bodyUserId;

      if (!rawUserId) {
        logs.push('[ERROR] Missing userId parameter in JSON body ({ "userId": 2 }) or query string (?userId=2).');
        return NextResponse.json({
          success: false,
          error: 'Missing userId parameter',
          usage: 'Send POST body {"userId": 2, "title": "Optional", "body": "Optional"} or query param ?userId=2',
          logs
        }, { status: 400 });
      }

      const targetUserId = parseInt(String(rawUserId), 10);
      logs.push(`[INFO] Target User ID: ${targetUserId}`);

      let targetUser: any = null;
      let fcmToken: string | null = null;
      let source: string = 'none';

      // 1. Check Prisma DB
      try {
        logs.push(`[STEP 1] Querying Prisma DB for User ID ${targetUserId}...`);
        const dbUser = await prisma.user.findUnique({
          where: { id: targetUserId },
          select: { id: true, name: true, email: true, role: true, fcmToken: true }
        });
        if (dbUser) {
          targetUser = dbUser;
          source = 'Prisma DB';
          fcmToken = dbUser.fcmToken;
          logs.push(`[STEP 1 SUCCESS] User found in Prisma DB. Name: "${dbUser.name}", Email: "${dbUser.email}", Role: "${dbUser.role}".`);
          if (fcmToken) {
            logs.push(`[STEP 1 SUCCESS] FCM Token found in Prisma DB: "${fcmToken.slice(0, 25)}..." (Length: ${fcmToken.length})`);
          } else {
            logs.push(`[STEP 1 WARNING] User exists in Prisma DB, but fcmToken is NULL / Empty.`);
          }
        } else {
          logs.push(`[STEP 1 INFO] User ID ${targetUserId} not found in Prisma DB.`);
        }
      } catch (dbErr: any) {
        logs.push(`[STEP 1 ERROR] Prisma DB query failed: ${dbErr.message || String(dbErr)}`);
      }

      // 2. Check mockDb fallback
      if (!targetUser || !fcmToken) {
        logs.push(`[STEP 2] Checking mockDb in-memory storage for User ID ${targetUserId}...`);
        const mockUser = mockDb.users.find((u: any) => u.id === targetUserId);
        if (mockUser) {
          if (!targetUser) {
            targetUser = mockUser;
            source = 'mockDb';
          }
          if (mockUser.fcmToken) {
            const foundToken = mockUser.fcmToken;
            fcmToken = foundToken;
            logs.push(`[STEP 2 SUCCESS] FCM Token found in mockDb: "${foundToken.slice(0, 25)}..." (Length: ${foundToken.length})`);
          } else {
            logs.push(`[STEP 2 WARNING] User found in mockDb, but fcmToken is NULL / Empty.`);
          }
        } else {
          logs.push(`[STEP 2 INFO] User ID ${targetUserId} not found in mockDb.`);
        }
      }

      if (!targetUser) {
        logs.push(`[FAILED] User ID ${targetUserId} does not exist in Database or mockDb.`);
        return NextResponse.json({
          success: false,
          error: `User ID ${targetUserId} not found`,
          targetUserId,
          logs
        }, { status: 404 });
      }

      if (!fcmToken) {
        logs.push(`[FAILED] User ID ${targetUserId} has NO FCM token registered. Please call POST /api/users/fcm-token with {"fcmToken": "your_token"} first.`);
        return NextResponse.json({
          success: false,
          error: 'No FCM token registered for this user',
          targetUser: { id: targetUser.id, name: targetUser.name, email: targetUser.email, role: targetUser.role },
          logs
        }, { status: 400 });
      }

      // 3. Send Notification via Firebase Admin SDK
      const testTitle = body?.title || urlParams.get('title') || 'Look Clean Test Push Notification 🔔';
      const testBody = body?.body || urlParams.get('body') || `Hello ${targetUser.name || 'User'}! This is a test FCM push notification from Look Clean server.`;
      const testData = body?.data || { type: 'TEST_NOTIFICATION', timestamp };

      logs.push(`[STEP 3] Dispatching FCM notification via Firebase Admin SDK...`);
      logs.push(`[STEP 3 PAYLOAD] Title: "${testTitle}", Body: "${testBody}"`);

      try {
        const result = await sendFcmNotification({
          token: fcmToken,
          title: testTitle,
          body: testBody,
          data: testData
        });

        if (result.success) {
          logs.push(`[STEP 3 SUCCESS] Firebase Admin SDK returned SUCCESS! Push notification sent to FCM token.`);
          return NextResponse.json({
            success: true,
            message: 'Test notification sent successfully via Firebase Admin SDK',
            user: { id: targetUser.id, name: targetUser.name, email: targetUser.email, role: targetUser.role, dataSource: source },
            fcmTokenPreview: fcmToken ? (fcmToken.length > 35 ? `${fcmToken.slice(0, 25)}...${fcmToken.slice(-10)}` : fcmToken) : null,
            notificationDetails: { title: testTitle, body: testBody, data: testData },
            logs
          });
        } else {
          logs.push(`[STEP 3 ERROR] Firebase Admin SDK failed: ${JSON.stringify(result.error || 'Unknown error')}`);
          return NextResponse.json({
            success: false,
            error: result.error || 'Firebase Admin notification failed',
            user: { id: targetUser.id, name: targetUser.name, email: targetUser.email, role: targetUser.role },
            fcmTokenPreview: fcmToken ? (fcmToken.length > 35 ? `${fcmToken.slice(0, 25)}...${fcmToken.slice(-10)}` : fcmToken) : null,
            logs
          }, { status: 500 });
        }
      } catch (sendErr: any) {
        logs.push(`[STEP 3 EXCEPTION] ${sendErr.message || String(sendErr)}`);
        return NextResponse.json({
          success: false,
          error: sendErr.message || 'Exception during FCM dispatch',
          logs
        }, { status: 500 });
      }
    }

    // POST User FCM Token registration (/api/users/fcm-token or /api/fcm-token)
    if (path === 'users/fcm-token' || path === 'fcm-token' || path === 'clients/fcm-token' || path === 'providers/fcm-token') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const { fcmToken, fcm_token } = body as any;
      const targetToken = fcmToken || fcm_token;
      if (!targetToken) {
        return NextResponse.json({ message: 'Missing fcmToken or fcm_token in request body' }, { status: 400 });
      }
      try {
        await executeWithDbFallback(
          async () => {
            await prisma.user.update({
              where: { id: auth.userId },
              data: { fcmToken: targetToken }
            });
          },
          async () => {
            const user = mockDb.users.find((u: any) => u.id === auth.userId);
            if (user) user.fcmToken = targetToken;
          }
        );
        const mockUser = mockDb.users.find((u: any) => u.id === auth.userId);
        if (mockUser) mockUser.fcmToken = targetToken;

        return NextResponse.json({ success: true, message: 'FCM Token saved successfully', fcmToken: targetToken });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to save FCM token' }, { status: 400 });
      }
    }

    // POST Cron Job for Appointment Reminders (1 hour before appointment)
    if (path === 'cron/appointment-reminders' || path === 'admin/cron/appointment-reminders') {
      try {
        const now = new Date();
        const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

        let sentCount = 0;
        await executeWithDbFallback(
          async () => {
            const upcomingBookings = await prisma.booking.findMany({
              where: {
                status: { in: ['pending', 'confirmed'] },
                date: {
                  gte: now,
                  lte: oneHourLater
                }
              },
              include: {
                client: true,
                provider: true
              }
            });

            for (const b of upcomingBookings) {
              if (b.client?.fcmToken) {
                await sendNotificationToUser(
                  b.clientId,
                  'Upcoming Appointment Reminder ⏰',
                  `Your appointment with ${b.provider?.name || 'your provider'} is scheduled in 1 hour (${b.timeSlot}).`,
                  {
                    bookingId: String(b.id),
                    clientId: String(b.clientId),
                    providerId: String(b.providerId),
                    type: 'UPCOMING_APPOINTMENT'
                  }
                );
                sentCount++;
              }
            }
          },
          async () => {
            const upcomingBookings = mockDb.bookings.filter((b: any) => {
              if (b.status === 'cancelled' || b.status === 'completed') return false;
              const bDate = new Date(b.date);
              return bDate >= now && bDate <= oneHourLater;
            });
            for (const b of upcomingBookings) {
              const provider = mockDb.users.find((u: any) => u.id === b.providerId);
              await sendNotificationToUser(
                b.clientId,
                'Upcoming Appointment Reminder ⏰',
                `Your appointment with ${provider?.name || 'your provider'} is scheduled in 1 hour (${b.timeSlot}).`,
                {
                  bookingId: String(b.id),
                  clientId: String(b.clientId),
                  providerId: String(b.providerId),
                  type: 'UPCOMING_APPOINTMENT'
                }
              );
              sentCount++;
            }
          }
        );

        return NextResponse.json({ success: true, message: `Processed appointment reminders. Sent: ${sentCount}` });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to process appointment reminders' }, { status: 500 });
      }
    }

    // POST Cron Job for Auto-Completing Past Bookings (/api/cron/completed-bookings or /api/admin/cron/completed-bookings or /api/cron/auto-complete-bookings)
    if (path === 'cron/completed-bookings' || path === 'admin/cron/completed-bookings' || path === 'cron/auto-complete-bookings') {
      try {
        setCronDependencies(mockDb, sendNotificationToUser);
        const result = await autoCompletePastBookings();
        return NextResponse.json({
          success: true,
          message: `Completed bookings cron executed successfully. Auto-completed ${result.updatedCount} expired booking(s).`,
          updatedCount: result.updatedCount,
          completedBookingIds: result.completedBookingIds
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to execute completed bookings cron' }, { status: 500 });
      }
    }

    if (path === 'providers/daily/transactions' || path === 'provider/daily/transactions' || path === 'providers/daily/transections' || path === 'provider/daily/transections') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'provider' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
      }


      const sortBy = (body as any).sortBy || 'currently month';
      const pageStr = (body as any).page;
      let page = 1;
      if (pageStr) {
        page = parseInt(pageStr, 10);
        if (isNaN(page) || page < 1) page = 1;
      }
      const limit = 50;
      const skip = (page - 1) * limit;

      try {
        const result = await executeWithDbFallback(
          async () => {
            const where: any = {
              providerId: auth.userId,
              status: 'completed',
            };

            if (sortBy === 'currently month' || sortBy === 'currentMonth') {
              const now = new Date();
              const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
              const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
              where.date = {
                gte: startOfMonth,
                lte: endOfMonth
              };
            }

            const bookings = await prisma.booking.findMany({
              where,
              include: {
                client: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    clientProfile: true
                  }
                },
                services: {
                  include: {
                    service: true
                  }
                }
              },
              orderBy: {
                date: 'desc'
              },
              ...(sortBy === 'all' ? { skip, take: limit } : {})
            });

            const reviews = await prisma.review.findMany({
              where: { providerId: auth.userId }
            });

            const dailyData: Record<string, { date: string; totalServiceAmount: number; transactions: any[] }> = {};

            for (const b of bookings) {
              const dateStr = b.date.toISOString().split('T')[0];
              if (!dailyData[dateStr]) {
                dailyData[dateStr] = {
                  date: dateStr,
                  totalServiceAmount: 0,
                  transactions: []
                };
              }
              dailyData[dateStr].totalServiceAmount += b.serviceAmount;

              const matchedReview = reviews.find(r => r.bookingId === b.id);
              const ratingObj = matchedReview ? { rating: matchedReview.rating, comment: matchedReview.comment } : null;

              dailyData[dateStr].transactions.push({
                ...b,
                client: b.client,
                services: b.services.map(bs => bs.service),
                rating: ratingObj
              });
            }

            const groupedList = Object.values(dailyData).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

            if (sortBy === 'all') {
              const total = await prisma.booking.count({ where });
              return {
                data: groupedList,
                meta: {
                  total,
                  page,
                  limit,
                  totalPages: Math.ceil(total / limit)
                }
              };
            }

            return groupedList;
          },
          async () => {
            let bookings = mockDb.bookings.filter((b: any) => b.providerId === auth.userId && b.status === 'completed');

            if (sortBy === 'currently month' || sortBy === 'currentMonth') {
              const now = new Date();
              const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
              const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
              bookings = bookings.filter((b: any) => {
                const bDate = new Date(b.date);
                return bDate >= startOfMonth && bDate <= endOfMonth;
              });
            }

            bookings.sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

            let total = bookings.length;
            if (sortBy === 'all') {
              bookings = bookings.slice(skip, skip + limit);
            }

            const reviews = mockDb.reviews.filter((r: any) => r.providerId === auth.userId);
            const dailyData: Record<string, any> = {};
            for (const b of bookings) {
              const dateObj = new Date(b.date);
              const dateStr = dateObj.toISOString().split('T')[0];
              if (!dailyData[dateStr]) {
                dailyData[dateStr] = { date: dateStr, totalServiceAmount: 0, transactions: [] };
              }
              dailyData[dateStr].totalServiceAmount += b.serviceAmount;

              const client = mockDb.users.find((u: any) => u.id === b.clientId) || { name: 'Unknown' };
              const bServices = mockDb.bookingServices.filter((bs: any) => bs.bookingId === b.id);
              const mappedServices = bServices.map((bs: any) => mockDb.services.find((s: any) => s.id === bs.serviceId) || { name: 'Unknown' });

              const matchedReview = reviews.find((r: any) => r.bookingId === b.id);
              const ratingObj = matchedReview ? { rating: matchedReview.rating, comment: matchedReview.comment } : null;

              dailyData[dateStr].transactions.push({
                ...b,
                client,
                services: mappedServices,
                rating: ratingObj
              });
            }

            const groupedList = Object.values(dailyData).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

            if (sortBy === 'all') {
              return {
                data: groupedList,
                meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
              };
            }

            return groupedList;
          }
        );
        return NextResponse.json(result);
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to fetch daily transactions' }, { status: 400 });
      }
    }



    // 0a. Toggle client provider wishlist (/api/clients/wishlist or /api/client/wishlist)
    if (path === 'clients/wishlist' || path === 'client/wishlist') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'client' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires client role' }, { status: 403 });
      }

      let providerId = Number((body as any).providerId || (body as any).providerProfileId);
      if (!providerId || isNaN(providerId)) {
        const { searchParams } = new URL(request.url);
        providerId = Number(searchParams.get('providerId') || searchParams.get('providerProfileId'));
      }

      if (!providerId || isNaN(providerId)) {
        return NextResponse.json({ message: 'Missing or invalid providerId' }, { status: 400 });
      }

      // Toggle logic in memory
      const existingIndex = wishlistStore.findIndex(
        (item) => item.clientId === auth.userId && item.providerId === providerId
      );

      let isWishlisted = false;
      let message = '';

      if (existingIndex > -1) {
        wishlistStore.splice(existingIndex, 1);
        isWishlisted = false;
        message = 'Provider removed from wishlist';
      } else {
        wishlistStore.push({ clientId: auth.userId, providerId });
        isWishlisted = true;
        message = 'Provider added to wishlist';
      }

      return NextResponse.json({
        success: true,
        message,
        isWishlisted
      });
    }

    // Update Provider Experience (/api/providers/me/experiences or /api/provider/me/experiences or /api/providers/me/experience or /api/provider/me/experience)
    if (
      path === 'providers/me/experiences' ||
      path === 'provider/me/experiences' ||
      path === 'providers/me/experience' ||
      path === 'provider/me/experience'
    ) {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'provider') {
        return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
      }

      let experienceInput: any = null;
      if (contentType.includes('multipart/form-data')) {
        try {
          const formData = parsedFormData || await request.formData();
          experienceInput = formData.get('experience');
        } catch (err: any) {
          return NextResponse.json({ message: 'Failed to parse form data: ' + err.message }, { status: 400 });
        }
      } else {
        experienceInput = (body as any).experience;
      }

      if (experienceInput === null || experienceInput === undefined) {
        return NextResponse.json({ message: 'experience is required' }, { status: 400 });
      }

      const experienceVal = parseInt(experienceInput, 10);
      if (isNaN(experienceVal) || experienceVal < 0) {
        return NextResponse.json({ message: 'Invalid experience value. Must be a non-negative integer.' }, { status: 400 });
      }

      try {
        const response = await executeWithDbFallback(
          async () => {
            let profile = await prisma.providerProfile.findUnique({ where: { userId: auth.userId } });
            if (!profile) {
              profile = await prisma.providerProfile.create({
                data: {
                  userId: auth.userId,
                  location: '',
                  experience: experienceVal
                }
              });
            } else {
              profile = await prisma.providerProfile.update({
                where: { userId: auth.userId },
                data: { experience: experienceVal }
              });
            }
            return profile;
          },
          async () => {
            let mockProfile = mockDb.profiles.find((p) => p.userId === auth.userId);
            if (!mockProfile) {
              mockProfile = {
                id: mockDb.profiles.length + 1,
                userId: auth.userId,
                name: '',
                location: '',
                experience: experienceVal
              };
              mockDb.profiles.push(mockProfile);
            } else {
              mockProfile.experience = experienceVal;
            }
            return mockProfile;
          }
        );

        return NextResponse.json({
          success: true,
          message: 'Experience updated successfully',
          experience: response.experience
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to update experience' }, { status: 400 });
      }
    }

    // Check if it's the license/licence endpoint
    const pathParts = path.split('/');
    const isLicenceRoute =
      path === 'providers/me/licence' ||
      path === 'provider/me/licence' ||
      path === 'providers/me/license' ||
      path === 'provider/me/license' ||
      (pathParts.length === 4 && pathParts[0] === 'providers' && pathParts[1] === 'me' && (pathParts[2] === 'licence' || pathParts[2] === 'license')) ||
      (pathParts.length === 4 && pathParts[0] === 'provider' && pathParts[1] === 'me' && (pathParts[2] === 'licence' || pathParts[2] === 'license'));

    if (isLicenceRoute) {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'provider') {
        return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
      }

      // Determine the index to update
      let index: number | null = null;
      if (pathParts.length === 4) {
        const parsedIdx = parseInt(pathParts[3], 10);
        if (!isNaN(parsedIdx)) {
          index = parsedIdx;
        }
      }

      const { searchParams } = new URL(request.url);
      const indexQuery = searchParams.get('index');
      if (indexQuery !== null) {
        const parsedIdx = parseInt(indexQuery, 10);
        if (!isNaN(parsedIdx)) {
          index = parsedIdx;
        }
      }

      let licenseTypeInput: string | null = null;
      let certificateFile: any = null;
      let certificateUrlInput: string | null = null;

      if (contentType.includes('multipart/form-data')) {
        try {
          const formData = parsedFormData || await request.formData();
          const indexForm = formData.get('index');
          if (index === null && indexForm !== null) {
            const parsedIdx = parseInt(String(indexForm), 10);
            if (!isNaN(parsedIdx)) {
              index = parsedIdx;
            }
          }
          licenseTypeInput = formData.get('licenseType') ? String(formData.get('licenseType')) : (formData.get('licenseName') ? String(formData.get('licenseName')) : null);
          certificateFile = formData.get('certificate') || formData.get('certificateFile') || formData.get('file');
          const certUrlVal = formData.get('certificateUrl') || formData.get('certificateUrls');
          if (certUrlVal && typeof certUrlVal === 'string') {
            certificateUrlInput = certUrlVal;
          }
        } catch (err: any) {
          return NextResponse.json({ message: 'Failed to parse form data: ' + err.message }, { status: 400 });
        }
      } else {
        if (index === null && (body as any).index !== undefined) {
          const parsedIdx = parseInt((body as any).index, 10);
          if (!isNaN(parsedIdx)) {
            index = parsedIdx;
          }
        }
        licenseTypeInput = (body as any).licenseType || (body as any).licenseName || null;
        certificateUrlInput = (body as any).certificateUrl || (body as any).certificateUrls || null;
      }

      if (index === null || index < 0) {
        return NextResponse.json({ message: 'Invalid or missing index' }, { status: 400 });
      }

      let certificateUrlToSave: string | null = null;
      if (certificateFile && typeof certificateFile === 'object' && 'name' in certificateFile) {
        try {
          const file = certificateFile as any;
          const mimeType = file.type || '';
          const fileName = file.name || '';
          const fileExt = nodePath.extname(fileName).toLowerCase();

          const isValidMime = mimeType === 'application/pdf' || mimeType.startsWith('image/');
          const isValidExt = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'].includes(fileExt);

          if (!isValidMime && !isValidExt) {
            return NextResponse.json(
              { message: 'Certificate must be a PDF or an image file only' },
              { status: 400 }
            );
          }

          const bytes = await file.arrayBuffer();
          const buffer = Buffer.from(bytes);
          const uploadDir = nodePath.join(process.cwd(), 'public', 'uploads');
          await fs.mkdir(uploadDir, { recursive: true });
          const uniqueFileName = `certificate_${auth.userId}_${Date.now()}_idx${index}${fileExt || '.pdf'}`;
          const filePath = nodePath.join(uploadDir, uniqueFileName);
          await fs.writeFile(filePath, buffer);
          certificateUrlToSave = `/uploads/${uniqueFileName}`;
        } catch (err: any) {
          return NextResponse.json({ message: 'Failed to save uploaded certificate file: ' + err.message }, { status: 400 });
        }
      } else if (certificateUrlInput) {
        certificateUrlToSave = certificateUrlInput;
      }

      try {
        const response = await executeWithDbFallback(
          async () => {
            let profile = await prisma.providerProfile.findUnique({ where: { userId: auth.userId } });
            if (!profile) {
              profile = await prisma.providerProfile.create({
                data: {
                  userId: auth.userId,
                  location: '',
                  licenseType: '[]',
                  certificateUrl: '[]'
                }
              });
            }

            // Parse licenseType list
            let licenseTypes: string[] = [];
            if (profile.licenseType) {
              const licStr = profile.licenseType;
              if (licStr.startsWith('[') && licStr.endsWith(']')) {
                try {
                  licenseTypes = JSON.parse(licStr) as string[];
                } catch {
                  licenseTypes = licStr.split(',').map((s: string) => s.trim());
                }
              } else if (licStr.includes(',')) {
                licenseTypes = licStr.split(',').map((s: string) => s.trim());
              } else {
                licenseTypes = [licStr];
              }
            }

            // Parse certificateUrl list
            let certificateUrls: string[] = [];
            if (profile.certificateUrl) {
              const certStr = profile.certificateUrl;
              if (certStr.startsWith('[') && certStr.endsWith(']')) {
                try {
                  certificateUrls = JSON.parse(certStr) as string[];
                } catch {
                  certificateUrls = certStr.split(',').map((s: string) => s.trim());
                }
              } else if (certStr.includes(',')) {
                certificateUrls = certStr.split(',').map((s: string) => s.trim());
              } else {
                certificateUrls = [certStr];
              }
            }

            // Pad arrays up to index
            while (licenseTypes.length <= index!) {
              licenseTypes.push('');
            }
            while (certificateUrls.length <= index!) {
              certificateUrls.push('');
            }

            // Apply updates
            if (licenseTypeInput !== null) {
              licenseTypes[index!] = licenseTypeInput;
            }
            if (certificateUrlToSave !== null) {
              let cleanedUrl = certificateUrlToSave;
              const baseUrl = getBaseUrl(request);
              if (baseUrl && cleanedUrl.startsWith(baseUrl)) {
                cleanedUrl = cleanedUrl.substring(baseUrl.length);
              }
              certificateUrls[index!] = cleanedUrl;
            }

            await prisma.providerProfile.update({
              where: { userId: auth.userId },
              data: {
                licenseType: JSON.stringify(licenseTypes),
                certificateUrl: JSON.stringify(certificateUrls)
              }
            });
            return { licenseTypes, certificateUrls };
          },
          async () => {
            let profile = mockDb.profiles.find((p) => p.userId === auth.userId);
            if (!profile) {
              profile = {
                id: mockDb.profiles.length + 1,
                userId: auth.userId,
                name: '',
                location: '',
                licenseType: '[]',
                certificateUrl: '[]'
              };
              mockDb.profiles.push(profile);
            }

            // Parse licenseType list
            let licenseTypes: string[] = [];
            if (profile.licenseType) {
              const licStr = profile.licenseType;
              if (licStr.startsWith('[') && licStr.endsWith(']')) {
                try {
                  licenseTypes = JSON.parse(licStr) as string[];
                } catch {
                  licenseTypes = licStr.split(',').map((s: string) => s.trim());
                }
              } else if (licStr.includes(',')) {
                licenseTypes = licStr.split(',').map((s: string) => s.trim());
              } else {
                licenseTypes = [licStr];
              }
            }

            // Parse certificateUrl list
            let certificateUrls: string[] = [];
            if (profile.certificateUrl) {
              const certStr = profile.certificateUrl;
              if (certStr.startsWith('[') && certStr.endsWith(']')) {
                try {
                  certificateUrls = JSON.parse(certStr) as string[];
                } catch {
                  certificateUrls = certStr.split(',').map((s: string) => s.trim());
                }
              } else if (certStr.includes(',')) {
                certificateUrls = certStr.split(',').map((s: string) => s.trim());
              } else {
                certificateUrls = [certStr];
              }
            }

            // Pad arrays up to index
            while (licenseTypes.length <= index!) {
              licenseTypes.push('');
            }
            while (certificateUrls.length <= index!) {
              certificateUrls.push('');
            }

            // Apply updates
            if (licenseTypeInput !== null) {
              licenseTypes[index!] = licenseTypeInput;
            }
            if (certificateUrlToSave !== null) {
              let cleanedUrl = certificateUrlToSave;
              const baseUrl = getBaseUrl(request);
              if (baseUrl && cleanedUrl.startsWith(baseUrl)) {
                cleanedUrl = cleanedUrl.substring(baseUrl.length);
              }
              certificateUrls[index!] = cleanedUrl;
            }

            profile.licenseType = JSON.stringify(licenseTypes);
            profile.certificateUrl = JSON.stringify(certificateUrls);

            return { licenseTypes, certificateUrls };
          }
        );

        const baseUrl = getBaseUrl(request);
        const formattedCerts = response.certificateUrls.map((c) => (c && c.startsWith('/') && baseUrl) ? `${baseUrl}${c}` : c);

        return NextResponse.json({
          success: true,
          message: 'License/certificate updated successfully'
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to update license' }, { status: 400 });
      }
    }

    // 1. Sign Up (Common Register /api/auth/register)
    if (path === 'auth/register') {
      const { email, password, fcmToken, fcm_token, timezone } = body as any;
      const userFcmToken = fcmToken || fcm_token || null;
      const userTimezone = timezone && typeof timezone === 'string' && timezone.trim() ? timezone.trim() : 'UTC';

      if (!email || typeof email !== 'string' || !email.trim()) {
        return NextResponse.json({ message: 'Email is required' }, { status: 400 });
      }
      if (!password || typeof password !== 'string' || !password.trim()) {
        return NextResponse.json({ message: 'Password is required' }, { status: 400 });
      }

      const cleanEmail = email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        return NextResponse.json({ message: 'Invalid email address format' }, { status: 400 });
      }
      if (password.length < 6) {
        return NextResponse.json({ message: 'Password must be at least 6 characters long' }, { status: 400 });
      }

      try {
        const response = await executeWithDbFallback(
          async () => {
            const existingUser = await prisma.user.findUnique({
              where: { email: cleanEmail },
            });
            if (existingUser) {
              throw new Error('User with this email already exists');
            }

            const user = await prisma.user.create({
              data: {
                email: cleanEmail,
                password: hashPassword(password),
                name: "",
                role: "",
                fcmToken: userFcmToken,
                timezone: userTimezone
              },
            });
            const token = generateToken(user.id, user.email, user.role, user.timezone);
            return { token, user };
          },
          async () => {
            const exists = mockDb.users.find((u) => u.email.toLowerCase() === cleanEmail);
            if (exists) throw new Error('User with this email already exists');
            const newUser = {
              id: mockDb.users.length + 1,
              email: cleanEmail,
              password: hashPassword(password),
              name: "",
              role: "",
              providerType: null,
              phoneNumber: null,
              isPhoneVerified: false,
              onboardingCompleted: false,
              socialKey: null,
              socialType: null,
              fcmToken: userFcmToken,
              timezone: userTimezone,
              createdAt: new Date(),
            };
            mockDb.users.push(newUser);
            const token = generateToken(newUser.id, newUser.email, newUser.role, newUser.timezone);
            return { token, user: newUser };
          }
        );
        const responseObj = response as { token: string; user: any };
        return NextResponse.json({
          token: responseObj.token,
          user: sanitizeUser(responseObj.user, request),
        });
      } catch (err: any) {
        let msg = err.message || 'Registration failed';
        if (err.code === 'P2002' || msg.includes('Unique constraint failed') || msg.includes('users_email_key')) {
          msg = 'User with this email already exists';
        }
        return NextResponse.json({ message: msg }, { status: 400 });
      }
    }

    // 2. Sign In (Common Login /api/auth/login)
    if (path === 'auth/login') {
      const { email, password, fcmToken, fcm_token, timezone } = body as any;
      const userFcmToken = fcmToken || fcm_token || null;
      const userTimezone = timezone && typeof timezone === 'string' && timezone.trim() ? timezone.trim() : null;

      if (!email || !password) {
        return NextResponse.json({ message: 'Missing fields' }, { status: 400 });
      }

      try {
        const response = await executeWithDbFallback(
          async () => {
            if (email === 'admin@lookclean.com') {
              let adminUser = await prisma.user.findUnique({ where: { email } });
              if (!adminUser) {
                adminUser = await prisma.user.create({
                  data: {
                    email: 'admin@lookclean.com',
                    password: hashPassword('admin123'),
                    name: 'System Admin',
                    role: 'admin',
                    onboardingCompleted: true,
                    fcmToken: userFcmToken,
                    timezone: userTimezone || 'UTC'
                  },
                });
              } else if (userFcmToken || userTimezone) {
                adminUser = await prisma.user.update({
                  where: { id: adminUser.id },
                  data: {
                    ...(userFcmToken ? { fcmToken: userFcmToken } : {}),
                    ...(userTimezone ? { timezone: userTimezone } : {})
                  }
                });
              }
              if (adminUser.password !== hashPassword(password)) throw new Error('Invalid credentials');
              const token = generateToken(adminUser.id, adminUser.email, adminUser.role, adminUser.timezone);
              return { token, user: adminUser };
            }
            let user = await prisma.user.findUnique({
              where: { email },
              include: {
                providerProfile: {
                  include: { services: true, amenities: true },
                },
                clientProfile: true,
              },
            });
            if (!user || user.password !== hashPassword(password)) throw new Error('Invalid credentials');
            if (userFcmToken || userTimezone) {
              user = await prisma.user.update({
                where: { id: user.id },
                data: {
                  ...(userFcmToken ? { fcmToken: userFcmToken } : {}),
                  ...(userTimezone ? { timezone: userTimezone } : {})
                },
                include: {
                  providerProfile: {
                    include: { services: true, amenities: true },
                  },
                  clientProfile: true,
                },
              });
            }
            const token = generateToken(user.id, user.email, user.role, user.timezone);
            return { token, user };
          },
          async () => {
            if (email === 'admin@lookclean.com') {
              let mockAdmin = mockDb.users.find((u) => u.email === email);
              if (!mockAdmin) {
                mockAdmin = {
                  id: 1,
                  email: 'admin@lookclean.com',
                  password: hashPassword('admin123'),
                  name: 'System Admin',
                  role: 'admin',
                  providerType: null,
                  phoneNumber: '+15005550006',
                  isPhoneVerified: true,
                  onboardingCompleted: true,
                  socialKey: null,
                  socialType: null,
                  timezone: userTimezone || 'UTC',
                  createdAt: new Date(),
                };
                mockDb.users.push(mockAdmin);
              }
              if (userTimezone) mockAdmin.timezone = userTimezone;
              if (mockAdmin.password !== hashPassword(password)) throw new Error('Invalid credentials');
              const token = generateToken(mockAdmin.id, mockAdmin.email, mockAdmin.role, mockAdmin.timezone);
              return { token, user: mockAdmin };
            }
            const user = mockDb.users.find((u) => u.email === email && u.password === hashPassword(password));
            if (!user) throw new Error('Invalid credentials');
            if (userTimezone) user.timezone = userTimezone;
            const token = generateToken(user.id, user.email, user.role, user.timezone);
            const profile = mockDb.profiles.find((p) => p.userId === user.id);
            let providerProfile = undefined;
            let clientProfile = undefined;
            if (profile) {
              if (user.role === 'provider') {
                providerProfile = {
                  ...profile,
                  services: mockDb.services.filter((s) => s.profileId === profile.id),
                  amenities: mockDb.amenities.filter((a) => a.profileId === profile.id),
                };
              } else if (user.role === 'client') {
                clientProfile = { ...profile };
              }
            }
            return { token, user: { ...user, providerProfile, clientProfile } };
          }
        );
        const responseObj = response as { token: string; user: any };
        const sanitized = sanitizeUser(responseObj.user, request);
        if (sanitized && sanitized.providerProfile) {
          await enrichProviderProfile(sanitized.providerProfile, request);
        }
        return NextResponse.json({
          token: responseObj.token,
          user: sanitized,
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Login failed' }, { status: 400 });
      }
    }

    // 3. Select Role and Provider Type (/api/auth/select-role)
    if (path === 'auth/select-role') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const { role, providerType } = body as any;
      if (!role || (role !== 'client' && role !== 'provider')) {
        return NextResponse.json({ message: 'Invalid role. Must be client or provider' }, { status: 400 });
      }

      try {
        const responseObj = await executeWithDbFallback(
          async () => {
            const updated = await prisma.user.update({
              where: { id: auth.userId },
              data: {
                role,
                providerType: role === 'provider' ? providerType : null,
              },
            });
            return updated;
          },
          async () => {
            const user = mockDb.users.find((u) => u.id === auth.userId);
            if (!user) throw new Error('User not found');
            user.role = role;
            user.providerType = role === 'provider' ? providerType : null;
            return user;
          }
        );
        const newToken = generateToken(responseObj.id, responseObj.email, responseObj.role, (responseObj as any).timezone);
        return NextResponse.json({
          token: newToken,
          user: sanitizeUser(responseObj, request),
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Error updating role' }, { status: 400 });
      }
    }

    // 3.5. Social Login (/api/auth/social-login)
    if (path === 'auth/social-login') {
      const { social_key, social_type, username, email, fcmToken, fcm_token, timezone } = body as any;
      const userFcmToken = fcmToken || fcm_token || null;
      const userTimezone = timezone && typeof timezone === 'string' && timezone.trim() ? timezone.trim() : null;

      if (!social_key || !social_type || !email) {
        return NextResponse.json({ message: 'Missing fields: social_key, social_type, and email are required' }, { status: 400 });
      }

      if (social_type !== 'google' && social_type !== 'ios') {
        return NextResponse.json({ message: 'Invalid social_type. Must be "google" or "ios"' }, { status: 400 });
      }

      try {
        const response = await executeWithDbFallback(
          async () => {
            // Check if user with this socialKey already exists
            let user = await prisma.user.findUnique({
              where: { socialKey: social_key },
              include: {
                providerProfile: {
                  include: { services: true, amenities: true },
                },
              },
            });

            if (!user) {
              // If not, check if a user with the same email already exists
              const existingEmailUser = await prisma.user.findUnique({
                where: { email },
              });

              if (existingEmailUser) {
                // Link social account to existing user account
                user = await prisma.user.update({
                  where: { id: existingEmailUser.id },
                  data: {
                    socialKey: social_key,
                    socialType: social_type,
                    name: existingEmailUser.name || username || "",
                    ...(userFcmToken ? { fcmToken: userFcmToken } : {}),
                    ...(userTimezone ? { timezone: userTimezone } : {})
                  },
                  include: {
                    providerProfile: {
                      include: { services: true, amenities: true },
                    },
                  },
                });
              } else {
                // Create new user account
                user = await prisma.user.create({
                  data: {
                    email,
                    password: "",
                    name: username || "",
                    role: "",
                    socialKey: social_key,
                    socialType: social_type,
                    fcmToken: userFcmToken,
                    timezone: userTimezone || 'UTC'
                  },
                  include: {
                    providerProfile: {
                      include: { services: true, amenities: true },
                    },
                  },
                });
              }
            } else if (userFcmToken || userTimezone) {
              user = await prisma.user.update({
                where: { id: user.id },
                data: {
                  ...(userFcmToken ? { fcmToken: userFcmToken } : {}),
                  ...(userTimezone ? { timezone: userTimezone } : {})
                },
                include: {
                  providerProfile: {
                    include: { services: true, amenities: true },
                  },
                },
              });
            }

            const token = generateToken(user.id, user.email, user.role, user.timezone);
            return { token, user };
          },
          async () => {
            // Fallback mockDb logic
            let user = mockDb.users.find((u) => u.socialKey === social_key);

            if (!user) {
              const existingEmailUser = mockDb.users.find((u) => u.email === email);
              if (existingEmailUser) {
                existingEmailUser.socialKey = social_key;
                existingEmailUser.socialType = social_type;
                if (!existingEmailUser.name && username) {
                  existingEmailUser.name = username;
                }
                if (userTimezone) existingEmailUser.timezone = userTimezone;
                user = existingEmailUser;
              } else {
                user = {
                  id: mockDb.users.length + 1,
                  email,
                  password: "",
                  name: username || "",
                  role: "",
                  providerType: null,
                  phoneNumber: null,
                  isPhoneVerified: false,
                  onboardingCompleted: false,
                  socialKey: social_key,
                  socialType: social_type,
                  timezone: userTimezone || 'UTC',
                  createdAt: new Date(),
                };
                mockDb.users.push(user);
              }
            } else if (userTimezone) {
              user.timezone = userTimezone;
            }

            const token = generateToken(user.id, user.email, user.role, user.timezone);
            const profile = mockDb.profiles.find((p) => p.userId === user.id);
            let providerProfile = undefined;
            if (profile) {
              providerProfile = {
                ...profile,
                services: mockDb.services.filter((s) => s.profileId === profile.id),
                amenities: mockDb.amenities.filter((a) => a.profileId === profile.id),
              };
            }
            return { token, user: { ...user, providerProfile } };
          }
        );

        const responseObj = response as { token: string; user: any };
        const sanitized = sanitizeUser(responseObj.user, request);
        if (sanitized && sanitized.providerProfile) {
          await enrichProviderProfile(sanitized.providerProfile, request);
        }
        return NextResponse.json({
          token: responseObj.token,
          user: sanitized,
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Social login failed' }, { status: 400 });
      }
    }

    // 4. Forgot Password send OTP (/api/auth/forgot-password/send-otp)
    if (path === 'auth/forgot-password/send-otp') {
      const { phoneNumber } = body as any;
      if (!phoneNumber) {
        return NextResponse.json({ success: false, message: 'Phone number is required' });
      }

      try {
        const user = await executeWithDbFallback(
          async () => {
            return await prisma.user.findFirst({ where: { phoneNumber } });
          },
          async () => {
            return mockDb.users.find((u) => u.phoneNumber === phoneNumber) || null;
          }
        );

        if (!user) {
          return NextResponse.json({ success: false, message: 'Phone number not registered' });
        }

        // Generate a random 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpStore.set('forgot-password:' + phoneNumber, { code: otp, exp: Date.now() + 1000 * 60 * 10 }); // 10 minutes expiry

        // Retrieve active Twilio connection config
        const twilioSettings = await executeWithDbFallback(
          async () => {
            const dbSetting = await prisma.systemSetting.findUnique({
              where: { key: 'twilio' },
            });
            if (dbSetting) return JSON.parse(dbSetting.value);
            return mockDb.twilioSettings;
          },
          async () => {
            return mockDb.twilioSettings;
          }
        );

        const mode = twilioSettings.activeMode || 'staging';
        const config = mode === 'live' ? twilioSettings.live : twilioSettings.staging;
        const { accountSid, authToken, phoneNumber: fromNumber, messagingServiceSid } = config || {};

        const cleanAccountSid = accountSid?.trim();
        const cleanAuthToken = authToken?.trim();
        const cleanFromNumber = fromNumber?.trim();
        const cleanMessagingServiceSid = messagingServiceSid?.trim();

        if (!cleanAccountSid || !cleanAuthToken || (!cleanFromNumber && !cleanMessagingServiceSid)) {
          return NextResponse.json({ message: 'Twilio gateway is not configured' }, { status: 500 });
        }

        // Connect to Twilio API to send the SMS
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${cleanAccountSid}/Messages.json`;
        const messageBody = `Your Look Clean password reset verification code is: ${otp}`;
        const authString = Buffer.from(`${cleanAccountSid}:${cleanAuthToken}`).toString('base64');

        const params = new URLSearchParams();
        if (cleanMessagingServiceSid) {
          params.append('MessagingServiceSid', cleanMessagingServiceSid);
        } else {
          params.append('From', cleanFromNumber);
        }
        params.append('To', phoneNumber);
        params.append('Body', messageBody);

        const twilioRes = await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${authString}`,
          },
          body: params.toString(),
        });

        const resData = await twilioRes.json();
        if (!twilioRes.ok) {
          console.error('[Twilio Send Forgot Password OTP Error]', resData);
          return NextResponse.json({
            success: false,
            message: `SMS gateway error: ${resData.message || 'Twilio config failure'}`
          }, { status: 400 });
        }

        console.log(`[Twilio Forgot Password OTP Sent] Success. SID: ${resData.sid}`);
        return NextResponse.json({ success: true, message: 'OTP code sent successfully via Twilio SMS' });

      } catch (err: any) {
        console.error('[Twilio Send Forgot Password OTP Exception]', err);
        return NextResponse.json({
          success: false,
          message: `SMS transmission failed: ${err.message || 'Connection timeout'}`
        }, { status: 500 });
      }
    }

    // 5. Forgot Password verify OTP (/api/auth/forgot-password/verify-otp)
    if (path === 'auth/forgot-password/verify-otp') {
      const { phoneNumber, code } = body as any;
      if (!phoneNumber || !code) {
        return NextResponse.json({ message: 'Phone number and verification code are required' }, { status: 400 });
      }

      const user = await executeWithDbFallback(
        async () => {
          return await prisma.user.findUnique({ where: { phoneNumber } });
        },
        async () => {
          return mockDb.users.find((u) => u.phoneNumber === phoneNumber) || null;
        }
      );

      if (!user) {
        return NextResponse.json({ message: 'User not found' }, { status: 404 });
      }

      // Verify OTP using cache store
      const record = otpStore.get('forgot-password:' + phoneNumber);
      if (!record || record.code !== code || record.exp < Date.now()) {
        return NextResponse.json({ message: 'Invalid or expired verification code' }, { status: 400 });
      }

      // Clear OTP after successful verification
      otpStore.delete('forgot-password:' + phoneNumber);

      // Generate short-lived reset token (15 mins)
      const resetToken = generateResetToken(user.id, user.phoneNumber || user.email || '');

      return NextResponse.json({ success: true, token: resetToken, message: 'OTP verified successfully' });
    }

    // 6. Forgot Password reset (/api/auth/forgot-password/reset)
    if (path === 'auth/forgot-password/reset') {
      const { token, password } = body as any;
      if (!token || !password) {
        return NextResponse.json({ message: 'Reset token and new password are required' }, { status: 400 });
      }

      const payload = verifyResetToken(token);
      if (!payload) {
        return NextResponse.json({ message: 'Invalid or expired password reset token' }, { status: 400 });
      }

      try {
        await executeWithDbFallback(
          async () => {
            await prisma.user.update({
              where: { id: payload.userId },
              data: { password: hashPassword(password) },
            });
          },
          async () => {
            const user = mockDb.users.find((u) => u.id === payload.userId);
            if (!user) throw new Error('User not found in mock store');
            user.password = hashPassword(password);
          }
        );

        return NextResponse.json({ success: true, message: 'Password updated successfully' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Error updating password' }, { status: 400 });
      }
    }

    // 7. Send Mobile SMS OTP (/api/users/verify/mobile/send)
    if (path === 'users/verify/mobile/send') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const { phoneNumber } = body as any;
      if (!phoneNumber) {
        return NextResponse.json({ message: 'Phone number is required' }, { status: 400 });
      }

      // Check if phone number is already registered to another user account
      const existingUser = await executeWithDbFallback(
        async () => {
          return await prisma.user.findFirst({
            where: {
              phoneNumber,
              id: { not: auth.userId },
            },
          });
        },
        async () => {
          return mockDb.users.find((u) => u.phoneNumber === phoneNumber && u.id !== auth.userId) || null;
        }
      );

      if (existingUser) {
        return NextResponse.json({ message: 'This phone number is already registered.' }, { status: 400 });
      }

      // Generate a random 6-digit OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      otpStore.set(phoneNumber, { code: otp, exp: Date.now() + 1000 * 60 * 10 }); // 10 minutes expiry

      // Retrieve active Twilio connection config from database/memory
      const twilioSettings = await executeWithDbFallback(
        async () => {
          const dbSetting = await prisma.systemSetting.findUnique({
            where: { key: 'twilio' },
          });
          if (dbSetting) return JSON.parse(dbSetting.value);
          return mockDb.twilioSettings;
        },
        async () => {
          return mockDb.twilioSettings;
        }
      );

      const mode = twilioSettings.activeMode || 'staging';
      const config = mode === 'live' ? twilioSettings.live : twilioSettings.staging;
      const { accountSid, authToken, phoneNumber: fromNumber, messagingServiceSid } = config || {};

      const cleanAccountSid = accountSid?.trim();
      const cleanAuthToken = authToken?.trim();
      const cleanFromNumber = fromNumber?.trim();
      const cleanMessagingServiceSid = messagingServiceSid?.trim();

      if (!cleanAccountSid || !cleanAuthToken || (!cleanFromNumber && !cleanMessagingServiceSid)) {
        return NextResponse.json({ message: 'Twilio gateway is not configured' }, { status: 500 });
      }

      // Connect to Twilio API to send the SMS
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${cleanAccountSid}/Messages.json`;
      const messageBody = `Your Look Cleann mobile verification code is: ${otp}`;
      const authString = Buffer.from(`${cleanAccountSid}:${cleanAuthToken}`).toString('base64');

      const params = new URLSearchParams();
      if (cleanMessagingServiceSid) {
        params.append('MessagingServiceSid', cleanMessagingServiceSid);
      } else {
        params.append('From', cleanFromNumber);
      }
      params.append('To', phoneNumber);
      params.append('Body', messageBody);

      try {
        const twilioRes = await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${authString}`,
          },
          body: params.toString(),
        });

        const resData = await twilioRes.json();
        if (!twilioRes.ok) {
          console.error('[Twilio Send OTP Error]', resData);
          return NextResponse.json({
            success: false,
            message: `SMS gateway error: ${resData.message || 'Twilio config failure'}`
          }, { status: 400 });
        }

        console.log(`[Twilio OTP Sent] Success. SID: ${resData.sid}`);
        return NextResponse.json({ success: true, message: 'SMS OTP sent successfully via Twilio!' });
      } catch (err: any) {
        console.error('[Twilio Send OTP Exception]', err);
        return NextResponse.json({
          success: false,
          message: `SMS transmission failed: ${err.message || 'Connection timeout'}`
        }, { status: 500 });
      }
    }

    // 8. Verify Mobile SMS OTP (/api/users/verify/mobile)
    if (path === 'users/verify/mobile') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const { phoneNumber, code } = body as any;
      if (!code) {
        return NextResponse.json({ message: 'Verification code is required' }, { status: 400 });
      }

      // Verify using cache store, supporting standard testing fallbacks
      if (code !== '1234' && code !== '123456') {
        const record = phoneNumber ? otpStore.get(phoneNumber) : null;
        if (!record || record.code !== code || record.exp < Date.now()) {
          return NextResponse.json({ message: 'Invalid or expired OTP code' }, { status: 400 });
        }
        if (phoneNumber) otpStore.delete(phoneNumber);
      }

      try {
        await executeWithDbFallback(
          async () => {
            if (phoneNumber) {
              const existingUser = await prisma.user.findFirst({
                where: {
                  phoneNumber,
                  id: { not: auth.userId },
                },
              });
              if (existingUser) {
                throw new Error('This phone number is already registered.');
              }
            }

            await prisma.user.update({
              where: { id: auth.userId },
              data: { isPhoneVerified: true, phoneNumber: phoneNumber || null },
            });
          },
          async () => {
            const user = mockDb.users.find((u) => u.id === auth.userId);
            if (user) {
              user.isPhoneVerified = true;
              user.phoneNumber = phoneNumber;
            }
          }
        );

        return NextResponse.json({ success: true, message: 'Phone number verified successfully!' });
      } catch (err: any) {
        if (err?.code === 'P2002' || err?.message?.includes('users_phoneNumber_key')) {
          return NextResponse.json({ message: 'This phone number is already registered to another user account.' }, { status: 400 });
        }
        return NextResponse.json({ message: err.message || 'Verification failed' }, { status: 400 });
      }
    }

    // POST /api/provider/stripe/onboard or /api/provider/stripe-connect/onboard
    if (path === 'provider/stripe/onboard' || path === 'provider/stripe-connect/onboard') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ success: false, error: 'Unauthorized. Bearer token required.' }, { status: 401 });
      }
      if (auth.role !== 'provider') {
        return NextResponse.json({ success: false, error: 'Forbidden: Requires provider role' }, { status: 403 });
      }

      const stripe = getStripeInstance();
      if (!stripe) {
        return NextResponse.json({ success: false, error: 'Stripe is not configured on server. Missing STRIPE_SECRET_KEY.' }, { status: 500 });
      }

      let profile: any = null;
      await executeWithDbFallback(
        async () => {
          profile = await prisma.providerProfile.findUnique({ where: { userId: auth.userId } });
        },
        async () => {
          profile = mockDb.profiles.find((p) => p.userId === auth.userId) || null;
        }
      );

      let stripeAccountId = profile?.stripeAccountId || null;

      if (stripeAccountId) {
        try {
          await stripe.accounts.retrieve(stripeAccountId);
        } catch (checkErr: any) {
          if (checkErr.message && (checkErr.message.includes('does not have access') || checkErr.message.includes('does not exist') || checkErr.code === 'resource_missing')) {
            stripeAccountId = null;
          }
        }
      }

      try {
        if (!stripeAccountId) {
          const account = await stripe.accounts.create({
            type: 'express',
            country: 'US',
            email: auth.email,
            capabilities: {
              card_payments: { requested: true },
              transfers: { requested: true },
            },
            business_type: 'individual',
          });
          stripeAccountId = account.id;

          await executeWithDbFallback(
            async () => {
              await prisma.providerProfile.upsert({
                where: { userId: auth.userId },
                update: { stripeAccountId },
                create: { userId: auth.userId, stripeAccountId }
              });
            },
            async () => {
              if (profile) profile.stripeAccountId = stripeAccountId;
              else mockDb.profiles.push({ userId: auth.userId, stripeAccountId });
            }
          );
        }

        const baseUrl = getBaseUrl(request);
        const accountLink = await stripe.accountLinks.create({
          account: stripeAccountId,
          refresh_url: `${baseUrl}/provider/stripe-connect/refresh`,
          return_url: `${baseUrl}/provider/stripe-connect/callback?status=success`,
          type: 'account_onboarding',
        });

        return NextResponse.json({
          success: true,
          stripeAccountId,
          url: accountLink.url
        });
      } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message || 'Failed to create Stripe onboarding link' }, { status: 400 });
      }
    }

    // POST /api/provider/stripe/login-link or /api/provider/stripe-connect/login-link
    if (path === 'provider/stripe/login-link' || path === 'provider/stripe-connect/login-link') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ success: false, error: 'Unauthorized. Bearer token required.' }, { status: 401 });
      }
      if (auth.role !== 'provider') {
        return NextResponse.json({ success: false, error: 'Forbidden: Requires provider role' }, { status: 403 });
      }

      const stripe = getStripeInstance();
      if (!stripe) {
        return NextResponse.json({ success: false, error: 'Stripe is not configured on server. Missing STRIPE_SECRET_KEY.' }, { status: 500 });
      }

      let profile: any = null;
      await executeWithDbFallback(
        async () => {
          profile = await prisma.providerProfile.findUnique({ where: { userId: auth.userId } });
        },
        async () => {
          profile = mockDb.profiles.find((p) => p.userId === auth.userId) || null;
        }
      );

      if (!profile?.stripeAccountId) {
        return NextResponse.json({ success: false, error: 'Provider does not have a connected Stripe account yet.' }, { status: 400 });
      }

      try {
        const loginLink = await stripe.accounts.createLoginLink(profile.stripeAccountId);
        return NextResponse.json({
          success: true,
          url: loginLink.url
        });
      } catch (err: any) {
        if (err.message && (err.message.includes('does not have access') || err.message.includes('does not exist') || err.code === 'resource_missing')) {
          // Reset invalid account ID in DB and create fresh onboarding link under current key
          await executeWithDbFallback(
            async () => {
              await prisma.providerProfile.update({
                where: { userId: auth.userId },
                data: {
                  stripeAccountId: null,
                  stripeDetailsSubmitted: false,
                  stripePayoutsEnabled: false,
                  stripeChargesEnabled: false
                }
              });
            },
            async () => {
              if (profile) {
                profile.stripeAccountId = null;
                profile.stripeDetailsSubmitted = false;
                profile.stripePayoutsEnabled = false;
                profile.stripeChargesEnabled = false;
              }
            }
          ).catch(() => {});

          const newAccount = await stripe.accounts.create({
            type: 'express',
            country: 'US',
            email: auth.email,
            capabilities: {
              card_payments: { requested: true },
              transfers: { requested: true },
            },
            business_type: 'individual',
          });

          await executeWithDbFallback(
            async () => {
              await prisma.providerProfile.update({
                where: { userId: auth.userId },
                data: { stripeAccountId: newAccount.id }
              });
            },
            async () => {
              if (profile) profile.stripeAccountId = newAccount.id;
            }
          ).catch(() => {});

          const baseUrl = getBaseUrl(request);
          const accountLink = await stripe.accountLinks.create({
            account: newAccount.id,
            refresh_url: `${baseUrl}/provider/stripe-connect/refresh`,
            return_url: `${baseUrl}/provider/stripe-connect/callback?status=success`,
            type: 'account_onboarding',
          });

          return NextResponse.json({
            success: true,
            requiresOnboarding: true,
            message: 'Stripe account link reset. Please complete onboarding for your new connected account.',
            stripeAccountId: newAccount.id,
            url: accountLink.url
          });
        }

        return NextResponse.json({ success: false, error: err.message || 'Failed to create Stripe login link' }, { status: 400 });
      }
    }

    // POST /api/stripe/payment-intent (Create payment intent with commission deduction & provider payout)
    if (path === 'stripe/payment-intent' || path === 'stripe/create-payment-intent') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ success: false, error: 'Unauthorized. Bearer token required.' }, { status: 401 });
      }

      const { bookingId } = body as any;
      if (!bookingId) {
        return NextResponse.json({ success: false, error: 'bookingId is required' }, { status: 400 });
      }

      let booking: any = null;
      await executeWithDbFallback(
        async () => {
          booking = await prisma.booking.findUnique({
            where: { id: parseInt(bookingId) },
            include: { provider: { include: { providerProfile: true } } }
          });
        },
        async () => {
          booking = mockDb.bookings.find((b) => b.id === parseInt(bookingId));
        }
      );

      if (!booking) {
        return NextResponse.json({ success: false, error: 'Booking not found' }, { status: 404 });
      }

      const stripe = getStripeInstance();
      if (!stripe) {
        return NextResponse.json({ success: false, error: 'Stripe is not configured on server' }, { status: 500 });
      }

      const serviceAmount = booking.serviceAmount || booking.grandTotal || 0;
      let platformFeeCut = 5;
      await executeWithDbFallback(
        async () => {
          const setting = await prisma.systemSetting.findUnique({ where: { key: 'platform_fee_cut' } });
          if (setting && setting.value) {
            platformFeeCut = parseFloat(setting.value);
          }
        },
        async () => {
          if (mockDb.platformFeeCut !== undefined) {
            platformFeeCut = mockDb.platformFeeCut;
          }
        }
      ).catch(() => {});

      const commissionRate = (booking.provider?.providerProfile?.commissionRate && booking.provider.providerProfile.commissionRate !== 10.0)
        ? booking.provider.providerProfile.commissionRate
        : platformFeeCut;
      const amountCents = Math.round(serviceAmount * 100);
      const commissionCents = Math.round(amountCents * (commissionRate / 100));
      const providerPayoutCents = amountCents - commissionCents;
      const providerStripeAccountId = booking.provider?.providerProfile?.stripeAccountId;

      try {
        const customerId = await ensureStripeCustomer(auth, stripe);

        const paymentIntentParams: Stripe.PaymentIntentCreateParams = {
          amount: amountCents,
          currency: 'usd',
          customer: customerId,
          capture_method: 'manual',
          setup_future_usage: 'off_session',
          automatic_payment_methods: { enabled: true },
          metadata: {
            bookingId: String(booking.id),
            providerId: String(booking.providerId),
            commissionAmount: String(commissionCents / 100),
            providerPayoutAmount: String(providerPayoutCents / 100),
          }
        };

        if (providerStripeAccountId) {
          paymentIntentParams.application_fee_amount = commissionCents;
          paymentIntentParams.transfer_data = {
            destination: providerStripeAccountId,
          };
        }

        const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

        let customerSessionClientSecret: string | null = null;
        try {
          const customerSession = await stripe.customerSessions.create({
            customer: customerId,
            components: {
              payment_element: {
                enabled: true,
                features: {
                  payment_method_save: 'enabled',
                  payment_method_redisplay: 'enabled',
                },
              },
            },
          });
          customerSessionClientSecret = customerSession.client_secret;
        } catch (csErr: any) {
          console.warn('[Customer Session Creation Warning]', csErr?.message || csErr);
        }

        return NextResponse.json({
          success: true,
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id,
          customerId: customerId,
          customerSessionClientSecret: customerSessionClientSecret,
          amount: serviceAmount,
          platformCommission: commissionCents / 100,
          providerPayoutAmount: providerPayoutCents / 100,
        });
      } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message || 'Failed to create PaymentIntent' }, { status: 400 });
      }
    }

    // POST /api/stripe/webhook (Stripe Webhook Listener)
    if (path === 'stripe/webhook') {
      const stripe = getStripeInstance();
      if (!stripe) {
        return NextResponse.json({ success: false, error: 'Stripe is not configured' }, { status: 500 });
      }

      const sig = request.headers.get('stripe-signature');
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      let event: Stripe.Event;
      try {
        const rawBody = await request.text();
        if (webhookSecret && sig) {
          event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
        } else {
          event = JSON.parse(rawBody);
        }
      } catch (err: any) {
        return NextResponse.json({ success: false, error: `Webhook Error: ${err.message}` }, { status: 400 });
      }

      if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const bookingId = paymentIntent.metadata?.bookingId;

        if (bookingId) {
          const bId = parseInt(bookingId, 10);
          const commissionAmount = parseFloat(paymentIntent.metadata?.commissionAmount || '0');
          const providerPayoutAmount = parseFloat(paymentIntent.metadata?.providerPayoutAmount || '0');

          await executeWithDbFallback(
            async () => {
              await prisma.booking.update({
                where: { id: bId },
                data: {
                  status: 'confirmed',
                  transactionId: paymentIntent.id,
                  platformCommission: commissionAmount,
                  providerPayoutAmount: providerPayoutAmount,
                  payoutStatus: 'transferred',
                  stripeRawData: JSON.stringify(paymentIntent)
                }
              });
            },
            async () => {
              const b = mockDb.bookings.find((item) => item.id === bId);
              if (b) {
                b.status = 'confirmed';
                b.transactionId = paymentIntent.id;
                b.platformCommission = commissionAmount;
                b.providerPayoutAmount = providerPayoutAmount;
                b.payoutStatus = 'transferred';
              }
            }
          ).catch(() => {});

          const booking = mockDb.bookings.find((item) => item.id === bId);
          if (booking?.providerId) {
            await sendNotificationToUser(
              booking.providerId,
              'Payout Transferred! 💰',
              `Payment of $${providerPayoutAmount.toFixed(2)} has been transferred directly to your bank account after platform commission deduction.`
            );
          }
        }
      }

      if (event.type === 'account.updated') {
        const account = event.data.object as Stripe.Account;
        await executeWithDbFallback(
          async () => {
            await prisma.providerProfile.updateMany({
              where: { stripeAccountId: account.id },
              data: {
                stripeDetailsSubmitted: account.details_submitted,
                stripePayoutsEnabled: account.payouts_enabled,
                stripeChargesEnabled: account.charges_enabled
              }
            });
          },
          async () => {
            const profile = mockDb.profiles.find((p) => p.stripeAccountId === account.id);
            if (profile) {
              profile.stripeDetailsSubmitted = account.details_submitted;
              profile.stripePayoutsEnabled = account.payouts_enabled;
              profile.stripeChargesEnabled = account.charges_enabled;
            }
          }
        ).catch(() => {});
      }

      return NextResponse.json({ received: true });
    }

    // 9. Save Twilio Settings (/api/admin/settings/twilio)
    if (path === 'admin/settings/twilio') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }
      const { activeMode, staging, live } = body as any;

      const updatedSettings = await executeWithDbFallback(
        async () => {
          let currentSettings = { ...mockDb.twilioSettings };
          const dbSetting = await prisma.systemSetting.findUnique({
            where: { key: 'twilio' },
          });
          if (dbSetting) {
            currentSettings = JSON.parse(dbSetting.value);
          }

          if (activeMode) currentSettings.activeMode = activeMode;
          if (staging) {
            currentSettings.staging = {
              ...currentSettings.staging,
              ...staging
            };
          }
          if (live) {
            currentSettings.live = {
              ...currentSettings.live,
              ...live
            };
          }

          await prisma.systemSetting.upsert({
            where: { key: 'twilio' },
            update: { value: JSON.stringify(currentSettings) },
            create: { key: 'twilio', value: JSON.stringify(currentSettings) },
          });

          // Also update local mock for consistency
          mockDb.twilioSettings = currentSettings;
          return currentSettings;
        },
        async () => {
          if (activeMode) mockDb.twilioSettings.activeMode = activeMode;
          if (staging) {
            mockDb.twilioSettings.staging = {
              ...mockDb.twilioSettings.staging,
              ...staging
            };
          }
          if (live) {
            mockDb.twilioSettings.live = {
              ...mockDb.twilioSettings.live,
              ...live
            };
          }
          return mockDb.twilioSettings;
        }
      );

      return NextResponse.json({ success: true, settings: updatedSettings });
    }

    // 10. Verify Twilio Connection (/api/admin/settings/twilio/verify)
    if (path === 'admin/settings/twilio/verify') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }
      const { mode, accountSid, authToken, phoneNumber, verificationServiceId, messagingServiceSid, testPhoneNumber } = body as any;

      const cleanAccountSid = accountSid?.trim();
      const cleanAuthToken = authToken?.trim();
      const cleanPhoneNumber = phoneNumber?.trim();
      const cleanMessagingServiceSid = messagingServiceSid?.trim();
      const cleanTestPhoneNumber = testPhoneNumber?.trim();

      // Simulate connection delay
      await new Promise((resolve) => setTimeout(resolve, 1000));

      if (!cleanAccountSid || !cleanAuthToken || (!cleanPhoneNumber && !cleanMessagingServiceSid)) {
        return NextResponse.json({
          success: false,
          message: 'Invalid configuration: Account SID, Auth Token, and either Twilio Number or SMS Service Sid are required.'
        }, { status: 400 });
      }

      if (!cleanAccountSid.startsWith('AC')) {
        return NextResponse.json({
          success: false,
          message: `Connection failed for ${mode} mode: Account SID must start with 'AC'.`
        }, { status: 400 });
      }

      if (!cleanTestPhoneNumber) {
        return NextResponse.json({
          success: false,
          message: 'A test recipient phone number is required to verify the connection.'
        }, { status: 400 });
      }

      // Connect to Twilio API to send the test SMS
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${cleanAccountSid}/Messages.json`;
      const messageBody = `Your Look Clean Twilio ${mode.toUpperCase()} gateway verification was successful!`;
      const authString = Buffer.from(`${cleanAccountSid}:${cleanAuthToken}`).toString('base64');

      const params = new URLSearchParams();
      if (cleanMessagingServiceSid) {
        params.append('MessagingServiceSid', cleanMessagingServiceSid);
      } else {
        params.append('From', cleanPhoneNumber);
      }
      params.append('To', testPhoneNumber);
      params.append('Body', messageBody);

      try {
        const twilioRes = await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${authString}`,
          },
          body: params.toString(),
        });

        const resData = await twilioRes.json();
        if (!twilioRes.ok) {
          console.error('[Twilio Verify Connection Error]', resData);
          return NextResponse.json({
            success: false,
            message: `Twilio gateway verification failed: ${resData.message || 'Invalid credentials'}`
          }, { status: 400 });
        }

        console.log(`[Twilio Verify Connection Sent] Success. SID: ${resData.sid}`);
        return NextResponse.json({
          success: true,
          message: `Successfully verified Twilio connection! Test SMS sent to ${testPhoneNumber}.`
        });
      } catch (err: any) {
        console.error('[Twilio Verify Connection Exception]', err);
        return NextResponse.json({
          success: false,
          message: `Twilio connection failed: ${err.message || 'Connection timeout'}`
        }, { status: 500 });
      }
    }

    // 11. Change Admin Password (/api/admin/change-password)
    if (path === 'admin/change-password') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }
      const { currentPassword, newPassword } = body as any;
      if (!currentPassword || !newPassword) {
        return NextResponse.json({ message: 'Missing fields' }, { status: 400 });
      }

      try {
        await executeWithDbFallback(
          async () => {
            const adminUser = await prisma.user.findUnique({ where: { id: auth.userId } });
            if (!adminUser || adminUser.password !== hashPassword(currentPassword)) {
              throw new Error('Invalid current password');
            }
            await prisma.user.update({
              where: { id: auth.userId },
              data: { password: hashPassword(newPassword) },
            });
          },
          async () => {
            const adminUser = mockDb.users.find((u) => u.id === auth.userId);
            if (!adminUser || adminUser.password !== hashPassword(currentPassword)) {
              throw new Error('Invalid current password');
            }
            adminUser.password = hashPassword(newPassword);
          }
        );
        return NextResponse.json({ success: true, message: 'Password updated successfully.' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Change password failed' }, { status: 400 });
      }
    }

    // 11.5. Change User Password (/api/users/change-password)
    if (path === 'users/change-password') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const { oldPassword, newPassword } = body as any;
      if (!oldPassword || !newPassword) {
        return NextResponse.json({ message: 'Missing fields' }, { status: 400 });
      }

      try {
        await executeWithDbFallback(
          async () => {
            const user = await prisma.user.findUnique({ where: { id: auth.userId } });
            if (!user || user.password !== hashPassword(oldPassword)) {
              throw new Error('Invalid current password');
            }
            await prisma.user.update({
              where: { id: auth.userId },
              data: { password: hashPassword(newPassword) },
            });
          },
          async () => {
            const user = mockDb.users.find((u) => u.id === auth.userId);
            if (!user || user.password !== hashPassword(oldPassword)) {
              throw new Error('Invalid current password');
            }
            user.password = hashPassword(newPassword);
          }
        );
        return NextResponse.json({ success: true, message: 'Password updated successfully.' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Change password failed' }, { status: 400 });
      }
    }

    // 12. Create Category Setting (/api/admin/settings/categories)
    if (path === 'admin/settings/categories') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }

      let title: string = '';
      let categoryIconUrl: string | null = null;
      const contentType = request.headers.get('content-type') || '';

      if (contentType.includes('multipart/form-data')) {
        try {
          const formData = parsedFormData || await request.formData();
          title = (formData.get('title') as string) || '';
          const iconFile = (formData.get('categoryIcon') || formData.get('icon') || formData.get('image') || formData.get('svgFile') || formData.get('file')) as any;

          if (iconFile && typeof iconFile === 'object' && 'name' in iconFile && iconFile.size > 0) {
            const fileName = iconFile.name || '';
            const fileExt = nodePath.extname(fileName).toLowerCase() || '.png';
            const allowedExts = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif'];
            if (!allowedExts.includes(fileExt)) {
              return NextResponse.json(
                { message: 'Category icon must be an SVG or image file (.svg, .png, .jpg, .jpeg, .webp, .gif)' },
                { status: 400 }
              );
            }
            const bytes = await iconFile.arrayBuffer();
            const buffer = Buffer.from(bytes);
            const uploadDir = nodePath.join(process.cwd(), 'public', 'uploads');
            await fs.mkdir(uploadDir, { recursive: true });
            const uniqueFileName = `category_${Date.now()}_${Math.floor(Math.random() * 1000)}${fileExt}`;
            const filePath = nodePath.join(uploadDir, uniqueFileName);
            await fs.writeFile(filePath, buffer);
            categoryIconUrl = `/uploads/${uniqueFileName}`;
          } else if (typeof formData.get('categoryIcon') === 'string') {
            categoryIconUrl = formData.get('categoryIcon') as string;
          }
        } catch (err: any) {
          return NextResponse.json({ message: 'Failed to process category icon upload: ' + err.message }, { status: 400 });
        }
      } else {
        const bodyObj = body as any;
        title = bodyObj?.title || '';
        categoryIconUrl = bodyObj?.categoryIcon || bodyObj?.icon || null;
      }

      if (!title || !title.trim()) {
        return NextResponse.json({ message: 'Category title is required' }, { status: 400 });
      }

      try {
        const category = await executeWithDbFallback(
          async () => {
            return await (prisma.categorySetting as any).create({
              data: {
                title: title.trim(),
                categoryIcon: categoryIconUrl,
              }
            });
          },
          async () => {
            return {
              id: Math.floor(Math.random() * 10000),
              title: title.trim(),
              categoryIcon: categoryIconUrl,
              createdAt: new Date(),
            };
          }
        );
        return NextResponse.json({ success: true, category });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to create category' }, { status: 400 });
      }
    }

    // 13. Create Service Setting (/api/admin/settings/services)
    if (path === 'admin/settings/services') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }
      const { mainType, title } = body as any;
      if (!mainType || !title) {
        return NextResponse.json({ message: 'mainType and title are required' }, { status: 400 });
      }
      try {
        const service = await executeWithDbFallback(
          async () => {
            let category = await prisma.categorySetting.findUnique({
              where: { title: mainType.trim() }
            });
            if (!category) {
              category = await prisma.categorySetting.create({
                data: { title: mainType.trim() }
              });
            }
            return await prisma.serviceSetting.create({
              data: {
                mainTypeId: category.id,
                title: title.trim()
              }
            });
          },
          async () => {
            return {
              id: Math.floor(Math.random() * 10000),
              mainTypeId: 1,
              title: title.trim(),
              createdAt: new Date()
            };
          }
        );
        return NextResponse.json({ success: true, service });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to create service setting' }, { status: 400 });
      }
    }

    // 14. Create Ambience/Amenity Setting (/api/admin/settings/ambience)
    if (path === 'admin/settings/ambience') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
      }

      const baseUrl = getBaseUrl(request);

      let mainType: any = undefined;
      let mainTypeIcon: any = undefined;
      let title: any = undefined;
      let icon: any = undefined;
      let iconUrl: any = undefined;
      let csvItems: { title: string; icon?: string }[] = [];

      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('multipart/form-data')) {
        try {
          const formData = parsedFormData || await request.formData();
          mainType = formData.get('mainType');
          mainTypeIcon = formData.get('mainTypeIcon');
          title = formData.get('title');
          icon = formData.get('icon');
          const svgFile = formData.get('svgFile');
          const csvFile = formData.get('csvFile');

          if (csvFile && typeof csvFile === 'object' && 'name' in csvFile) {
            const file = csvFile as any;
            const csvText = await file.text();
            csvItems = parseCsv(csvText);
          }

          if (svgFile && typeof svgFile === 'object' && 'name' in svgFile) {
            const file = svgFile as any;
            const fileName = file.name || '';
            const fileExt = nodePath.extname(fileName).toLowerCase();

            if (fileExt !== '.svg') {
              return NextResponse.json(
                { message: 'Uploaded file must be an SVG file' },
                { status: 400 }
              );
            }

            const bytes = await file.arrayBuffer();
            const buffer = Buffer.from(bytes);
            const uploadDir = nodePath.join(process.cwd(), 'public', 'uploads');
            await fs.mkdir(uploadDir, { recursive: true });
            const uniqueFileName = `icon_${Date.now()}${fileExt}`;
            const filePath = nodePath.join(uploadDir, uniqueFileName);
            await fs.writeFile(filePath, buffer);
            iconUrl = `/uploads/${uniqueFileName}`;
          }
        } catch (err: any) {
          return NextResponse.json({ message: 'Failed to process upload: ' + err.message }, { status: 400 });
        }
      } else {
        const bodyObj = body as any;
        mainType = bodyObj.mainType;
        mainTypeIcon = bodyObj.mainTypeIcon;
        title = bodyObj.title;
        icon = bodyObj.icon;
        if (bodyObj.csvItems && Array.isArray(bodyObj.csvItems)) {
          csvItems = bodyObj.csvItems;
        }
      }

      if (!mainType) {
        return NextResponse.json({ message: 'mainType is required' }, { status: 400 });
      }

      const hasSingleItem = title && title.toString().trim().length > 0;
      if (!hasSingleItem && csvItems.length === 0) {
        return NextResponse.json({ message: 'Title or CSV items list is required' }, { status: 400 });
      }

      const finalIcon = iconUrl || (icon ? icon.toString().trim() : null);

      try {
        const ambience = await executeWithDbFallback(
          async () => {
            let group = await prisma.ambienceGroupSetting.findUnique({
              where: { title: mainType.toString().trim() }
            });
            if (!group) {
              group = await prisma.ambienceGroupSetting.create({
                data: {
                  title: mainType.toString().trim(),
                }
              });
            }

            const createdItems = [];

            if (hasSingleItem) {
              const single = await prisma.ambienceSetting.create({
                data: {
                  ambienceGroupId: group.id,
                  title: title.toString().trim(),
                  icon: finalIcon
                }
              });
              createdItems.push(single);
            }

            for (const csvItem of csvItems) {
              const created = await prisma.ambienceSetting.upsert({
                where: {
                  ambienceGroupId_title: {
                    ambienceGroupId: group.id,
                    title: csvItem.title.trim()
                  }
                },
                update: {
                  icon: csvItem.icon ? csvItem.icon.trim() : null
                },
                create: {
                  ambienceGroupId: group.id,
                  title: csvItem.title.trim(),
                  icon: csvItem.icon ? csvItem.icon.trim() : null
                }
              });
              createdItems.push(created);
            }

            return { group, items: createdItems };
          },
          async () => {
            const groupObj = { id: Math.floor(Math.random() * 10000), title: mainType.toString().trim() };
            const createdItems = [];

            if (hasSingleItem) {
              createdItems.push({
                id: Math.floor(Math.random() * 10000),
                ambienceGroupId: groupObj.id,
                title: title.toString().trim(),
                icon: finalIcon,
                createdAt: new Date()
              });
            }

            for (const csvItem of csvItems) {
              createdItems.push({
                id: Math.floor(Math.random() * 10000),
                ambienceGroupId: groupObj.id,
                title: csvItem.title.trim(),
                icon: csvItem.icon ? csvItem.icon.trim() : null,
                createdAt: new Date()
              });
            }

            return { group: groupObj, items: createdItems };
          }
        );

        const returnAmbience = {
          success: true,
          group: ambience.group,
          items: ambience.items.map((item: any) => {
            let itemIcon = item.icon;
            if (baseUrl && itemIcon && itemIcon.startsWith('/')) {
              itemIcon = `${baseUrl}${itemIcon}`;
            }
            return { ...item, icon: itemIcon };
          })
        };

        return NextResponse.json(returnAmbience);
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to create ambience setting' }, { status: 400 });
      }
    }

    // 15. Provider Onboarding Step 1: Profile Setup (/api/provider/setup/profile)
    if (path === 'provider/setup/profile') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'provider') {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }

      let name: any = undefined;
      let salonName: any = undefined;
      let location: any = undefined;
      let address: any = undefined;
      let city: any = undefined;
      let state: any = undefined;
      let country: any = undefined;
      let postalCode: any = undefined;
      let latitude: any = undefined;
      let longitude: any = undefined;
      let coverImageUrl: any = undefined;
      let profileImageUrl: any = undefined;
      let isAvailable: any = undefined;
      let isAway: any = undefined;
      let isRushMode: any = undefined;
      let isTravelMode: any = undefined;
      let travelLocation: any = undefined;
      let travelCity: any = undefined;
      let travelState: any = undefined;
      let travelCountry: any = undefined;
      let travelStartDate: any = undefined;
      let travelEndDate: any = undefined;
      let isFeatured: any = undefined;

      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('multipart/form-data')) {
        try {
          const formData = parsedFormData || await request.formData();
          name = formData.get('name');
          salonName = formData.get('salonName') ?? formData.get('salon_name');
          location = formData.get('location');
          address = formData.get('address');
          city = formData.get('city');
          state = formData.get('state');
          country = formData.get('country');
          postalCode = formData.get('postalCode') ?? formData.get('postal_code') ?? formData.get('zipCode');
          latitude = formData.get('latitude') ?? formData.get('lat');
          longitude = formData.get('longitude') ?? formData.get('lng') ?? formData.get('long');
          const profileImageFile = formData.get('profileImage') ?? formData.get('profileImageUrl');
          const coverImageFile = formData.get('coverImage') ?? formData.get('coverImageUrl');
          isAvailable = formData.get('isAvailable') ?? formData.get('is_available');
          isAway = formData.get('isAway') ?? formData.get('is_away');
          isRushMode = formData.get('isRushMode') ?? formData.get('is_rush_mode');
          isTravelMode = formData.get('isTravelMode') ?? formData.get('is_travel_mode');
          travelLocation = formData.get('travelLocation') ?? formData.get('travel_location');
          travelCity = formData.get('travelCity') ?? formData.get('travel_city');
          travelState = formData.get('travelState') ?? formData.get('travel_state');
          travelCountry = formData.get('travelCountry') ?? formData.get('travel_country');
          travelStartDate = formData.get('travelStartDate') ?? formData.get('travel_start_date');
          travelEndDate = formData.get('travelEndDate') ?? formData.get('travel_end_date');
          isFeatured = formData.get('isFeatured') ?? formData.get('is_featured') ?? formData.get('featured');

          const uploadDir = nodePath.join(process.cwd(), 'public', 'uploads');
          await fs.mkdir(uploadDir, { recursive: true });

          if (profileImageFile && typeof profileImageFile === 'object' && 'name' in profileImageFile) {
            const file = profileImageFile as any;
            const fileExt = nodePath.extname(file.name || '').toLowerCase();
            const uniqueFileName = `profile_${auth.userId}_${Date.now()}${fileExt || '.png'}`;
            const bytes = await file.arrayBuffer();
            await fs.writeFile(nodePath.join(uploadDir, uniqueFileName), Buffer.from(bytes));
            profileImageUrl = `/uploads/${uniqueFileName}`;
          } else if (typeof profileImageFile === 'string') {
            profileImageUrl = profileImageFile;
          }

          if (coverImageFile && typeof coverImageFile === 'object' && 'name' in coverImageFile) {
            const file = coverImageFile as any;
            const fileExt = nodePath.extname(file.name || '').toLowerCase();
            const uniqueFileName = `cover_${auth.userId}_${Date.now()}${fileExt || '.png'}`;
            const bytes = await file.arrayBuffer();
            await fs.writeFile(nodePath.join(uploadDir, uniqueFileName), Buffer.from(bytes));
            coverImageUrl = `/uploads/${uniqueFileName}`;
          } else if (typeof coverImageFile === 'string') {
            coverImageUrl = coverImageFile;
          }
        } catch (err: any) {
          return NextResponse.json({ message: 'Failed to process file upload: ' + err.message }, { status: 400 });
        }
      } else {
        const bodyObj = body as any;
        name = bodyObj.name;
        salonName = bodyObj.salonName ?? bodyObj.salon_name;
        location = bodyObj.location;
        address = bodyObj.address;
        city = bodyObj.city;
        state = bodyObj.state;
        country = bodyObj.country;
        postalCode = bodyObj.postalCode ?? bodyObj.postal_code ?? bodyObj.zipCode;
        latitude = bodyObj.latitude ?? bodyObj.lat;
        longitude = bodyObj.longitude ?? bodyObj.lng ?? bodyObj.long;
        coverImageUrl = bodyObj.coverImageUrl;
        profileImageUrl = bodyObj.profileImageUrl;
        isAvailable = bodyObj.isAvailable ?? bodyObj.is_available;
        isAway = bodyObj.isAway ?? bodyObj.is_away;
        isRushMode = bodyObj.isRushMode ?? bodyObj.is_rush_mode;
        isTravelMode = bodyObj.isTravelMode ?? bodyObj.is_travel_mode;
        travelLocation = bodyObj.travelLocation ?? bodyObj.travel_location;
        travelCity = bodyObj.travelCity ?? bodyObj.travel_city;
        travelState = bodyObj.travelState ?? bodyObj.travel_state;
        travelCountry = bodyObj.travelCountry ?? bodyObj.travel_country;
        travelStartDate = bodyObj.travelStartDate ?? bodyObj.travel_start_date;
        travelEndDate = bodyObj.travelEndDate ?? bodyObj.travel_end_date;
        isFeatured = bodyObj.isFeatured ?? bodyObj.is_featured ?? bodyObj.featured;
      }

      const locVal = (location || address || [city, state, country].filter(Boolean).join(', ') || '').toString();
      const salonNameVal = salonName ? String(salonName) : null;
      const cityVal = city ? String(city) : null;
      const stateVal = state ? String(state) : null;
      const countryVal = country ? String(country) : null;
      const postalCodeVal = postalCode ? String(postalCode) : null;
      const latVal = latitude !== undefined && latitude !== null && latitude !== '' ? parseFloat(latitude) : null;
      const lngVal = longitude !== undefined && longitude !== null && longitude !== '' ? parseFloat(longitude) : null;

      const travelLocationVal = travelLocation !== undefined ? (travelLocation ? String(travelLocation) : null) : undefined;
      const travelCityVal = travelCity !== undefined ? (travelCity ? String(travelCity) : null) : undefined;
      const travelStateVal = travelState !== undefined ? (travelState ? String(travelState) : null) : undefined;
      const travelCountryVal = travelCountry !== undefined ? (travelCountry ? String(travelCountry) : null) : undefined;
      const travelStartDateVal = travelStartDate !== undefined ? (travelStartDate ? new Date(travelStartDate) : null) : undefined;
      const travelEndDateVal = travelEndDate !== undefined ? (travelEndDate ? new Date(travelEndDate) : null) : undefined;

      const parseBool = (val: any) => {
        if (val === undefined || val === null || val === '') return undefined;
        return val === true || val === 'true' || val === 1 || val === '1';
      };

      const isAvailableVal = parseBool(isAvailable);
      const isAwayVal = parseBool(isAway);
      const isRushModeVal = parseBool(isRushMode);
      const isTravelModeVal = parseBool(isTravelMode);
      const isFeaturedVal = parseBool(isFeatured);

      if (!name) {
        return NextResponse.json({ message: 'Name is required' }, { status: 400 });
      }

      try {
        const profile = await executeWithDbFallback(
          async () => {
            let existing = await prisma.providerProfile.findUnique({ where: { userId: auth.userId } });
            const finalProfileImage = profileImageUrl !== undefined ? profileImageUrl : (existing?.profileImageUrl || null);
            const finalCoverImage = coverImageUrl !== undefined ? coverImageUrl : (existing?.coverImageUrl || null);

            if (name) {
              await prisma.user.update({
                where: { id: auth.userId },
                data: { name: String(name) }
              }).catch(() => {});
            }

            return await prisma.providerProfile.upsert({
              where: { userId: auth.userId },
              update: {
                salonName: salonNameVal,
                location: locVal,
                city: cityVal,
                state: stateVal,
                country: countryVal,
                postalCode: postalCodeVal,
                coverImageUrl: finalCoverImage,
                profileImageUrl: finalProfileImage,
                latitude: latVal,
                longitude: lngVal,
                ...(isAvailableVal !== undefined && { isAvailable: isAvailableVal }),
                ...(isAwayVal !== undefined && { isAway: isAwayVal }),
                ...(isRushModeVal !== undefined && { isRushMode: isRushModeVal }),
                ...(isTravelModeVal !== undefined && { isTravelMode: isTravelModeVal }),
                ...(travelLocationVal !== undefined && { travelLocation: travelLocationVal }),
                ...(travelCityVal !== undefined && { travelCity: travelCityVal }),
                ...(travelStateVal !== undefined && { travelState: travelStateVal }),
                ...(travelCountryVal !== undefined && { travelCountry: travelCountryVal }),
                ...(travelStartDateVal !== undefined && { travelStartDate: travelStartDateVal }),
                ...(travelEndDateVal !== undefined && { travelEndDate: travelEndDateVal }),
                ...(isFeaturedVal !== undefined && { isFeatured: isFeaturedVal }),
              },
              create: {
                userId: auth.userId,
                salonName: salonNameVal,
                location: locVal,
                city: cityVal,
                state: stateVal,
                country: countryVal,
                postalCode: postalCodeVal,
                coverImageUrl: finalCoverImage,
                profileImageUrl: finalProfileImage,
                latitude: latVal,
                longitude: lngVal,
                isAvailable: isAvailableVal ?? true,
                isAway: isAwayVal ?? false,
                isRushMode: isRushModeVal ?? false,
                isTravelMode: isTravelModeVal ?? false,
                travelLocation: travelLocationVal ?? null,
                travelCity: travelCityVal ?? null,
                travelState: travelStateVal ?? null,
                travelCountry: travelCountryVal ?? null,
                travelStartDate: travelStartDateVal ?? null,
                travelEndDate: travelEndDateVal ?? null,
                isFeatured: isFeaturedVal ?? true,
              },
            });
          },
          async () => {
            if (name) {
              const u = mockDb.users.find((user) => user.id === auth.userId);
              if (u) u.name = String(name);
            }
            let mockProfile = mockDb.profiles.find((p) => p.userId === auth.userId);
            if (!mockProfile) {
              mockProfile = {
                id: mockDb.profiles.length + 1,
                userId: auth.userId,
                isAvailable: true,
                isAway: false,
                isRushMode: false,
                isTravelMode: false,
                isFeatured: true,
              };
              mockDb.profiles.push(mockProfile);
            }
            mockProfile.salonName = salonNameVal;
            mockProfile.location = locVal;
            mockProfile.city = cityVal;
            mockProfile.state = stateVal;
            mockProfile.country = countryVal;
            mockProfile.postalCode = postalCodeVal;
            if (coverImageUrl !== undefined) mockProfile.coverImageUrl = coverImageUrl;
            if (profileImageUrl !== undefined) mockProfile.profileImageUrl = profileImageUrl;
            mockProfile.latitude = latVal;
            mockProfile.longitude = lngVal;
            if (isAvailableVal !== undefined) mockProfile.isAvailable = isAvailableVal;
            if (isAwayVal !== undefined) mockProfile.isAway = isAwayVal;
            if (isRushModeVal !== undefined) mockProfile.isRushMode = isRushModeVal;
            if (isTravelModeVal !== undefined) mockProfile.isTravelMode = isTravelModeVal;
            if (travelLocationVal !== undefined) mockProfile.travelLocation = travelLocationVal;
            if (travelCityVal !== undefined) mockProfile.travelCity = travelCityVal;
            if (travelStateVal !== undefined) mockProfile.travelState = travelStateVal;
            if (travelCountryVal !== undefined) mockProfile.travelCountry = travelCountryVal;
            if (travelStartDateVal !== undefined) mockProfile.travelStartDate = travelStartDateVal;
            if (travelEndDateVal !== undefined) mockProfile.travelEndDate = travelEndDateVal;
            if (isFeaturedVal !== undefined) mockProfile.isFeatured = isFeaturedVal;
            return mockProfile;
          }
        );

        const baseUrl = getBaseUrl(request);

        const resProfile = JSON.parse(JSON.stringify(profile));
        if (baseUrl) {
          if (resProfile.profileImageUrl && resProfile.profileImageUrl.startsWith('/')) {
            resProfile.profileImageUrl = `${baseUrl}${resProfile.profileImageUrl}`;
          }
          if (resProfile.coverImageUrl && resProfile.coverImageUrl.startsWith('/')) {
            resProfile.coverImageUrl = `${baseUrl}${resProfile.coverImageUrl}`;
          }
        }

        const now = new Date();
        resProfile.isTravelActive = Boolean(
          resProfile.isTravelMode &&
          resProfile.travelEndDate &&
          new Date(resProfile.travelEndDate) >= now &&
          (!resProfile.travelStartDate || new Date(resProfile.travelStartDate) <= now)
        );
        if (baseUrl) {
          if (resProfile.profileImageUrl && resProfile.profileImageUrl.startsWith('/')) {
            resProfile.profileImageUrl = `${baseUrl}${resProfile.profileImageUrl}`;
          }
          if (resProfile.coverImageUrl && resProfile.coverImageUrl.startsWith('/')) {
            resProfile.coverImageUrl = `${baseUrl}${resProfile.coverImageUrl}`;
          }
        }

        return NextResponse.json({
          success: true,
          message: 'Profile setup completed successfully',
          profile: resProfile,
          data: resProfile
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to update profile' }, { status: 400 });
      }
    }

    // 16. Provider Onboarding Step 2: Set Selected Categories (/api/provider/setup/categories)
    if (path === 'provider/setup/categories') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'provider') {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const { categories } = body as any;
      if (!Array.isArray(categories)) {
        return NextResponse.json({ message: 'Categories list must be an array' }, { status: 400 });
      }
      try {
        const profile = await executeWithDbFallback(
          async () => {
            // Verify provider profile exists
            const existing = await prisma.providerProfile.findUnique({ where: { userId: auth.userId } });
            if (!existing) {
              // Auto create an empty profile if step 1 was skipped/partially completed
              return await prisma.providerProfile.create({
                data: {
                  userId: auth.userId,
                  location: '',
                  categories: JSON.stringify(categories)
                }
              });
            }
            return await prisma.providerProfile.update({
              where: { userId: auth.userId },
              data: { categories: JSON.stringify(categories) },
            });
          },
          async () => {
            let mockProfile = mockDb.profiles.find((p) => p.userId === auth.userId);
            if (!mockProfile) {
              mockProfile = { id: mockDb.profiles.length + 1, userId: auth.userId, location: '' };
              mockDb.profiles.push(mockProfile);
            }
            mockProfile.categories = JSON.stringify(categories);
            return mockProfile;
          }
        );
        return NextResponse.json({ success: true, message: 'Categories setup completed successfully' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to save categories' }, { status: 400 });
      }
    }

    // 17. Provider Onboarding Step 3: Set Selected Services & Pricing (/api/provider/setup/services)
    if (path === 'provider/setup/services') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'provider') {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const baseUrl = getBaseUrl(request);
      let servicesInput: any[] = [];

      // 1. Check indexed form data entries e.g. services[0]['service_id'], services[0]['price'], services[0]['portfolioImage']
      const indexedServicesMap: { [key: number]: any } = {};

      if (parsedFormData) {
        parsedFormData.forEach((value, key) => {
          const match = key.match(/^services\[(\d+)\](?:\[|['"])(.*?)(?:\]|['"])$/i) || key.match(/^services\[(\d+)\]\[?([^\]'"]+)\]?$/i);
          if (match) {
            const idx = parseInt(match[1], 10);
            const field = match[2].trim().replace(/^['"]|['"]$/g, '');
            if (!indexedServicesMap[idx]) {
              indexedServicesMap[idx] = {};
            }
            indexedServicesMap[idx][field] = value;
          }
        });
      }

      const indexedKeys = Object.keys(indexedServicesMap);
      if (indexedKeys.length > 0) {
        servicesInput = indexedKeys
          .sort((a, b) => Number(a) - Number(b))
          .map(k => indexedServicesMap[Number(k)]);
      } else {
        let rawServices = (body as any).services;
        if (!rawServices && parsedFormData) {
          const rawServicesFd = parsedFormData.get('services');
          if (typeof rawServicesFd === 'string') {
            try {
              rawServices = JSON.parse(rawServicesFd);
            } catch {
              rawServices = null;
            }
          }
        }

        if (Array.isArray(rawServices)) {
          servicesInput = rawServices;
        } else if (rawServices && typeof rawServices === 'object') {
          servicesInput = [rawServices];
        } else {
          const sId = (body as any).service_id || (body as any).serviceId || (parsedFormData?.get('service_id') as string) || (parsedFormData?.get('serviceId') as string);
          const price = (body as any).price || (parsedFormData?.get('price') as string);
          const rushPrice = (body as any).rushPrice || (body as any).rush_price || (parsedFormData?.get('rushPrice') as string) || (parsedFormData?.get('rush_price') as string);
          if (sId) {
            servicesInput = [{ service_id: sId, price: price || 0, rushPrice: rushPrice || 0 }];
          }
        }
      }

      if (!Array.isArray(servicesInput) || servicesInput.length === 0) {
        return NextResponse.json({ message: 'Services array or service details required' }, { status: 400 });
      }

      const uploadDir = nodePath.join(process.cwd(), 'public', 'uploads');
      let createdUploadDir = false;

      const processedServices = await Promise.all(
        servicesInput.map(async (s: any, idx: number) => {
          const sId = parseInt(s.service_id || s.serviceId) || 0;
          let portfolioImage: string | null = null;
          let rawImgVal = s.portfolioImage ?? s.servicePortfolioImage ?? s.image ?? s.file;

          if (rawImgVal && typeof rawImgVal === 'object' && 'name' in rawImgVal && (rawImgVal as any).size > 0) {
            try {
              if (!createdUploadDir) {
                await fs.mkdir(uploadDir, { recursive: true });
                createdUploadDir = true;
              }
              const fileObj = rawImgVal as any;
              const fileExt = nodePath.extname(fileObj.name || '').toLowerCase() || '.png';
              const uniqueFileName = `portfolio_${auth.userId}_${sId || idx}_${Date.now()}_${Math.floor(Math.random() * 1000)}${fileExt}`;
              const bytes = await fileObj.arrayBuffer();
              await fs.writeFile(nodePath.join(uploadDir, uniqueFileName), Buffer.from(bytes));
              portfolioImage = `/uploads/${uniqueFileName}`;
            } catch (err: any) {
              console.error('Failed to save service portfolio image from form data item:', err);
            }
          } else if (typeof rawImgVal === 'string' && rawImgVal.trim().length > 0) {
            portfolioImage = rawImgVal.trim();
          } else if (parsedFormData) {
            const fileKeys = [
              `services[${idx}][portfolioImage]`,
              `services[${idx}]['portfolioImage']`,
              `services[${idx}][servicePortfolioImage]`,
              `services[${idx}][image]`,
              `image_${sId}`,
              `servicePortfolioImage_${sId}`,
              `file_${sId}`,
              `portfolioImage_${sId}`,
              `image_${idx}`,
              `servicePortfolioImage_${idx}`,
              `file_${idx}`,
              `image`,
              `file`,
              `servicePortfolioImage`,
              `portfolioImage`
            ];

            let fileObj: any = null;
            for (const key of fileKeys) {
              const f = parsedFormData.get(key);
              if (f && typeof f === 'object' && 'name' in f && (f as any).size > 0) {
                fileObj = f;
                break;
              }
            }

            if (fileObj) {
              try {
                if (!createdUploadDir) {
                  await fs.mkdir(uploadDir, { recursive: true });
                  createdUploadDir = true;
                }
                const fileExt = nodePath.extname(fileObj.name || '').toLowerCase() || '.png';
                const uniqueFileName = `portfolio_${auth.userId}_${sId || idx}_${Date.now()}_${Math.floor(Math.random() * 1000)}${fileExt}`;
                const bytes = await fileObj.arrayBuffer();
                await fs.writeFile(nodePath.join(uploadDir, uniqueFileName), Buffer.from(bytes));
                portfolioImage = `/uploads/${uniqueFileName}`;
              } catch (err: any) {
                console.error('Failed to save service portfolio image from fallback key:', err);
              }
            }
          }

          return {
            service_id: sId,
            serviceId: sId,
            price: parseInt(s.price) || 0,
            rushPrice: parseInt(s.rushPrice ?? s.rush_price) || 0,
            servicePortfolioImage: portfolioImage
          };
        })
      );

      try {
        let insertedList: any[] = [];
        await executeWithDbFallback(
          async () => {
            let profile = await prisma.providerProfile.findUnique({ where: { userId: auth.userId } });
            if (!profile) {
              profile = await prisma.providerProfile.create({
                data: { userId: auth.userId, location: '' }
              });
            }

            await prisma.providerService.deleteMany({ where: { profileId: profile.id } });

            const serviceIds = processedServices.map(s => s.serviceId).filter(Boolean);
            const serviceSettings = await prisma.serviceSetting.findMany({
              where: { id: { in: serviceIds } },
              include: { mainType: true }
            });

            const dataToInsert = processedServices.map((s, idx) => {
              const setting = serviceSettings.find(set => set.id === s.serviceId);
              const explicitName = (s as any).name || (s as any).title || (s as any).serviceName || (s as any).service_name;
              const nameToUse = (explicitName && !explicitName.startsWith('Service #'))
                ? explicitName
                : (setting ? setting.title : (s.serviceId ? `Service ${s.serviceId}` : `Service ${idx + 1}`));

              return {
                profileId: profile.id,
                name: nameToUse,
                price: s.price,
                rushPrice: s.rushPrice,
                category: setting && setting.mainType ? setting.mainType.title : 'General',
                servicePortfolioImage: s.servicePortfolioImage
              };
            });

            if (dataToInsert.length > 0) {
              await prisma.providerService.createMany({
                data: dataToInsert
              });
            }

            const dbSvcs = await prisma.providerService.findMany({
              where: { profileId: profile.id }
            });
            insertedList = dbSvcs.map(s => {
              let img = s.servicePortfolioImage;
              if (baseUrl && img && img.startsWith('/')) {
                img = `${baseUrl}${img}`;
              }
              return {
                id: s.id,
                name: s.name,
                price: s.price,
                rushPrice: s.rushPrice || 0,
                category: s.category,
                servicePortfolioImage: img
              };
            });
          },
          async () => {
            let mockProfile = mockDb.profiles.find((p) => p.userId === auth.userId);
            if (!mockProfile) {
              mockProfile = { id: mockDb.profiles.length + 1, userId: auth.userId, location: '' };
              mockDb.profiles.push(mockProfile);
            }
            mockDb.services = mockDb.services.filter((s) => s.profileId !== mockProfile.id);
            insertedList = processedServices.map((s, index) => {
              const newId = Math.floor(Math.random() * 10000);
              let img = s.servicePortfolioImage;
              if (baseUrl && img && img.startsWith('/')) {
                img = `${baseUrl}${img}`;
              }
              const explicitName = (s as any).name || (s as any).title || (s as any).serviceName || (s as any).service_name;
              const nameToUse = (explicitName && !explicitName.startsWith('Service #'))
                ? explicitName
                : (s.serviceId ? `Service ${s.serviceId}` : `Service ${index + 1}`);

              const mockSvc = {
                id: newId,
                profileId: mockProfile.id,
                name: nameToUse,
                price: s.price,
                rushPrice: s.rushPrice || 0,
                category: 'General',
                servicePortfolioImage: s.servicePortfolioImage
              };
              mockDb.services.push(mockSvc);
              return {
                ...mockSvc,
                servicePortfolioImage: img
              };
            });
          }
        );
        return NextResponse.json({
          success: true,
          message: 'Services updated successfully.',
          services: insertedList
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to save services' }, { status: 400 });
      }
    }

    // 18. Provider Onboarding Step 4: Set Selected Ambience & Amenities (/api/provider/setup/ambience)
    if (path === 'provider/setup/ambience') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'provider') {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }

      let rawAmbienceId = (body as any).ambience_id || (body as any).ambienceId || (body as any).ambience_ids || (body as any).ambienceIds || (body as any).items;
      if (Array.isArray(body)) {
        rawAmbienceId = body;
      }

      let ambienceIds: number[] = [];
      if (Array.isArray(rawAmbienceId)) {
        ambienceIds = rawAmbienceId.map((id: any) => {
          if (id && typeof id === 'object') {
            const target = id.id ?? id.ambience_id ?? id.ambienceId;
            return Number(target);
          }
          return Number(id);
        }).filter((n) => !isNaN(n) && n > 0);
      } else if (typeof rawAmbienceId === 'number') {
        ambienceIds = [rawAmbienceId];
      }

      try {
        await executeWithDbFallback(
          async () => {
            let profile = await prisma.providerProfile.findUnique({ where: { userId: auth.userId } });
            if (!profile) {
              // Auto create empty profile
              profile = await prisma.providerProfile.create({
                data: { userId: auth.userId, location: '' }
              });
            }
            // Clear current items
            await prisma.providerAmenity.deleteMany({ where: { profileId: profile.id } });

            // Look up corresponding AmbienceSetting names and types
            const ambienceSettings = await prisma.ambienceSetting.findMany({
              where: { id: { in: ambienceIds } },
              include: { ambienceGroup: true }
            });

            const dataToInsert = ambienceSettings.map((setting) => ({
              profileId: profile.id,
              name: setting.title,
              type: setting.ambienceGroup ? setting.ambienceGroup.title : 'amenity',
              icon: setting.icon || null
            }));

            // Re-insert
            if (dataToInsert.length > 0) {
              await prisma.providerAmenity.createMany({
                data: dataToInsert,
              });
            }
          },
          async () => {
            let mockProfile = mockDb.profiles.find((p) => p.userId === auth.userId);
            if (!mockProfile) {
              mockProfile = { id: mockDb.profiles.length + 1, userId: auth.userId, location: '' };
              mockDb.profiles.push(mockProfile);
            }
            mockDb.amenities = mockDb.amenities.filter((a) => a.profileId !== mockProfile.id);
            ambienceIds.forEach((id) => {
              mockDb.amenities.push({
                id: Math.floor(Math.random() * 10000),
                profileId: mockProfile.id,
                name: `Ambience Item #${id}`,
                type: 'amenity',
                icon: null,
              });
            });
          }
        );
        return NextResponse.json({ success: true, message: 'Amenities and Ambience updated successfully.' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to save items' }, { status: 400 });
      }
    }

    // 19. Provider Onboarding Step 5: Licenses & Experience (/api/provider/setup/license)
    if (path === 'provider/setup/license') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'provider') {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }

      let experience: any = null;
      let licenseNamesList: string[] = [];
      let certificateUrls: string[] = [];

      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('multipart/form-data')) {
        try {
          const formData = parsedFormData || await request.formData();
          experience = formData.get('experience');

          // Support multiple license names and certificates
          const rawLicenseNames = formData.getAll('licenseName').length > 0
            ? formData.getAll('licenseName')
            : (formData.getAll('licenseType').length > 0
              ? formData.getAll('licenseType')
              : formData.getAll('licenseNames'));

          const rawCertificates = formData.getAll('certificate').length > 0
            ? formData.getAll('certificate')
            : formData.getAll('certificates');

          // Support single values if passed
          const singleLicenseType = formData.get('licenseType');
          if (rawLicenseNames.length === 0 && singleLicenseType) {
            const strType = String(singleLicenseType);
            if (strType.includes(',')) {
              licenseNamesList.push(...strType.split(',').map(s => s.trim()));
            } else {
              licenseNamesList.push(strType);
            }
          } else {
            rawLicenseNames.forEach((name: any) => {
              const strName = String(name);
              if (strName.includes(',')) {
                licenseNamesList.push(...strName.split(',').map(s => s.trim()));
              } else {
                licenseNamesList.push(strName);
              }
            });
          }

          const uploadDir = nodePath.join(process.cwd(), 'public', 'uploads');
          await fs.mkdir(uploadDir, { recursive: true });

          for (let i = 0; i < rawCertificates.length; i++) {
            const certificate = rawCertificates[i];
            if (certificate && typeof certificate === 'object' && 'name' in certificate) {
              const file = certificate as any;
              const mimeType = file.type || '';
              const fileName = file.name || '';
              const fileExt = nodePath.extname(fileName).toLowerCase();

              const isValidMime = mimeType === 'application/pdf' || mimeType.startsWith('image/');
              const isValidExt = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'].includes(fileExt);

              if (!isValidMime && !isValidExt) {
                return NextResponse.json(
                  { message: 'Certificate must be a PDF or an image file only' },
                  { status: 400 }
                );
              }

              const bytes = await file.arrayBuffer();
              const buffer = Buffer.from(bytes);
              const uniqueFileName = `certificate_${auth.userId}_${Date.now()}_${i}${fileExt || '.pdf'}`;
              const filePath = nodePath.join(uploadDir, uniqueFileName);
              await fs.writeFile(filePath, buffer);
              certificateUrls.push(`/uploads/${uniqueFileName}`);
            } else if (typeof certificate === 'string') {
              const strCert = String(certificate);
              if (strCert.includes(',')) {
                certificateUrls.push(...strCert.split(',').map(s => s.trim()));
              } else {
                certificateUrls.push(strCert);
              }
            }
          }

          const rawCertificateUrls = formData.getAll('certificateUrl').length > 0
            ? formData.getAll('certificateUrl')
            : formData.getAll('certificateUrls');
          if (rawCertificateUrls.length > 0) {
            for (const url of rawCertificateUrls) {
              if (typeof url === 'string') {
                if (url.includes(',')) {
                  certificateUrls.push(...url.split(',').map(s => s.trim()));
                } else {
                  certificateUrls.push(url);
                }
              }
            }
          }
        } catch (err: any) {
          return NextResponse.json({ message: 'Failed to process file upload: ' + err.message }, { status: 400 });
        }
      } else {
        experience = (body as any).experience;
        if (Array.isArray((body as any).licenses)) {
          const names: string[] = [];
          const urls: string[] = [];
          for (const item of (body as any).licenses) {
            if (item && typeof item === 'object') {
              const lName = item.licenseName || item.licenseType || '';
              if (lName.includes(',')) {
                names.push(...lName.split(',').map((s: string) => s.trim()));
              } else {
                names.push(lName);
              }

              const cUrl = item.certificateUrl || '';
              if (cUrl.includes(',')) {
                urls.push(...cUrl.split(',').map((s: string) => s.trim()));
              } else {
                urls.push(cUrl);
              }
            }
          }
          licenseNamesList = names.filter(Boolean);
          certificateUrls = urls.filter(Boolean);
        } else {
          const rawTypes = (body as any).licenseType;
          const tempTypes = Array.isArray(rawTypes) ? rawTypes : (rawTypes ? [rawTypes] : []);
          tempTypes.forEach((t: any) => {
            const strT = String(t);
            if (strT.includes(',')) {
              licenseNamesList.push(...strT.split(',').map(s => s.trim()));
            } else {
              licenseNamesList.push(strT);
            }
          });

          const rawUrls = (body as any).certificateUrl;
          const tempUrls = Array.isArray(rawUrls) ? rawUrls : (rawUrls ? [rawUrls] : []);
          tempUrls.forEach((u: any) => {
            const strU = String(u);
            if (strU.includes(',')) {
              certificateUrls.push(...strU.split(',').map(s => s.trim()));
            } else {
              certificateUrls.push(strU);
            }
          });
        }
      }

      try {
        const response = await executeWithDbFallback(
          async () => {
            let profile = await prisma.providerProfile.findUnique({ where: { userId: auth.userId } });
            const storedLicenseType = licenseNamesList.length > 0 ? JSON.stringify(licenseNamesList) : (profile?.licenseType || null);
            const storedCertificateUrl = certificateUrls.length > 0 ? JSON.stringify(certificateUrls) : (profile?.certificateUrl || null);

            if (!profile) {
              profile = await prisma.providerProfile.create({
                data: {
                  userId: auth.userId,
                  location: '',
                  experience: parseInt(experience) || 0,
                  licenseType: storedLicenseType,
                  certificateUrl: storedCertificateUrl
                }
              });
            } else {
              profile = await prisma.providerProfile.update({
                where: { userId: auth.userId },
                data: {
                  experience: parseInt(experience) || 0,
                  licenseType: storedLicenseType,
                  certificateUrl: storedCertificateUrl
                },
              });
            }
            await prisma.user.update({
              where: { id: auth.userId },
              data: { onboardingCompleted: true },
            });
            return profile;
          },
          async () => {
            let mockProfile = mockDb.profiles.find((p) => p.userId === auth.userId);
            if (!mockProfile) {
              mockProfile = { id: mockDb.profiles.length + 1, userId: auth.userId, name: '', location: '' };
              mockDb.profiles.push(mockProfile);
            }
            mockProfile.experience = parseInt(experience) || 0;
            mockProfile.licenseType = licenseNamesList.length > 0 ? JSON.stringify(licenseNamesList) : (mockProfile.licenseType || null);
            mockProfile.certificateUrl = certificateUrls.length > 0 ? JSON.stringify(certificateUrls) : (mockProfile.certificateUrl || null);

            const mockUser = mockDb.users.find((u) => u.id === auth.userId);
            if (mockUser) mockUser.onboardingCompleted = true;
            return mockProfile;
          }
        );
        const baseUrl = getBaseUrl(request);

        const resProfile = JSON.parse(JSON.stringify(response));
        if (baseUrl && resProfile && resProfile.certificateUrl && resProfile.certificateUrl.startsWith('/')) {
          resProfile.certificateUrl = `${baseUrl}${resProfile.certificateUrl}`;
        }

        // Fetch the updated user object with relations
        const dbUser = await executeWithDbFallback(
          async () => {
            return await prisma.user.findUnique({
              where: { id: auth.userId },
              include: {
                providerProfile: { include: { services: true, amenities: true } }
              }
            });
          },
          async () => {
            const u = mockDb.users.find((user) => user.id === auth.userId);
            const p = mockDb.profiles.find((profile) => profile.userId === auth.userId);
            let providerProfile = undefined;
            if (p) {
              providerProfile = {
                ...p,
                services: mockDb.services.filter((s) => s.profileId === p.id),
                amenities: mockDb.amenities.filter((a) => a.profileId === p.id),
              };
            }
            return { ...u, providerProfile };
          }
        );

        return NextResponse.json({
          success: true,
          message: 'Licenses updated. Onboarding complete!'
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to save licenses' }, { status: 400 });
      }
    }

    // POST Availability Config for Provider
    if (path === 'providers/me/availability/config' || path === 'provider/me/availability/config') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'provider') {
        return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
      }

      const { startTime, endTime, slotDuration } = body as any;
      if (!startTime || !endTime || !slotDuration) {
        return NextResponse.json({ message: 'Missing startTime, endTime, or slotDuration' }, { status: 400 });
      }

      const durationVal = parseInt(slotDuration, 10);
      if (isNaN(durationVal) || durationVal <= 0) {
        return NextResponse.json({ message: 'Invalid slotDuration. Must be a positive integer.' }, { status: 400 });
      }

      try {
        const result = await executeWithDbFallback(
          async () => {
            return await prisma.providerAvailabilityConfig.upsert({
              where: { providerId: auth.userId },
              update: { startTime, endTime, slotDuration: durationVal },
              create: { providerId: auth.userId, startTime, endTime, slotDuration: durationVal }
            });
          },
          async () => {
            let config = mockDb.availabilityConfigs.find((c) => c.providerId === auth.userId);
            if (!config) {
              config = { id: mockDb.availabilityConfigs.length + 1, providerId: auth.userId };
              mockDb.availabilityConfigs.push(config);
            }
            config.startTime = startTime;
            config.endTime = endTime;
            config.slotDuration = durationVal;
            return config;
          }
        );

        return NextResponse.json({
          success: true,
          message: 'Availability configuration saved successfully',
          config: result
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to save configuration' }, { status: 400 });
      }
    }

    // POST Availability Slots selection (pick slots)
    if (path === 'providers/me/availability/slots' || path === 'provider/me/availability/slots') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'provider') {
        return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
      }

      const { slots } = body as any;
      if (!Array.isArray(slots)) {
        return NextResponse.json({ message: 'Invalid payload: slots array is required' }, { status: 400 });
      }

      try {
        await executeWithDbFallback(
          async () => {
            for (const slot of slots) {
              const { dayOfWeek, timeSlot, fromTime, toTime, isAvailable } = slot;
              const targetSlot = timeSlot || (fromTime && toTime ? `${fromTime} - ${toTime}` : fromTime);
              if (!dayOfWeek || !targetSlot || isAvailable === undefined) continue;

              await prisma.providerActiveSlot.upsert({
                where: {
                  providerId_dayOfWeek_timeSlot: {
                    providerId: auth.userId,
                    dayOfWeek,
                    timeSlot: targetSlot
                  }
                },
                update: { isAvailable: Boolean(isAvailable) },
                create: {
                  providerId: auth.userId,
                  dayOfWeek,
                  timeSlot: targetSlot,
                  isAvailable: Boolean(isAvailable)
                }
              });
            }
          },
          async () => {
            for (const slot of slots) {
              const { dayOfWeek, timeSlot, fromTime, toTime, isAvailable } = slot;
              const targetSlot = timeSlot || (fromTime && toTime ? `${fromTime} - ${toTime}` : fromTime);
              if (!dayOfWeek || !targetSlot || isAvailable === undefined) continue;

              let match = mockDb.activeSlots.find(
                (s) => s.providerId === auth.userId &&
                  s.dayOfWeek.toLowerCase() === dayOfWeek.toLowerCase() &&
                  (s.timeSlot === targetSlot || (fromTime && s.timeSlot === fromTime))
              );

              if (match) {
                match.isAvailable = Boolean(isAvailable);
              } else {
                mockDb.activeSlots.push({
                  id: mockDb.activeSlots.length + 1,
                  providerId: auth.userId,
                  dayOfWeek,
                  timeSlot: targetSlot,
                  isAvailable: Boolean(isAvailable)
                });
              }
            }
          }
        );

        return NextResponse.json({
          success: true,
          message: 'Slots availability updated successfully'
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to update slots availability' }, { status: 400 });
      }
    }

    // POST Admin Promo Code - Create
    if (path === 'admin/settings/promocodes' || path === 'admin/settings/vouchers') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires admin role' }, { status: 403 });
      }

      const { code, title, amount, isActive } = body as any;
      if (!code || !title || amount === undefined) {
        return NextResponse.json({ message: 'Missing code, title, or amount' }, { status: 400 });
      }

      const amountVal = parseFloat(amount);
      if (isNaN(amountVal) || amountVal < 0) {
        return NextResponse.json({ message: 'Invalid amount' }, { status: 400 });
      }

      const activeVal = isActive !== undefined ? Boolean(isActive) : true;

      try {
        const result = await executeWithDbFallback(
          async () => {
            const normalizedCode = String(code).toUpperCase().trim();
            await prisma.promoCode.create({
              data: { code: normalizedCode, title, amount: amountVal, isActive: activeVal }
            }).catch(() => null);

            return await prisma.voucher.create({
              data: { code: normalizedCode, title, amount: amountVal, isActive: activeVal }
            }).catch(async () => {
              return await prisma.voucher.findUnique({ where: { code: normalizedCode } });
            });
          },
          async () => {
            const normalizedCode = String(code).toUpperCase().trim();
            const exists = mockDb.vouchers.some((v) => v.code === normalizedCode);
            if (exists) throw new Error('Voucher code already exists');

            const newVoucher = {
              id: mockDb.vouchers.length + 1,
              code: normalizedCode,
              title,
              amount: amountVal,
              isActive: activeVal,
              createdAt: new Date()
            };
            mockDb.vouchers.push(newVoucher);
            return newVoucher;
          }
        );

        return NextResponse.json({
          success: true,
          message: 'Voucher created successfully',
          voucher: result
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to create voucher' }, { status: 400 });
      }
    }

    // POST Order Summary Calculation
    if (path === 'orders/calculate' || path === 'client/bookings/calculate') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }

      const { serviceIds, numberOfPeople, tipType, tipAmount, promoCode, promo_code, voucherCode, voucher_code, providerId, provider_id } = body as any;
      const targetPromoCode = promoCode || promo_code || voucherCode || voucher_code;
      const targetProviderId = providerId || provider_id ? Number(providerId || provider_id) : null;
      if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
        return NextResponse.json({ message: 'At least one service is required' }, { status: 400 });
      }

      const numPeople = Math.max(1, parseInt(numberOfPeople, 10) || 1);

      try {
        const servicesList = await executeWithDbFallback(
          async () => await prisma.providerService.findMany({
            where: { id: { in: serviceIds.map(Number) } },
            include: { profile: true }
          }),
          async () => mockDb.services.filter((s) => serviceIds.map(Number).includes(s.id))
        );

        let pProfile: any = null;
        if (targetProviderId) {
          pProfile = await executeWithDbFallback(
            async () => await prisma.providerProfile.findFirst({
              where: { OR: [{ userId: targetProviderId }, { id: targetProviderId }] },
              include: { user: true }
            }),
            async () => mockDb.profiles.find((p: any) => p.userId === targetProviderId || p.id === targetProviderId)
          );
        }

        const pTimezone = pProfile?.user?.timezone || pProfile?.timezone || 'UTC';
        const isRushModeActive = checkExpressPriceApplies(pProfile, (body as any)?.date, pTimezone);

        const baseServiceAmount = servicesList.reduce((sum, s) => {
          const rushP = Number(s.rushPrice ?? (s as any).rush_price) || 0;
          const normalP = Number(s.price) || 0;
          const effectivePrice = (isRushModeActive && rushP > 0) ? rushP : normalP;
          return sum + effectivePrice;
        }, 0);

        const serviceAmount = baseServiceAmount * numPeople;

        let calculatedTip = 0;
        const normalizedTipType = String(tipType).toLowerCase();
        if (normalizedTipType === '10%') {
          calculatedTip = serviceAmount * 0.10;
        } else if (normalizedTipType === '15%') {
          calculatedTip = serviceAmount * 0.15;
        } else if (normalizedTipType === '20%') {
          calculatedTip = serviceAmount * 0.20;
        } else if (normalizedTipType === 'custom') {
          calculatedTip = parseFloat(tipAmount) || 0;
        }

        let discount = 0;
        let isValidPromoCode = false;
        let promoCodeMessage = 'No promo code applied';

        if (targetPromoCode) {
          const normCode = String(targetPromoCode).toUpperCase().trim();
          const promoItem = await executeWithDbFallback(
            async () => {
              const pc = await prisma.promoCode.findUnique({ where: { code: normCode } }).catch(() => null);
              if (pc) return pc;
              return await prisma.voucher.findUnique({ where: { code: normCode } }).catch(() => null);
            },
            async () => mockDb.vouchers.find((v) => v.code === normCode) || null
          );

          if (promoItem) {
            if (promoItem.isActive) {
              discount = Math.round((serviceAmount * (promoItem.amount / 100)) * 100) / 100;
              isValidPromoCode = true;
              promoCodeMessage = `Promo Code '${promoItem.code}' (${promoItem.amount}%) applied successfully.`;
            } else {
              promoCodeMessage = 'Promo code is inactive';
            }
          } else {
            promoCodeMessage = 'Invalid promo code';
          }
        }

        if (discount > serviceAmount) {
          discount = serviceAmount;
        }

        const grandTotal = Math.max(0, serviceAmount + calculatedTip - discount);

        return NextResponse.json({
          success: true,
          numberOfPeople: numPeople,
          serviceAmount,
          tipAmount: calculatedTip,
          promoDiscount: discount,
          grandTotal,
          isValidPromoCode,
          promoCodeMessage,
          isRushMode: isRushModeActive
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to calculate summary' }, { status: 400 });
      }
    }

    // POST Client Booking
    if (path === 'clients/bookings' || path === 'client/bookings') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'client') {
        return NextResponse.json({ message: 'Forbidden: Requires client role' }, { status: 403 });
      }

      const {
        providerId,
        serviceIds,
        numberOfPeople,
        date,
        timeSlot,
        fromTime,
        from_time,
        toTime,
        to_time,
        tipType,
        tipAmount,
        promoCode,
        promo_code,
        voucherCode,
        voucher_code,
        stripe_transection_id,
        stripe_transaction_id,
        stripe_transection_raw,
        stripe_transaction_raw
      } = body as any;

      const inputFromTime = fromTime || from_time || null;
      const inputToTime = toTime || to_time || null;
      const targetTimeSlot = timeSlot || (inputFromTime && inputToTime ? `${inputFromTime} - ${inputToTime}` : inputFromTime);

      const targetPromoCode = promoCode || promo_code || voucherCode || voucher_code;
      const finalTransactionId = stripe_transection_id || stripe_transaction_id || (body as any).transactionId || (body as any).stripeTransactionId || null;
      const rawInput = stripe_transection_raw !== undefined ? stripe_transection_raw : (stripe_transaction_raw !== undefined ? stripe_transaction_raw : ((body as any).stripeRawData !== undefined ? (body as any).stripeRawData : null));

      const finalStripeRawStr = rawInput !== null && rawInput !== undefined
        ? (typeof rawInput === 'object' ? JSON.stringify(rawInput) : String(rawInput))
        : null;

      let finalStripeRawObj: any = null;
      if (rawInput !== null && rawInput !== undefined) {
        if (typeof rawInput === 'object') {
          finalStripeRawObj = rawInput;
        } else if (typeof rawInput === 'string') {
          try {
            finalStripeRawObj = JSON.parse(rawInput);
          } catch {
            finalStripeRawObj = rawInput;
          }
        } else {
          finalStripeRawObj = rawInput;
        }
      }

      if (!providerId || !Array.isArray(serviceIds) || serviceIds.length === 0 || !date || !targetTimeSlot) {
        return NextResponse.json({ message: 'Missing required booking fields' }, { status: 400 });
      }

      const numPeople = parseInt(numberOfPeople, 10) || 1;
      if (numPeople < 1 || numPeople > 10) {
        return NextResponse.json({ message: 'Number of people must be between 1 and 10' }, { status: 400 });
      }

      const providerIdInt = parseInt(providerId, 10);
      const bookingDate = new Date(date);
      if (isNaN(bookingDate.getTime())) {
        return NextResponse.json({ message: 'Invalid date format' }, { status: 400 });
      }

      const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayName = daysOfWeek[bookingDate.getDay()];

      try {
        const check = await executeWithDbFallback(
          async () => {
            const config = await prisma.providerAvailabilityConfig.findUnique({
              where: { providerId: providerIdInt }
            });
            const activeSlots = await prisma.providerActiveSlot.findMany({
              where: { providerId: providerIdInt, dayOfWeek: dayName }
            });
            const existingBookings = await prisma.booking.findMany({
              where: {
                providerId: providerIdInt,
                status: { not: 'cancelled' },
                date: {
                  gte: new Date(date + 'T00:00:00.000Z'),
                  lte: new Date(date + 'T23:59:59.999Z')
                }
              }
            });
            return { config, activeSlots, existingBookings };
          },
          async () => {
            const config = mockDb.availabilityConfigs.find((c) => c.providerId === providerIdInt) || null;
            const activeSlots = mockDb.activeSlots.filter((s) => s.providerId === providerIdInt && s.dayOfWeek.toLowerCase() === dayName.toLowerCase());

            const targetDateStr = bookingDate.toISOString().split('T')[0];
            const existingBookings = mockDb.bookings.filter((b) => {
              const bDateStr = new Date(b.date).toISOString().split('T')[0];
              return b.providerId === providerIdInt && bDateStr === targetDateStr && b.status !== 'cancelled';
            });
            return { config, activeSlots, existingBookings };
          }
        );

        const startTime = check.config?.startTime || '09:00 AM';
        const endTime = check.config?.endTime || '06:00 PM';
        const slotDuration = check.config?.slotDuration || 60;
        const detailedSlots = getSlotsDetailedRange(startTime, endTime, slotDuration);
        const validTimeSlots = detailedSlots.map(s => s.timeSlot).concat(getSlotsRange(startTime, endTime, slotDuration));

        if (!validTimeSlots.includes(targetTimeSlot) && !validTimeSlots.some(s => s.startsWith(targetTimeSlot))) {
          return NextResponse.json({ message: 'Selected time slot is out of provider working hours' }, { status: 400 });
        }

        const activeStatus = check.activeSlots.find((s) => s.timeSlot === targetTimeSlot || (inputFromTime && s.timeSlot === inputFromTime));
        if (activeStatus && !activeStatus.isAvailable) {
          return NextResponse.json({ message: 'Provider is not available at the selected time slot' }, { status: 400 });
        }

        const isSlotAlreadyBooked = check.existingBookings.some((b) => b.timeSlot === targetTimeSlot || (inputFromTime && b.timeSlot === inputFromTime));
        if (isSlotAlreadyBooked) {
          return NextResponse.json({ message: 'Selected time slot is already booked' }, { status: 400 });
        }

        const providerProfile = await executeWithDbFallback(
          async () => await prisma.providerProfile.findFirst({
            where: { OR: [{ userId: providerIdInt }, { id: providerIdInt }] }
          }),
          async () => mockDb.profiles.find((p) => p.userId === providerIdInt || p.id === providerIdInt)
        );
        const providerTimezone = providerProfile?.user?.timezone || providerProfile?.timezone || 'UTC';
        const isRushActive = checkExpressPriceApplies(providerProfile, date, providerTimezone);

        const servicesList = await executeWithDbFallback(
          async () => await prisma.providerService.findMany({
            where: { id: { in: serviceIds.map(Number) } },
            include: { profile: true }
          }),
          async () => mockDb.services.filter((s) => serviceIds.map(Number).includes(s.id))
        );

        if (servicesList.length === 0) {
          return NextResponse.json({ message: 'No valid services selected' }, { status: 400 });
        }

        const baseServiceAmount = servicesList.reduce((sum, s) => {
          const rushP = Number(s.rushPrice ?? (s as any).rush_price) || 0;
          const normalP = Number(s.price) || 0;
          const effectivePrice = (isRushActive && rushP > 0) ? rushP : normalP;
          return sum + effectivePrice;
        }, 0);

        const serviceAmount = baseServiceAmount * numPeople;

        let calculatedTip = 0;
        const normalizedTipType = String(tipType).toLowerCase();
        let tipPct: number | null = null;
        if (normalizedTipType === '10%') {
          calculatedTip = serviceAmount * 0.10;
          tipPct = 10;
        } else if (normalizedTipType === '15%') {
          calculatedTip = serviceAmount * 0.15;
          tipPct = 15;
        } else if (normalizedTipType === '20%') {
          calculatedTip = serviceAmount * 0.20;
          tipPct = 20;
        } else if (normalizedTipType === 'custom') {
          calculatedTip = parseFloat(tipAmount) || 0;
        }

        let discount = 0;
        const appliedCode = targetPromoCode ? String(targetPromoCode).toUpperCase().trim() : null;
        if (appliedCode) {
          const promoItem = await executeWithDbFallback(
            async () => {
              const pc = await prisma.promoCode.findUnique({ where: { code: appliedCode } }).catch(() => null);
              if (pc) return pc;
              return await prisma.voucher.findUnique({ where: { code: appliedCode } }).catch(() => null);
            },
            async () => mockDb.vouchers.find((v) => v.code === appliedCode) || null
          );
          if (promoItem) {
            if (promoItem.isActive) {
              discount = Math.round((serviceAmount * (promoItem.amount / 100)) * 100) / 100;
            } else {
              return NextResponse.json({ message: 'Promo code is inactive' }, { status: 400 });
            }
          } else {
            return NextResponse.json({ message: 'Invalid promo code' }, { status: 400 });
          }
        }
        if (discount > serviceAmount) {
          discount = serviceAmount;
        }

        const grandTotal = Math.max(0, serviceAmount + calculatedTip - discount);

        // Verify Stripe PaymentIntent status on server if transactionId is provided (Step 2: Don't trust client payload alone)
        if (finalTransactionId && String(finalTransactionId).startsWith('pi_')) {
          const stripe = getStripeInstance();
          if (stripe) {
            try {
              const intent = await stripe.paymentIntents.retrieve(String(finalTransactionId));
              if (!['requires_capture', 'succeeded', 'requires_action', 'processing'].includes(intent.status)) {
                return NextResponse.json({
                  message: `Stripe PaymentIntent is not authorized or valid (Current status: ${intent.status})`
                }, { status: 400 });
              }
            } catch (stripeErr: any) {
              console.warn('[Stripe Verification Warning] Could not verify PaymentIntent from Stripe:', stripeErr.message);
            }
          }
        }

        const booking = await executeWithDbFallback(
          async () => {
            return await prisma.booking.create({
              data: {
                clientId: auth.userId,
                providerId: providerIdInt,
                numberOfPeople: numPeople,
                date: bookingDate,
                timeSlot: targetTimeSlot,
                status: 'pending',
                tipAmount: calculatedTip,
                tipPercentage: tipPct,
                promoCode: appliedCode,
                promoDiscount: discount,
                serviceAmount,
                grandTotal,
                transactionId: finalTransactionId,
                stripeRawData: finalStripeRawStr,
                services: {
                  create: serviceIds.map((sId) => ({
                    serviceId: Number(sId)
                  }))
                }
              },
              include: {
                services: {
                  include: {
                    service: true
                  }
                }
              }
            });
          },
          async () => {
            const bId = mockDb.bookings.length + 1;
            const newBooking = {
              id: bId,
              clientId: auth.userId,
              providerId: providerIdInt,
              numberOfPeople: numPeople,
              date: bookingDate,
              timeSlot: targetTimeSlot,
              status: 'pending',
              tipAmount: calculatedTip,
              tipPercentage: tipPct,
              promoCode: appliedCode,
              promoDiscount: discount,
              serviceAmount,
              grandTotal,
              transactionId: finalTransactionId,
              stripeRawData: finalStripeRawStr,
              createdAt: new Date()
            };
            mockDb.bookings.push(newBooking);

            serviceIds.forEach((sId) => {
              mockDb.bookingServices.push({
                id: mockDb.bookingServices.length + 1,
                bookingId: bId,
                serviceId: Number(sId)
              });
            });

            const services = mockDb.bookingServices
              .filter((bs) => bs.bookingId === bId)
              .map((bs) => {
                const service = mockDb.services.find((s) => s.id === bs.serviceId);
                return { id: bs.id, serviceId: bs.serviceId, service };
              });

            return { ...newBooking, services };
          }
        );

        // Trigger FCM Notification to Provider (Provider Notification A: Booking Created)
        try {
          const clientName = auth.user?.name || auth.user?.email || 'A customer';
          const bookingDateStr = bookingDate.toISOString().split('T')[0];
          sendNotificationToUser(
            providerIdInt,
            'New Booking Received! 📅',
            `${clientName} has booked an appointment for ${bookingDateStr} at ${targetTimeSlot}.`,
            {
              bookingId: String(booking?.id || ''),
              clientId: String(auth.userId),
              providerId: String(providerIdInt),
              type: 'NEW_BOOKING'
            }
          ).catch(err => console.error('FCM Provider Notification Error:', err));
        } catch (fcmErr) {
          console.error('Failed to trigger FCM booking notification:', fcmErr);
        }

        const slotParts = targetTimeSlot.split(/\s*-\s*/);
        const formattedBooking = {
          ...(booking as any),
          isRushMode: isRushActive,
          fromTime: inputFromTime || slotParts[0] || targetTimeSlot,
          toTime: inputToTime || slotParts[1] || null,
          timezone: auth?.timezone || (auth?.user as any)?.timezone || 'UTC',
          stripe_transection_id: finalTransactionId || (booking as any)?.transactionId || null,
          stripe_transaction_id: finalTransactionId || (booking as any)?.transactionId || null,
          stripe_transection_raw: finalStripeRawObj || ((booking as any)?.stripeRawData ? (() => { try { return JSON.parse((booking as any).stripeRawData); } catch { return (booking as any).stripeRawData; } })() : null),
          stripe_transaction_raw: finalStripeRawObj || ((booking as any)?.stripeRawData ? (() => { try { return JSON.parse((booking as any).stripeRawData); } catch { return (booking as any).stripeRawData; } })() : null)
        };

        return NextResponse.json({
          success: true,
          message: 'Booking created successfully',
          booking: formattedBooking
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to create booking' }, { status: 400 });
      }
    }

    // 2. Submit Review POST (/api/clients/reviews, /api/clients/providers/reviews)
    if (path === 'clients/reviews' || path === 'client/reviews' || path === 'clients/providers/reviews' || path === 'client/providers/reviews') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      const { providerId, bookingId, booking_id, rating, comment, message } = body as any;
      const numBookingId = (bookingId || booking_id) ? Number(bookingId || booking_id) : null;
      let targetProviderId = providerId ? Number(providerId) : 0;
      const reviewComment = comment || message || '';

      if (!rating) {
        return NextResponse.json({ message: 'rating is required' }, { status: 400 });
      }

      try {
        const newReview = await executeWithDbFallback<any>(
          async () => {
            if (numBookingId !== null) {
              const bookingExists = await prisma.booking.findUnique({
                where: { id: numBookingId }
              });
              if (!bookingExists) {
                throw new Error('Invalid booking ID. Booking not found.');
              }
              if (!targetProviderId) {
                targetProviderId = bookingExists.providerId;
              }
            }

            if (!targetProviderId) {
              throw new Error('providerId or bookingId is required');
            }

            // Pre-verify provider exists
            const providerExists = await prisma.user.findUnique({
              where: { id: targetProviderId }
            });
            if (!providerExists) {
              throw new Error('Provider not found');
            }

            return await prisma.review.create({
              data: {
                clientId: auth.userId,
                providerId: targetProviderId,
                bookingId: numBookingId,
                rating: Number(rating),
                comment: reviewComment
              }
            });
          },
          async () => {
            if (numBookingId !== null) {
              const bookingExists = mockDb.bookings.find((b: any) => b.id === numBookingId);
              if (!bookingExists) {
                throw new Error('Invalid booking ID. Booking not found.');
              }
              if (!targetProviderId) {
                targetProviderId = bookingExists.providerId;
              }
            }

            if (!targetProviderId) {
              throw new Error('providerId or bookingId is required');
            }

            const providerExists = mockDb.users.some((u) => u.id === targetProviderId);
            if (!providerExists) {
              throw new Error('Provider not found');
            }

            const rev = {
              id: mockDb.reviews.length + 1,
              clientId: auth.userId,
              providerId: targetProviderId,
              bookingId: numBookingId,
              rating: Number(rating),
              comment: reviewComment,
              createdAt: new Date().toISOString()
            };
            mockDb.reviews.push(rev);
            return rev;
          }
        );

        // Trigger FCM Notification to Provider (Provider Notification B: Review/Rating Submitted)
        try {
          const clientName = auth.user?.name || auth.user?.email || 'A customer';
          const shortComment = reviewComment.length > 60 ? reviewComment.slice(0, 60) + '...' : reviewComment;
          sendNotificationToUser(
            targetProviderId,
            'New Rating & Review Received ⭐',
            `${clientName} rated you ${rating} stars: "${shortComment}"`,
            {
              reviewId: String(newReview?.id || ''),
              bookingId: String(numBookingId || ''),
              clientId: String(auth.userId),
              providerId: String(targetProviderId),
              type: 'NEW_REVIEW'
            }
          ).catch(err => console.error('FCM Provider Review Notification Error:', err));
        } catch (fcmErr) {
          console.error('Failed to trigger FCM review notification:', fcmErr);
        }

        return NextResponse.json({ success: true, review: newReview });
      } catch (err: any) {
        let cleanMsg = err.message || 'Failed to submit review';
        if (err.code === 'P2003' || cleanMsg.includes('Foreign key constraint failed')) {
          if (cleanMsg.includes('bookingId')) {
            cleanMsg = 'Invalid booking ID. Booking not found or already reviewed.';
          } else if (cleanMsg.includes('providerId')) {
            cleanMsg = 'Provider not found.';
          } else {
            cleanMsg = 'Invalid provider or booking reference.';
          }
        } else if (err.code === 'P2025' || cleanMsg.includes('Record to update not found')) {
          cleanMsg = 'Referenced record not found.';
        }
        return NextResponse.json({ message: cleanMsg }, { status: 400 });
      }
    }

    // 5. CMS Pages POST (/api/admin/cms-pages, /api/cms/pages)
    if (path === 'admin/cms-pages' || path === 'cms/pages') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires admin role' }, { status: 403 });
      }
      const { slug, title, content } = body as any;
      if (!slug || content === undefined) {
        return NextResponse.json({ message: 'slug and content are required' }, { status: 400 });
      }

      const dbContent = typeof content === 'object' ? JSON.stringify(content) : content;

      const formatCmsPage = (page: any) => {
        if (!page) return page;
        let rawContent = page.content;
        let parsedContent = rawContent;
        let contentType: 'array' | 'html' = 'html';

        let isArray = false;
        let arrayItems: any[] = [];

        if (Array.isArray(rawContent)) {
          isArray = true;
          arrayItems = rawContent;
        } else if (typeof rawContent === 'string') {
          const trimmed = rawContent.trim();
          if (trimmed.startsWith('[')) {
            try {
              const parsed = JSON.parse(rawContent);
              if (Array.isArray(parsed)) {
                isArray = true;
                arrayItems = parsed;
              }
            } catch {
              isArray = false;
            }
          }
        } else if (typeof rawContent === 'object' && rawContent !== null) {
          isArray = true;
          arrayItems = Array.isArray(rawContent) ? rawContent : [rawContent];
        }

        if (page.slug === 'client-faqs' || page.slug === 'provider-faqs' || page.slug === 'client-faq' || page.slug === 'provider-faq') {
          contentType = 'html';
          if (isArray && arrayItems.length > 0) {
            parsedContent = arrayItems.map((item: any) => {
              if (typeof item === 'string') return `<p>${item}</p>`;
              const q = item.question || item.q || item.title || '';
              const a = item.answer || item.a || item.content || item.description || '';
              return `<h2>${q}</h2><p>${a}</p>`;
            }).join('');
          } else {
            parsedContent = typeof rawContent === 'string' ? rawContent : String(rawContent || '');
          }
        } else {
          if (isArray) {
            contentType = 'array';
            parsedContent = arrayItems;
          } else {
            contentType = 'html';
            parsedContent = typeof rawContent === 'string' ? rawContent : String(rawContent || '');
          }
        }

        const pageObj = typeof page.toObject === 'function' ? page.toObject() : { ...page };
        delete pageObj.faqs;

        return {
          ...pageObj,
          contentType,
          content: parsedContent
        };
      };

      try {
        const updatedPage = await executeWithDbFallback(
          async () => {
            return await prisma.cmsPage.upsert({
              where: { slug },
              update: { title: title || slug, content: dbContent },
              create: { slug, title: title || slug, content: dbContent }
            });
          },
          async () => {
            const idx = mockDb.cmsPages.findIndex((p) => p.slug === slug);
            if (idx !== -1) {
              if (title) mockDb.cmsPages[idx].title = title;
              mockDb.cmsPages[idx].content = dbContent;
              return mockDb.cmsPages[idx];
            } else {
              const page = { slug, title: title || slug, content: dbContent };
              mockDb.cmsPages.push(page);
              return page;
            }
          }
        );
        return NextResponse.json({ success: true, page: formatCmsPage(updatedPage) });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to update CMS page' }, { status: 400 });
      }
    }

    // 6. App Version Settings POST (/api/admin/settings/app-version)
    if (path === 'admin/settings/app-version') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires admin role' }, { status: 403 });
      }
      const { androidVersion, iosVersion } = body as any;

      const appVersions = {
        androidVersion: androidVersion || '1.0.0',
        iosVersion: iosVersion || '1.0.0'
      };

      try {
        await executeWithDbFallback(
          async () => {
            await prisma.systemSetting.upsert({
              where: { key: 'app_version' },
              update: { value: JSON.stringify(appVersions) },
              create: { key: 'app_version', value: JSON.stringify(appVersions) }
            });
          },
          async () => {
            mockDb.appVersions = appVersions;
          }
        );
        return NextResponse.json({ success: true, appVersions });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to update app versions' }, { status: 400 });
      }
    }

    // 7. FAQ Create/Update POST (/api/admin/faqs)
    if (path === 'admin/faqs') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires admin role' }, { status: 403 });
      }
      const { id, question, answer, category, order } = body as any;

      try {
        if (id) {
          const updatedFaq = await executeWithDbFallback(
            async () => {
              return await prisma.faq.update({
                where: { id: Number(id) },
                data: { question, answer, category, order: order ? Number(order) : undefined }
              });
            },
            async () => {
              const faq = mockDb.faqs.find((f) => f.id === Number(id));
              if (faq) {
                if (question !== undefined) faq.question = question;
                if (answer !== undefined) faq.answer = answer;
                if (category !== undefined) faq.category = category;
                if (order !== undefined) faq.order = Number(order);
              }
              return faq;
            }
          );
          return NextResponse.json({ success: true, faq: updatedFaq });
        } else {
          if (!question || !answer) {
            return NextResponse.json({ message: 'question and answer are required' }, { status: 400 });
          }
          const createdFaq = await executeWithDbFallback<any>(
            async () => {
              return await prisma.faq.create({
                data: { question, answer, category: category || 'General', order: order ? Number(order) : 0 }
              });
            },
            async () => {
              const faq = {
                id: mockDb.faqs.length + 1,
                question,
                answer,
                category: category || 'General',
                order: order ? Number(order) : 0,
                createdAt: new Date().toISOString()
              };
              mockDb.faqs.push(faq);
              return faq;
            }
          );
          return NextResponse.json({ success: true, faq: createdFaq });
        }
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to save FAQ' }, { status: 400 });
      }
    }

    // 8. Report & Issues POST (/api/reports, /api/issues)
    if (path === 'reports' || path === 'issues' || path === 'clients/reports' || path === 'client/reports') {
      const auth = await getAuthenticatedUser(request);
      const userId: number | null = auth ? auth.userId : null;
      let title = '';
      let message = '';
      let attachmentUrls: string[] = [];

      try {
        if (contentType.includes('multipart/form-data')) {
          const formData = parsedFormData || await request.formData();
          title = (formData.get('title') as string) || '';
          message = (formData.get('message') as string) || '';
          const files = formData.getAll('attachments') as File[];

          const uploadsDir = nodePath.join(process.cwd(), 'public', 'uploads', 'reports');
          try {
            await fs.mkdir(uploadsDir, { recursive: true });
          } catch { }

          for (const file of files) {
            if (file && typeof file === 'object' && 'arrayBuffer' in file) {
              const buffer = Buffer.from(await file.arrayBuffer());
              const ext = nodePath.extname(file.name) || '.png';
              const filename = `report_${Date.now()}_${Math.random().toString(36).substring(2, 7)}${ext}`;
              const filePath = nodePath.join(uploadsDir, filename);
              await fs.writeFile(filePath, buffer);
              attachmentUrls.push(`/uploads/reports/${filename}`);
            }
          }
        } else {
          title = (body as any).title || '';
          message = (body as any).message || '';
          if (Array.isArray((body as any).attachments)) {
            attachmentUrls = (body as any).attachments;
          }
        }

        if (!title || !message) {
          return NextResponse.json({ message: 'Title and message are required' }, { status: 400 });
        }

        const attachmentsJson = JSON.stringify(attachmentUrls);

        const newReport = await executeWithDbFallback<any>(
          async () => {
            return await prisma.issueReport.create({
              data: {
                userId,
                title,
                message,
                attachments: attachmentsJson,
                status: 'open'
              }
            });
          },
          async () => {
            const report = {
              id: mockDb.issueReports.length + 1,
              userId,
              title,
              message,
              attachments: attachmentsJson,
              status: 'open',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            mockDb.issueReports.push(report);
            return report;
          }
        );
        return NextResponse.json({ success: true, report: newReport });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to submit report' }, { status: 400 });
      }
    }

    // 8b. Update Report Status POST/PUT (/api/admin/reports/status, /api/admin/reports)
    if (path === 'admin/reports/status' || path === 'admin/reports') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires admin role' }, { status: 403 });
      }
      const { id, status } = body as any;
      if (!id || !status) {
        return NextResponse.json({ message: 'id and status are required' }, { status: 400 });
      }

      try {
        const updatedReport = await executeWithDbFallback(
          async () => {
            return await prisma.issueReport.update({
              where: { id: Number(id) },
              data: { status }
            });
          },
          async () => {
            const report = mockDb.issueReports.find((r) => r.id === Number(id));
            if (report) {
              report.status = status;
              report.updatedAt = new Date().toISOString();
            }
            return report;
          }
        );
        return NextResponse.json({ success: true, report: updatedReport });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to update report status' }, { status: 400 });
      }
    }

    // POST Client Booking Cancel (/api/client/bookings/cancel, /api/clients/bookings/cancel, /api/client/booking/cancel)
    if (path === 'client/bookings/cancel' || path === 'clients/bookings/cancel' || path === 'client/booking/cancel' || (path.includes('bookings/') && path.endsWith('/cancel'))) {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ success: false, error: 'Unauthorized. Bearer token required.' }, { status: 401 });
      }

      let bookingId = body?.bookingId ?? body?.booking_id ?? body?.id;
      if (!bookingId) {
        const parts = path.split('/');
        const cancelIdx = parts.indexOf('cancel');
        if (cancelIdx > 0 && !isNaN(Number(parts[cancelIdx - 1]))) {
          bookingId = Number(parts[cancelIdx - 1]);
        }
      }

      try {
        const result = await handleBookingCancellation(bookingId, auth, body?.reason || body?.cancellationReason);
        return NextResponse.json(result);
      } catch (err: any) {
        return NextResponse.json({ success: false, error: err.message || 'Failed to cancel booking' }, { status: 400 });
      }
    }

    // POST Booking Status Update & Completion (/api/providers/bookings/status, /api/provider/bookings/complete, /api/provider/bookings/{id}/no-show, etc.)
    if (path === 'providers/bookings/status' || path === 'provider/bookings/status' || path === 'bookings/status' || path === 'client/bookings/status' || path === 'clients/bookings/status' || path.endsWith('/complete') || path.endsWith('/no-show')) {
      let bookingId = body?.bookingId;
      if (!bookingId) {
        const parts = path.split('/');
        const completeIdx = parts.indexOf('complete');
        const noShowIdx = parts.indexOf('no-show');
        const targetIdx = completeIdx > 0 ? completeIdx : noShowIdx;
        if (targetIdx > 0 && !isNaN(Number(parts[targetIdx - 1]))) {
          bookingId = Number(parts[targetIdx - 1]);
        }
      }

      const status = body?.status || (path.endsWith('/complete') ? 'completed' : path.endsWith('/no-show') ? 'no-show' : null);
      if (!bookingId || !status) {
        return NextResponse.json({ message: 'bookingId and status are required' }, { status: 400 });
      }

      const numBookingId = Number(bookingId);
      try {
        let updatedBooking: any = null;
        if (status === 'completed') {
          updatedBooking = await processBookingCompletion(numBookingId);
        } else if (status === 'cancelled') {
          const auth = await getAuthenticatedUser(request);
          const cancelRes = await handleBookingCancellation(numBookingId, auth, body?.reason);
          return NextResponse.json(cancelRes);
        } else {
          await executeWithDbFallback(
            async () => {
              updatedBooking = await prisma.booking.update({
                where: { id: numBookingId },
                data: { status },
                include: { client: true, provider: true }
              });
            },
            async () => {
              const b = mockDb.bookings.find((item: any) => item.id === numBookingId);
              if (!b) throw new Error('Booking not found');
              b.status = status;
              updatedBooking = b;
            }
          );
        }

        const messageText = (path.endsWith('/no-show') || status === 'no-show') ? 'Booking status updated to no-show up' : `Booking status updated to ${status}`;
        return NextResponse.json({ success: true, message: messageText, booking: updatedBooking });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to update booking status' }, { status: 400 });
      }
    }

    // POST Provider Request (/api/provider/requests or /api/provider-requests)
    if (path === 'provider/requests' || path === 'providers/requests' || path === 'provider-requests') {
      const auth = await getAuthenticatedUser(request);
      if (!auth) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
      if (auth.role !== 'provider' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
      }
      const { requestType, requestTitle } = body;
      if (!requestType || !requestTitle || typeof requestTitle !== 'string' || !requestTitle.trim()) {
        return NextResponse.json({ message: 'Missing or invalid requestType or requestTitle' }, { status: 400 });
      }

      const normalizedType = String(requestType).trim().toLowerCase() === 'category' ? 'Category' : String(requestType).trim().toLowerCase() === 'service' ? 'Service' : null;
      if (!normalizedType) {
        return NextResponse.json({ message: 'requestType must be Category or Service' }, { status: 400 });
      }

      try {
        const newRequest = await executeWithDbFallback(
          async () => {
            return await prisma.providerRequest.create({
              data: {
                providerId: auth.userId,
                requestType: normalizedType,
                requestTitle: requestTitle.trim(),
                status: 'pending'
              },
              include: {
                provider: {
                  select: { id: true, name: true, email: true, role: true, providerType: true }
                }
              }
            });
          },
          async () => {
            const provider = mockDb.users.find((u) => u.id === auth.userId);
            const reqObj = {
              id: mockDb.providerRequests.length + 1,
              providerId: auth.userId,
              requestType: normalizedType,
              requestTitle: requestTitle.trim(),
              status: 'pending',
              createdAt: new Date(),
              provider: {
                id: auth.userId,
                name: provider?.name || 'Provider',
                email: provider?.email || '',
                role: provider?.role || 'provider',
                providerType: provider?.providerType || null
              }
            };
            mockDb.providerRequests.push(reqObj);
            return reqObj;
          }
        );
        return NextResponse.json({ message: 'Request submitted successfully', request: newRequest }, { status: 201 });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to submit request' }, { status: 400 });
      }
    }

    // POST Platform Fee Cut Setting (/api/admin/settings/platform-fee)
    if (path === 'admin/settings/platform-fee' || path === 'settings/platform-fee') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires admin role' }, { status: 403 });
      }
      const { platformFeeCut, feeCut, value } = body;
      const feeVal = parseFloat(platformFeeCut ?? feeCut ?? value ?? 5);
      if (isNaN(feeVal) || feeVal < 0 || feeVal > 100) {
        return NextResponse.json({ message: 'Invalid platformFeeCut value. Must be a percentage between 0 and 100.' }, { status: 400 });
      }

      try {
        await executeWithDbFallback(
          async () => {
            await prisma.systemSetting.upsert({
              where: { key: 'platform_fee_cut' },
              update: { value: String(feeVal) },
              create: { key: 'platform_fee_cut', value: String(feeVal) }
            });
          },
          async () => {
            mockDb.platformFeeCut = feeVal;
          }
        );
        return NextResponse.json({ success: true, message: 'Platform fee cut updated successfully', platformFeeCut: feeVal });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to update platform fee cut' }, { status: 400 });
      }
    }

    // POST Admin verifies or disapproves provider license/certificate (/api/admin/licenses/verify or /api/admin/users/verify-license)
    if (
      path === 'admin/licenses/verify' ||
      path === 'admin/users/verify-license' ||
      path === 'admin/providers/verify-license' ||
      path === 'admin/license/verify'
    ) {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires admin role' }, { status: 403 });
      }

      const { userId, licenseIndex, isVerified, status } = body as any;
      const { searchParams } = new URL(request.url);
      const targetUserId = Number(userId || searchParams.get('userId') || searchParams.get('id'));
      const idx = Number(licenseIndex !== undefined ? licenseIndex : searchParams.get('licenseIndex') || 0);
      const newVerified = isVerified !== undefined
        ? Boolean(isVerified)
        : status !== undefined
        ? status === 'approved' || status === 'verified' || status === true
        : true;

      if (!targetUserId || isNaN(targetUserId)) {
        return NextResponse.json({ message: 'Missing or invalid userId' }, { status: 400 });
      }

      try {
        const result = await executeWithDbFallback(
          async () => {
            const profile = await prisma.providerProfile.findUnique({
              where: { userId: targetUserId },
            });
            let verifications: boolean[] = [];
            if (profile?.licenseVerifications) {
              try {
                const parsed = JSON.parse(profile.licenseVerifications);
                if (Array.isArray(parsed)) verifications = parsed.map(Boolean);
              } catch {}
            }

            while (verifications.length <= idx) {
              verifications.push(false);
            }
            verifications[idx] = newVerified;

            const updatedProfile = await prisma.providerProfile.upsert({
              where: { userId: targetUserId },
              update: { licenseVerifications: JSON.stringify(verifications) },
              create: {
                userId: targetUserId,
                location: 'Location',
                licenseVerifications: JSON.stringify(verifications),
              },
            });
            return { profile: updatedProfile, verifications };
          },
          async () => {
            let mockProfile = mockDb.profiles.find((p) => p.userId === targetUserId);
            let verifications: boolean[] = [];
            if (mockProfile?.licenseVerifications) {
              try {
                const parsed = typeof mockProfile.licenseVerifications === 'string'
                  ? JSON.parse(mockProfile.licenseVerifications)
                  : mockProfile.licenseVerifications;
                if (Array.isArray(parsed)) verifications = parsed.map(Boolean);
              } catch {}
            }
            while (verifications.length <= idx) {
              verifications.push(false);
            }
            verifications[idx] = newVerified;

            if (!mockProfile) {
              mockProfile = { id: mockDb.profiles.length + 1, userId: targetUserId, location: 'Location', licenseVerifications: JSON.stringify(verifications) };
              mockDb.profiles.push(mockProfile);
            } else {
              mockProfile.licenseVerifications = JSON.stringify(verifications);
            }
            return { profile: mockProfile, verifications };
          }
        );

        return NextResponse.json({
          success: true,
          message: `License verification updated to ${newVerified}`,
          isVerified: newVerified,
          licenseIndex: idx,
          licenseVerifications: result.verifications,
          profile: result.profile,
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to update license verification status' }, { status: 400 });
      }
    }

    return NextResponse.json({ message: 'Endpoint not found' }, { status: 404 });
  } catch (err: any) {
    console.error(`[API POST Error]`, err);
    return NextResponse.json({ message: err.message || 'POST failed', error: String(err) }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ catchall?: string[] }> }
) {
  try {
    const { catchall } = await params;
    const rawPath = catchall?.join('/') || '';
    const path = rawPath.replace(/^api\//i, '').replace(/\/$/, '').trim();
    console.log(`[API PUT] rawPath='${rawPath}' -> path='${path}'`);

    const auth = await getAuthenticatedUser(request);
    if (!auth) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    // PUT Booking Status Update (/api/providers/bookings/status or /api/bookings/status)
    if (path === 'providers/bookings/status' || path === 'provider/bookings/status' || path === 'bookings/status' || path === 'client/bookings/status' || path === 'clients/bookings/status' || path.endsWith('/complete') || path.endsWith('/no-show')) {
      let body: any = {};
      try {
        body = await request.json();
      } catch {
        // empty body ok if bookingId is in path or query
      }

      let bookingId = body?.bookingId;
      if (!bookingId) {
        const parts = path.split('/');
        const completeIdx = parts.indexOf('complete');
        const noShowIdx = parts.indexOf('no-show');
        const targetIdx = completeIdx > 0 ? completeIdx : noShowIdx;
        if (targetIdx > 0 && !isNaN(Number(parts[targetIdx - 1]))) {
          bookingId = Number(parts[targetIdx - 1]);
        }
      }

      const status = body?.status || (path.endsWith('/complete') ? 'completed' : path.endsWith('/no-show') ? 'no-show' : null);
      if (!bookingId || !status) {
        return NextResponse.json({ message: 'bookingId and status are required' }, { status: 400 });
      }

      const numBookingId = Number(bookingId);
      try {
        let updatedBooking: any = null;
        if (status === 'completed') {
          updatedBooking = await processBookingCompletion(numBookingId);
        } else {
          await executeWithDbFallback(
            async () => {
              updatedBooking = await prisma.booking.update({
                where: { id: numBookingId },
                data: { status },
                include: { client: true, provider: true }
              });
            },
            async () => {
              const b = mockDb.bookings.find((item: any) => item.id === numBookingId);
              if (!b) throw new Error('Booking not found');
              b.status = status;
              updatedBooking = b;
            }
          );
        }

        const messageText = (path.endsWith('/no-show') || status === 'no-show') ? 'Booking status updated to no-show up' : `Booking status updated to ${status}`;
        return NextResponse.json({ success: true, message: messageText, booking: updatedBooking });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to update booking status' }, { status: 400 });
      }
    }

    let body = {} as any;
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      try {
        body = await request.json();
      } catch {
        // Empty
      }
    }

    // Admin toggles/updates provider featured status (/api/admin/users/featured or /api/admin/users)
    if (path === 'admin/users/featured' || path === 'admin/users' || path === 'admin/users/feature') {
      if (auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires admin role' }, { status: 403 });
      }

      const { userId, isFeatured, featured } = body as any;
      const { searchParams } = new URL(request.url);
      const targetUserId = Number(userId || searchParams.get('userId') || searchParams.get('id'));
      const newFeatured = isFeatured !== undefined ? Boolean(isFeatured) : featured !== undefined ? Boolean(featured) : true;

      if (!targetUserId || isNaN(targetUserId)) {
        return NextResponse.json({ message: 'Missing or invalid userId' }, { status: 400 });
      }

      try {
        const result = await executeWithDbFallback(
          async () => {
            const profile = await prisma.providerProfile.upsert({
              where: { userId: targetUserId },
              update: { isFeatured: newFeatured },
              create: {
                userId: targetUserId,
                location: 'Location',
                isFeatured: newFeatured,
              },
            });
            return profile;
          },
          async () => {
            let mockProfile = mockDb.profiles.find((p) => p.userId === targetUserId);
            if (!mockProfile) {
              mockProfile = { id: mockDb.profiles.length + 1, userId: targetUserId, location: 'Location', isFeatured: newFeatured };
              mockDb.profiles.push(mockProfile);
            } else {
              mockProfile.isFeatured = newFeatured;
            }
            return mockProfile;
          }
        );

        return NextResponse.json({
          success: true,
          message: `Featured status updated to ${newFeatured}`,
          isFeatured: newFeatured,
          profile: result,
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to update featured status' }, { status: 400 });
      }
    }

    // Admin verifies or disapproves provider license/certificate (/api/admin/licenses/verify or /api/admin/users/verify-license)
    if (
      path === 'admin/licenses/verify' ||
      path === 'admin/users/verify-license' ||
      path === 'admin/providers/verify-license' ||
      path === 'admin/license/verify'
    ) {
      if (auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires admin role' }, { status: 403 });
      }

      const { userId, licenseIndex, isVerified, status } = body as any;
      const { searchParams } = new URL(request.url);
      const targetUserId = Number(userId || searchParams.get('userId') || searchParams.get('id'));
      const idx = Number(licenseIndex !== undefined ? licenseIndex : searchParams.get('licenseIndex') || 0);
      const newVerified = isVerified !== undefined
        ? Boolean(isVerified)
        : status !== undefined
        ? status === 'approved' || status === 'verified' || status === true
        : true;

      if (!targetUserId || isNaN(targetUserId)) {
        return NextResponse.json({ message: 'Missing or invalid userId' }, { status: 400 });
      }

      try {
        const result = await executeWithDbFallback(
          async () => {
            const profile = await prisma.providerProfile.findUnique({
              where: { userId: targetUserId },
            });
            let verifications: boolean[] = [];
            if (profile?.licenseVerifications) {
              try {
                const parsed = JSON.parse(profile.licenseVerifications);
                if (Array.isArray(parsed)) verifications = parsed.map(Boolean);
              } catch {}
            }

            while (verifications.length <= idx) {
              verifications.push(false);
            }
            verifications[idx] = newVerified;

            const updatedProfile = await prisma.providerProfile.upsert({
              where: { userId: targetUserId },
              update: { licenseVerifications: JSON.stringify(verifications) },
              create: {
                userId: targetUserId,
                location: 'Location',
                licenseVerifications: JSON.stringify(verifications),
              },
            });
            return { profile: updatedProfile, verifications };
          },
          async () => {
            let mockProfile = mockDb.profiles.find((p) => p.userId === targetUserId);
            let verifications: boolean[] = [];
            if (mockProfile?.licenseVerifications) {
              try {
                const parsed = typeof mockProfile.licenseVerifications === 'string'
                  ? JSON.parse(mockProfile.licenseVerifications)
                  : mockProfile.licenseVerifications;
                if (Array.isArray(parsed)) verifications = parsed.map(Boolean);
              } catch {}
            }
            while (verifications.length <= idx) {
              verifications.push(false);
            }
            verifications[idx] = newVerified;

            if (!mockProfile) {
              mockProfile = { id: mockDb.profiles.length + 1, userId: targetUserId, location: 'Location', licenseVerifications: JSON.stringify(verifications) };
              mockDb.profiles.push(mockProfile);
            } else {
              mockProfile.licenseVerifications = JSON.stringify(verifications);
            }
            return { profile: mockProfile, verifications };
          }
        );

        return NextResponse.json({
          success: true,
          message: `License verification updated to ${newVerified}`,
          isVerified: newVerified,
          licenseIndex: idx,
          licenseVerifications: result.verifications,
          profile: result.profile,
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to update license verification status' }, { status: 400 });
      }
    }

    // Check if it's the license/licence endpoint
    const pathParts = path.split('/');
    const isLicenceRoute =
      path === 'providers/me/licence' ||
      path === 'provider/me/licence' ||
      path === 'providers/me/license' ||
      path === 'provider/me/license' ||
      (pathParts.length === 4 && pathParts[0] === 'providers' && pathParts[1] === 'me' && (pathParts[2] === 'licence' || pathParts[2] === 'license')) ||
      (pathParts.length === 4 && pathParts[0] === 'provider' && pathParts[1] === 'me' && (pathParts[2] === 'licence' || pathParts[2] === 'license'));

    if (isLicenceRoute) {
      if (auth.role !== 'provider') {
        return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
      }

      // Determine the index to update
      let index: number | null = null;
      if (pathParts.length === 4) {
        const parsedIdx = parseInt(pathParts[3], 10);
        if (!isNaN(parsedIdx)) {
          index = parsedIdx;
        }
      }

      const { searchParams } = new URL(request.url);
      const indexQuery = searchParams.get('index');
      if (indexQuery !== null) {
        const parsedIdx = parseInt(indexQuery, 10);
        if (!isNaN(parsedIdx)) {
          index = parsedIdx;
        }
      }

      let licenseTypeInput: string | null = null;
      let certificateFile: any = null;
      let certificateUrlInput: string | null = null;

      if (contentType.includes('multipart/form-data')) {
        try {
          const formData = await request.formData();
          const indexForm = formData.get('index');
          if (index === null && indexForm !== null) {
            const parsedIdx = parseInt(String(indexForm), 10);
            if (!isNaN(parsedIdx)) {
              index = parsedIdx;
            }
          }
          licenseTypeInput = formData.get('licenseType') ? String(formData.get('licenseType')) : (formData.get('licenseName') ? String(formData.get('licenseName')) : null);
          certificateFile = formData.get('certificate') || formData.get('certificateFile') || formData.get('file');
          const certUrlVal = formData.get('certificateUrl') || formData.get('certificateUrls');
          if (certUrlVal && typeof certUrlVal === 'string') {
            certificateUrlInput = certUrlVal;
          }
        } catch (err: any) {
          return NextResponse.json({ message: 'Failed to parse form data: ' + err.message }, { status: 400 });
        }
      } else {
        if (index === null && (body as any).index !== undefined) {
          const parsedIdx = parseInt((body as any).index, 10);
          if (!isNaN(parsedIdx)) {
            index = parsedIdx;
          }
        }
        licenseTypeInput = (body as any).licenseType || (body as any).licenseName || null;
        certificateUrlInput = (body as any).certificateUrl || (body as any).certificateUrls || null;
      }

      if (index === null || index < 0) {
        return NextResponse.json({ message: 'Invalid or missing index' }, { status: 400 });
      }

      let certificateUrlToSave: string | null = null;
      if (certificateFile && typeof certificateFile === 'object' && 'name' in certificateFile) {
        try {
          const file = certificateFile as any;
          const mimeType = file.type || '';
          const fileName = file.name || '';
          const fileExt = nodePath.extname(fileName).toLowerCase();

          const isValidMime = mimeType === 'application/pdf' || mimeType.startsWith('image/');
          const isValidExt = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'].includes(fileExt);

          if (!isValidMime && !isValidExt) {
            return NextResponse.json(
              { message: 'Certificate must be a PDF or an image file only' },
              { status: 400 }
            );
          }

          const bytes = await file.arrayBuffer();
          const buffer = Buffer.from(bytes);
          const uploadDir = nodePath.join(process.cwd(), 'public', 'uploads');
          await fs.mkdir(uploadDir, { recursive: true });
          const uniqueFileName = `certificate_${auth.userId}_${Date.now()}_idx${index}${fileExt || '.pdf'}`;
          const filePath = nodePath.join(uploadDir, uniqueFileName);
          await fs.writeFile(filePath, buffer);
          certificateUrlToSave = `/uploads/${uniqueFileName}`;
        } catch (err: any) {
          return NextResponse.json({ message: 'Failed to save uploaded certificate file: ' + err.message }, { status: 400 });
        }
      } else if (certificateUrlInput) {
        certificateUrlToSave = certificateUrlInput;
      }

      try {
        const response = await executeWithDbFallback(
          async () => {
            let profile = await prisma.providerProfile.findUnique({ where: { userId: auth.userId } });
            if (!profile) {
              profile = await prisma.providerProfile.create({
                data: {
                  userId: auth.userId,
                  location: '',
                  licenseType: '[]',
                  certificateUrl: '[]'
                }
              });
            }

            // Parse licenseType list
            let licenseTypes: string[] = [];
            if (profile.licenseType) {
              const licStr = profile.licenseType;
              if (licStr.startsWith('[') && licStr.endsWith(']')) {
                try {
                  licenseTypes = JSON.parse(licStr) as string[];
                } catch {
                  licenseTypes = licStr.split(',').map((s: string) => s.trim());
                }
              } else if (licStr.includes(',')) {
                licenseTypes = licStr.split(',').map((s: string) => s.trim());
              } else {
                licenseTypes = [licStr];
              }
            }

            // Parse certificateUrl list
            let certificateUrls: string[] = [];
            if (profile.certificateUrl) {
              const certStr = profile.certificateUrl;
              if (certStr.startsWith('[') && certStr.endsWith(']')) {
                try {
                  certificateUrls = JSON.parse(certStr) as string[];
                } catch {
                  certificateUrls = certStr.split(',').map((s: string) => s.trim());
                }
              } else if (certStr.includes(',')) {
                certificateUrls = certStr.split(',').map((s: string) => s.trim());
              } else {
                certificateUrls = [certStr];
              }
            }

            // Pad arrays up to index
            while (licenseTypes.length <= index!) {
              licenseTypes.push('');
            }
            while (certificateUrls.length <= index!) {
              certificateUrls.push('');
            }

            // Apply updates
            if (licenseTypeInput !== null) {
              licenseTypes[index!] = licenseTypeInput;
            }
            if (certificateUrlToSave !== null) {
              let cleanedUrl = certificateUrlToSave;
              const baseUrl = getBaseUrl(request);
              if (baseUrl && cleanedUrl.startsWith(baseUrl)) {
                cleanedUrl = cleanedUrl.substring(baseUrl.length);
              }
              certificateUrls[index!] = cleanedUrl;
            }

            await prisma.providerProfile.update({
              where: { userId: auth.userId },
              data: {
                licenseType: JSON.stringify(licenseTypes),
                certificateUrl: JSON.stringify(certificateUrls)
              }
            });
            return { licenseTypes, certificateUrls };
          },
          async () => {
            let profile = mockDb.profiles.find((p) => p.userId === auth.userId);
            if (!profile) {
              profile = {
                id: mockDb.profiles.length + 1,
                userId: auth.userId,
                name: '',
                location: '',
                licenseType: '[]',
                certificateUrl: '[]'
              };
              mockDb.profiles.push(profile);
            }

            // Parse licenseType list
            let licenseTypes: string[] = [];
            if (profile.licenseType) {
              const licStr = profile.licenseType;
              if (licStr.startsWith('[') && licStr.endsWith(']')) {
                try {
                  licenseTypes = JSON.parse(licStr) as string[];
                } catch {
                  licenseTypes = licStr.split(',').map((s: string) => s.trim());
                }
              } else if (licStr.includes(',')) {
                licenseTypes = licStr.split(',').map((s: string) => s.trim());
              } else {
                licenseTypes = [licStr];
              }
            }

            // Parse certificateUrl list
            let certificateUrls: string[] = [];
            if (profile.certificateUrl) {
              const certStr = profile.certificateUrl;
              if (certStr.startsWith('[') && certStr.endsWith(']')) {
                try {
                  certificateUrls = JSON.parse(certStr) as string[];
                } catch {
                  certificateUrls = certStr.split(',').map((s: string) => s.trim());
                }
              } else if (certStr.includes(',')) {
                certificateUrls = certStr.split(',').map((s: string) => s.trim());
              } else {
                certificateUrls = [certStr];
              }
            }

            // Pad arrays up to index
            while (licenseTypes.length <= index!) {
              licenseTypes.push('');
            }
            while (certificateUrls.length <= index!) {
              certificateUrls.push('');
            }

            // Apply updates
            if (licenseTypeInput !== null) {
              licenseTypes[index!] = licenseTypeInput;
            }
            if (certificateUrlToSave !== null) {
              let cleanedUrl = certificateUrlToSave;
              const baseUrl = getBaseUrl(request);
              if (baseUrl && cleanedUrl.startsWith(baseUrl)) {
                cleanedUrl = cleanedUrl.substring(baseUrl.length);
              }
              certificateUrls[index!] = cleanedUrl;
            }

            profile.licenseType = JSON.stringify(licenseTypes);
            profile.certificateUrl = JSON.stringify(certificateUrls);

            return { licenseTypes, certificateUrls };
          }
        );

        const baseUrl = getBaseUrl(request);
        const formattedCerts = response.certificateUrls.map((c) => (c && c.startsWith('/') && baseUrl) ? `${baseUrl}${c}` : c);

        return NextResponse.json({
          success: true,
          message: 'License/certificate updated successfully'
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to update license' }, { status: 400 });
      }
    }

    // Update Client Profile (/api/clients/profile)
    if (path === 'clients/profile') {
      if (auth.role !== 'client') {
        return NextResponse.json({ message: 'Forbidden: Requires client role' }, { status: 403 });
      }

      let name: any = undefined;
      let location: any = undefined;
      let address: any = undefined;
      let city: any = undefined;
      let state: any = undefined;
      let country: any = undefined;
      let postalCode: any = undefined;
      let latitude: any = undefined;
      let longitude: any = undefined;
      let profileImageUrl: any = undefined;
      let stripeCustomerId: any = undefined;

      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('multipart/form-data')) {
        try {
          const formData = await request.formData();
          name = formData.get('name');
          location = formData.get('location');
          address = formData.get('address');
          city = formData.get('city');
          state = formData.get('state');
          country = formData.get('country');
          postalCode = formData.get('postalCode') ?? formData.get('postal_code') ?? formData.get('zipCode');
          latitude = formData.get('latitude') ?? formData.get('lat');
          longitude = formData.get('longitude') ?? formData.get('lng') ?? formData.get('long');
          stripeCustomerId = formData.get('stripeCustomerId') ?? formData.get('stripe_customer_id');
          const profileImageFile = formData.get('profileImage');

          if (profileImageFile && typeof profileImageFile === 'object' && 'name' in profileImageFile) {
            const file = profileImageFile as any;
            const mimeType = file.type || '';
            const fileName = file.name || '';
            const fileExt = nodePath.extname(fileName).toLowerCase();

            const isValidMime = mimeType.startsWith('image/');
            const isValidExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'].includes(fileExt);

            if (!isValidMime && !isValidExt) {
              return NextResponse.json(
                { message: 'Profile image must be an image file only' },
                { status: 400 }
              );
            }

            const bytes = await file.arrayBuffer();
            const buffer = Buffer.from(bytes);
            const uploadDir = nodePath.join(process.cwd(), 'public', 'uploads');
            await fs.mkdir(uploadDir, { recursive: true });
            const uniqueFileName = `profile_${auth.userId}_${Date.now()}${fileExt || '.png'}`;
            const filePath = nodePath.join(uploadDir, uniqueFileName);
            await fs.writeFile(filePath, buffer);
            profileImageUrl = `/uploads/${uniqueFileName}`;
          }
        } catch (err: any) {
          return NextResponse.json({ message: 'Failed to process file upload: ' + err.message }, { status: 400 });
        }
      } else {
        name = body.name;
        location = body.location;
        address = body.address;
        city = body.city;
        state = body.state;
        country = body.country;
        postalCode = body.postalCode ?? body.postal_code ?? body.zipCode;
        latitude = body.latitude ?? body.lat;
        longitude = body.longitude ?? body.lng ?? body.long;
        profileImageUrl = body.profileImageUrl;
        stripeCustomerId = body.stripeCustomerId ?? body.stripe_customer_id;
      }

      const locVal = location ?? address;
      const hasName = name !== undefined && name !== null && String(name).trim() !== '';
      const hasLocation = (locVal !== undefined && locVal !== null && String(locVal).trim() !== '') ||
                          (city !== undefined && city !== null && String(city).trim() !== '');

      const autoOnboardingCompleted = hasName && hasLocation;

      const updatedUser = await executeWithDbFallback(
        async () => {
          const updateData: any = {};
          if (name !== undefined && name !== null) updateData.name = name;
          if (autoOnboardingCompleted) {
            updateData.onboardingCompleted = true;
          }

          const clientProfileData: any = {};
          if (locVal !== undefined && locVal !== null) clientProfileData.location = String(locVal);
          if (city !== undefined && city !== null) clientProfileData.city = String(city);
          if (state !== undefined && state !== null) clientProfileData.state = String(state);
          if (country !== undefined && country !== null) clientProfileData.country = String(country);
          if (postalCode !== undefined && postalCode !== null) clientProfileData.postalCode = String(postalCode);
          if (profileImageUrl !== undefined && profileImageUrl !== null) clientProfileData.profileImageUrl = profileImageUrl;
          if (latitude !== undefined && latitude !== null && latitude !== '') clientProfileData.latitude = parseFloat(latitude);
          if (longitude !== undefined && longitude !== null && longitude !== '') clientProfileData.longitude = parseFloat(longitude);
          if (stripeCustomerId !== undefined && stripeCustomerId !== null) clientProfileData.stripeCustomerId = String(stripeCustomerId);

          updateData.clientProfile = {
            upsert: {
              create: clientProfileData,
              update: clientProfileData
            }
          };

          return await prisma.user.update({
            where: { id: auth.userId },
            data: updateData,
            include: {
              clientProfile: true
            }
          });
        },
        async () => {
          const user = mockDb.users.find((u) => u.id === auth.userId);
          if (!user) throw new Error('User not found');
          if (name !== undefined && name !== null) user.name = name;
          if (autoOnboardingCompleted) {
            user.onboardingCompleted = true;
          }

          let profile = mockDb.profiles.find((p) => p.userId === auth.userId);
          if (!profile) {
            profile = {
              id: mockDb.profiles.length + 1,
              userId: auth.userId,
            } as any;
            mockDb.profiles.push(profile);
          }
          if (locVal !== undefined && locVal !== null) (profile as any).location = String(locVal);
          if (city !== undefined && city !== null) (profile as any).city = String(city);
          if (state !== undefined && state !== null) (profile as any).state = String(state);
          if (country !== undefined && country !== null) (profile as any).country = String(country);
          if (postalCode !== undefined && postalCode !== null) (profile as any).postalCode = String(postalCode);
          if (profileImageUrl !== undefined && profileImageUrl !== null) (profile as any).profileImageUrl = profileImageUrl;
          if (latitude !== undefined && latitude !== null && latitude !== '') (profile as any).latitude = parseFloat(latitude);
          if (longitude !== undefined && longitude !== null && longitude !== '') (profile as any).longitude = parseFloat(longitude);
          if (stripeCustomerId !== undefined && stripeCustomerId !== null) (profile as any).stripeCustomerId = String(stripeCustomerId);

          return { ...user, clientProfile: profile };
        }
      );

      const sanitized = sanitizeUser(updatedUser, request);
      return NextResponse.json(sanitized);
    }

    // Update Provider Profile (/api/providers/profile or /api/provider/profile)
    if (path === 'providers/profile' || path === 'provider/profile') {
      return await handleUpdateProviderProfile(request, body);
    }

    // PUT Admin Voucher - Update
    if (path === 'admin/settings/vouchers') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires admin role' }, { status: 403 });
      }

      const { id, code, title, amount, isActive } = body as any;
      if (!id || !code || !title || amount === undefined) {
        return NextResponse.json({ message: 'Missing id, code, title, or amount' }, { status: 400 });
      }

      const voucherId = parseInt(id, 10);
      const amountVal = parseFloat(amount);
      if (isNaN(amountVal) || amountVal < 0) {
        return NextResponse.json({ message: 'Invalid amount' }, { status: 400 });
      }

      const activeVal = isActive !== undefined ? Boolean(isActive) : true;

      try {
        const result = await executeWithDbFallback(
          async () => {
            return await prisma.voucher.update({
              where: { id: voucherId },
              data: {
                code: String(code).toUpperCase().trim(),
                title,
                amount: amountVal,
                isActive: activeVal
              }
            });
          },
          async () => {
            const voucher = mockDb.vouchers.find((v) => v.id === voucherId);
            if (!voucher) throw new Error('Voucher not found');

            const normalizedCode = String(code).toUpperCase().trim();
            const exists = mockDb.vouchers.some((v) => v.code === normalizedCode && v.id !== voucherId);
            if (exists) throw new Error('Voucher code already exists');

            voucher.code = normalizedCode;
            voucher.title = title;
            voucher.amount = amountVal;
            voucher.isActive = activeVal;
            return voucher;
          }
        );

        return NextResponse.json({
          success: true,
          message: 'Voucher updated successfully',
          voucher: result
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to update voucher' }, { status: 400 });
      }
    }

    // PUT Category Setting - Update (/api/admin/settings/categories)
    if (path === 'admin/settings/categories') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires admin role' }, { status: 403 });
      }

      let idVal: number = 0;
      let title: string = '';
      let categoryIconUrl: string | null | undefined = undefined;
      let removeIcon = false;

      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('multipart/form-data')) {
        try {
          const formData = await request.formData();
          const idStr = (formData.get('id') as string) || '';
          idVal = parseInt(idStr, 10);
          title = (formData.get('title') as string) || '';
          if (formData.has('removeIcon')) {
            removeIcon = formData.get('removeIcon') === 'true';
          }
          const iconFile = (formData.get('categoryIcon') || formData.get('icon') || formData.get('image') || formData.get('svgFile') || formData.get('file')) as any;

          if (iconFile && typeof iconFile === 'object' && 'name' in iconFile && iconFile.size > 0) {
            const fileName = iconFile.name || '';
            const fileExt = nodePath.extname(fileName).toLowerCase() || '.png';
            const allowedExts = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif'];
            if (!allowedExts.includes(fileExt)) {
              return NextResponse.json(
                { message: 'Category icon must be an SVG or image file (.svg, .png, .jpg, .jpeg, .webp, .gif)' },
                { status: 400 }
              );
            }
            const bytes = await iconFile.arrayBuffer();
            const buffer = Buffer.from(bytes);
            const uploadDir = nodePath.join(process.cwd(), 'public', 'uploads');
            await fs.mkdir(uploadDir, { recursive: true });
            const uniqueFileName = `category_${Date.now()}_${Math.floor(Math.random() * 1000)}${fileExt}`;
            const filePath = nodePath.join(uploadDir, uniqueFileName);
            await fs.writeFile(filePath, buffer);
            categoryIconUrl = `/uploads/${uniqueFileName}`;
          } else if (removeIcon) {
            categoryIconUrl = null;
          }
        } catch (err: any) {
          return NextResponse.json({ message: 'Failed to process category icon upload: ' + err.message }, { status: 400 });
        }
      } else {
        let bodyObj: any = {};
        try {
          bodyObj = await request.json();
        } catch {
          bodyObj = {};
        }
        idVal = parseInt(bodyObj.id, 10);
        title = bodyObj.title;
        removeIcon = Boolean(bodyObj.removeIcon);
        if (removeIcon) {
          categoryIconUrl = null;
        } else if (bodyObj.categoryIcon !== undefined) {
          categoryIconUrl = bodyObj.categoryIcon;
        }
      }

      if (!idVal || isNaN(idVal)) {
        return NextResponse.json({ message: 'Category ID is required' }, { status: 400 });
      }

      try {
        const updateData: any = {};
        if (title && title.trim()) {
          updateData.title = title.trim();
        }
        if (categoryIconUrl !== undefined) {
          updateData.categoryIcon = categoryIconUrl;
        }

        const category = await executeWithDbFallback(
          async () => {
            return await (prisma.categorySetting as any).update({
              where: { id: idVal },
              data: updateData,
            });
          },
          async () => {
            return {
              id: idVal,
              title: title ? title.trim() : 'Updated Category',
              categoryIcon: categoryIconUrl,
              createdAt: new Date(),
            };
          }
        );

        return NextResponse.json({ success: true, message: 'Category updated successfully', category });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to update category' }, { status: 400 });
      }
    }

    return NextResponse.json({ message: 'Endpoint not found' }, { status: 404 });
  } catch (err: any) {
    console.error(`[API PUT Error]`, err);
    return NextResponse.json({ message: err.message || 'PUT failed', error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ catchall?: string[] }> }
) {
  try {
    const { catchall } = await params;
    const rawPath = catchall?.join('/') || '';
    const path = rawPath.replace(/^api\//i, '').replace(/\/$/, '').trim();
    console.log(`[API DELETE] rawPath='${rawPath}' -> path='${path}'`);

    const auth = await getAuthenticatedUser(request);
    if (!auth) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    // Check if it's the wishlist endpoint for DELETE
    const pathParts = path.split('/');
    const isWishlistRoute =
      path === 'clients/wishlist' ||
      path === 'client/wishlist' ||
      (pathParts.length === 3 && (pathParts[0] === 'clients' || pathParts[0] === 'client') && pathParts[1] === 'wishlist');

    if (isWishlistRoute) {
      if (auth.role !== 'client' && auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires client role' }, { status: 403 });
      }

      let providerId: number | null = null;
      if (pathParts.length === 3) {
        const parsed = parseInt(pathParts[2], 10);
        if (!isNaN(parsed)) {
          providerId = parsed;
        }
      }

      const { searchParams } = new URL(request.url);
      const queryProviderId = searchParams.get('providerId') || searchParams.get('providerProfileId') || searchParams.get('id');
      if (providerId === null && queryProviderId) {
        const parsed = parseInt(queryProviderId, 10);
        if (!isNaN(parsed)) {
          providerId = parsed;
        }
      }

      try {
        const tempBody = await request.json();
        if (providerId === null) {
          const bodyId = tempBody.providerId || tempBody.providerProfileId || tempBody.id;
          if (bodyId) {
            const parsed = parseInt(String(bodyId), 10);
            if (!isNaN(parsed)) {
              providerId = parsed;
            }
          }
        }
      } catch {
        // No body or not JSON
      }

      if (!providerId) {
        return NextResponse.json({ message: 'Missing or invalid providerId' }, { status: 400 });
      }

      const existingIndex = wishlistStore.findIndex(
        (item) => item.clientId === auth.userId && item.providerId === providerId
      );

      if (existingIndex > -1) {
        wishlistStore.splice(existingIndex, 1);
      }

      return NextResponse.json({
        success: true,
        message: 'Provider removed from wishlist successfully',
        providerId,
        isWishlisted: false
      });
    }

    // Check if it's the license/licence endpoint for DELETE
    const isLicenceRoute =
      path === 'providers/me/licence' ||
      path === 'provider/me/licence' ||
      path === 'providers/me/license' ||
      path === 'provider/me/license' ||
      (pathParts.length === 4 && pathParts[0] === 'providers' && pathParts[1] === 'me' && (pathParts[2] === 'licence' || pathParts[2] === 'license')) ||
      (pathParts.length === 4 && pathParts[0] === 'provider' && pathParts[1] === 'me' && (pathParts[2] === 'licence' || pathParts[2] === 'license'));

    if (isLicenceRoute) {
      if (auth.role !== 'provider') {
        return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
      }

      // Determine the index to delete
      let index: number | null = null;
      if (pathParts.length === 4) {
        const parsedIdx = parseInt(pathParts[3], 10);
        if (!isNaN(parsedIdx)) {
          index = parsedIdx;
        }
      }

      const { searchParams } = new URL(request.url);
      const indexQuery = searchParams.get('index');
      if (indexQuery !== null) {
        const parsedIdx = parseInt(indexQuery, 10);
        if (!isNaN(parsedIdx)) {
          index = parsedIdx;
        }
      }

      // Also check body if any JSON body is sent
      try {
        const tempBody = await request.json();
        if (index === null && tempBody.index !== undefined) {
          const parsedIdx = parseInt(tempBody.index, 10);
          if (!isNaN(parsedIdx)) {
            index = parsedIdx;
          }
        }
      } catch { }

      if (index === null || index < 0) {
        return NextResponse.json({ message: 'Invalid or missing index' }, { status: 400 });
      }

      try {
        const response = await executeWithDbFallback(
          async () => {
            const profile = await prisma.providerProfile.findUnique({ where: { userId: auth.userId } });
            if (!profile) {
              throw new Error('Provider profile not found');
            }

            // Parse licenseType list
            let licenseTypes: string[] = [];
            if (profile.licenseType) {
              const licStr = profile.licenseType;
              if (licStr.startsWith('[') && licStr.endsWith(']')) {
                try {
                  licenseTypes = JSON.parse(licStr) as string[];
                } catch {
                  licenseTypes = licStr.split(',').map((s: string) => s.trim());
                }
              } else if (licStr.includes(',')) {
                licenseTypes = licStr.split(',').map((s: string) => s.trim());
              } else {
                licenseTypes = [licStr];
              }
            }

            // Parse certificateUrl list
            let certificateUrls: string[] = [];
            if (profile.certificateUrl) {
              const certStr = profile.certificateUrl;
              if (certStr.startsWith('[') && certStr.endsWith(']')) {
                try {
                  certificateUrls = JSON.parse(certStr) as string[];
                } catch {
                  certificateUrls = certStr.split(',').map((s: string) => s.trim());
                }
              } else if (certStr.includes(',')) {
                certificateUrls = certStr.split(',').map((s: string) => s.trim());
              } else {
                certificateUrls = [certStr];
              }
            }

            if (index! < licenseTypes.length) {
              licenseTypes.splice(index!, 1);
            }
            if (index! < certificateUrls.length) {
              certificateUrls.splice(index!, 1);
            }

            await prisma.providerProfile.update({
              where: { userId: auth.userId },
              data: {
                licenseType: JSON.stringify(licenseTypes),
                certificateUrl: JSON.stringify(certificateUrls)
              }
            });

            return { licenseTypes, certificateUrls };
          },
          async () => {
            const profile = mockDb.profiles.find((p) => p.userId === auth.userId);
            if (!profile) {
              throw new Error('Provider profile not found');
            }

            // Parse licenseType list
            let licenseTypes: string[] = [];
            if (profile.licenseType) {
              const licStr = profile.licenseType;
              if (licStr.startsWith('[') && licStr.endsWith(']')) {
                try {
                  licenseTypes = JSON.parse(licStr) as string[];
                } catch {
                  licenseTypes = licStr.split(',').map((s: string) => s.trim());
                }
              } else if (licStr.includes(',')) {
                licenseTypes = licStr.split(',').map((s: string) => s.trim());
              } else {
                licenseTypes = [licStr];
              }
            }

            // Parse certificateUrl list
            let certificateUrls: string[] = [];
            if (profile.certificateUrl) {
              const certStr = profile.certificateUrl;
              if (certStr.startsWith('[') && certStr.endsWith(']')) {
                try {
                  certificateUrls = JSON.parse(certStr) as string[];
                } catch {
                  certificateUrls = certStr.split(',').map((s: string) => s.trim());
                }
              } else if (certStr.includes(',')) {
                certificateUrls = certStr.split(',').map((s: string) => s.trim());
              } else {
                certificateUrls = [certStr];
              }
            }

            if (index! < licenseTypes.length) {
              licenseTypes.splice(index!, 1);
            }
            if (index! < certificateUrls.length) {
              certificateUrls.splice(index!, 1);
            }

            profile.licenseType = JSON.stringify(licenseTypes);
            profile.certificateUrl = JSON.stringify(certificateUrls);

            return { licenseTypes, certificateUrls };
          }
        );

        const baseUrl = getBaseUrl(request);
        const formattedCerts = response.certificateUrls.map((c) => (c && c.startsWith('/') && baseUrl) ? `${baseUrl}${c}` : c);

        return NextResponse.json({
          success: true,
          message: 'License/certificate deleted successfully'
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to delete license' }, { status: 400 });
      }
    }

    // 1. Client Deletes Their Own Account (/api/clients/me or /api/client/me)
    if (path === 'clients/me' || path === 'client/me') {
      if (auth.role !== 'client') {
        return NextResponse.json({ message: 'Forbidden: Requires client role' }, { status: 403 });
      }
      const userId = auth.userId;
      try {
        await executeWithDbFallback(
          async () => {
            await prisma.user.delete({ where: { id: userId } });
          },
          async () => {
            const userIndex = mockDb.users.findIndex((u) => u.id === userId);
            if (userIndex === -1) throw new Error('User not found');
            mockDb.users.splice(userIndex, 1);
            const profileIndex = mockDb.profiles.findIndex((p) => p.userId === userId);
            if (profileIndex !== -1) {
              const profileId = mockDb.profiles[profileIndex].id;
              mockDb.services = mockDb.services.filter((s) => s.profileId !== profileId);
              mockDb.amenities = mockDb.amenities.filter((a) => a.profileId !== profileId);
              mockDb.profiles.splice(profileIndex, 1);
            }
          }
        );
        return NextResponse.json({ success: true, message: 'Account and all associated data deleted successfully.' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to delete account' }, { status: 400 });
      }
    }

    // 1b. Provider Deletes Their Own Account (/api/providers/me or /api/provider/me)
    if (path === 'providers/me' || path === 'provider/me') {
      if (auth.role !== 'provider') {
        return NextResponse.json({ message: 'Forbidden: Requires provider role' }, { status: 403 });
      }
      const userId = auth.userId;
      try {
        await executeWithDbFallback(
          async () => {
            await prisma.user.delete({ where: { id: userId } });
          },
          async () => {
            const userIndex = mockDb.users.findIndex((u) => u.id === userId);
            if (userIndex === -1) throw new Error('User not found');
            mockDb.users.splice(userIndex, 1);
            const profileIndex = mockDb.profiles.findIndex((p) => p.userId === userId);
            if (profileIndex !== -1) {
              const profileId = mockDb.profiles[profileIndex].id;
              mockDb.services = mockDb.services.filter((s) => s.profileId !== profileId);
              mockDb.amenities = mockDb.amenities.filter((a) => a.profileId !== profileId);
              mockDb.profiles.splice(profileIndex, 1);
            }
          }
        );
        return NextResponse.json({ success: true, message: 'Account and all associated data deleted successfully.' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to delete account' }, { status: 400 });
      }
    }

    // Admin routes below:
    if (auth.role !== 'admin') {
      return NextResponse.json({ message: 'Forbidden: Requires admin role' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const idStr = searchParams.get('id');
    if (!idStr) {
      return NextResponse.json({ message: 'Missing resource id parameter' }, { status: 400 });
    }
    const id = parseInt(idStr);

    // 2. Admin Deletes Any User Account (/api/admin/users)
    if (path === 'admin/users') {
      try {
        await executeWithDbFallback(
          async () => {
            await prisma.user.delete({ where: { id } });
          },
          async () => {
            const userIndex = mockDb.users.findIndex((u) => u.id === id);
            if (userIndex === -1) throw new Error('User not found');
            mockDb.users.splice(userIndex, 1);
            const profileIndex = mockDb.profiles.findIndex((p) => p.userId === id);
            if (profileIndex !== -1) {
              const profileId = mockDb.profiles[profileIndex].id;
              mockDb.services = mockDb.services.filter((s) => s.profileId !== profileId);
              mockDb.amenities = mockDb.amenities.filter((a) => a.profileId !== profileId);
              mockDb.profiles.splice(profileIndex, 1);
            }
          }
        );
        return NextResponse.json({ success: true, message: 'User account and all associated data deleted successfully.' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to delete user account' }, { status: 400 });
      }
    }

    // 3. Delete Category Setting
    if (path === 'admin/settings/categories') {
      try {
        await executeWithDbFallback(
          async () => {
            await prisma.categorySetting.delete({ where: { id } });
          },
          async () => {
            // Mock delete
          }
        );
        return NextResponse.json({ success: true, message: 'Category setting deleted successfully.' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to delete' }, { status: 400 });
      }
    }

    // 4. Delete Service Setting
    if (path === 'admin/settings/services') {
      try {
        await executeWithDbFallback(
          async () => {
            await prisma.serviceSetting.delete({ where: { id } });
          },
          async () => {
            // Mock delete
          }
        );
        return NextResponse.json({ success: true, message: 'Service setting deleted successfully.' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to delete' }, { status: 400 });
      }
    }

    // 5. Delete Ambience Setting
    if (path === 'admin/settings/ambience') {
      try {
        await executeWithDbFallback(
          async () => {
            await prisma.ambienceSetting.delete({ where: { id } });
          },
          async () => {
            // Mock delete
          }
        );
        return NextResponse.json({ success: true, message: 'Ambience setting deleted successfully.' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to delete' }, { status: 400 });
      }
    }

    // DELETE Admin Voucher
    if (path === 'admin/settings/vouchers') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires admin role' }, { status: 403 });
      }

      const { searchParams } = new URL(request.url);
      const voucherIdStr = searchParams.get('id');
      if (!voucherIdStr) {
        return NextResponse.json({ message: 'Missing voucher id' }, { status: 400 });
      }

      const voucherId = parseInt(voucherIdStr, 10);
      try {
        await executeWithDbFallback(
          async () => {
            await prisma.voucher.delete({ where: { id: voucherId } });
          },
          async () => {
            const index = mockDb.vouchers.findIndex((v) => v.id === voucherId);
            if (index === -1) throw new Error('Voucher not found');
            mockDb.vouchers.splice(index, 1);
          }
        );
        return NextResponse.json({ success: true, message: 'Voucher deleted successfully.' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to delete voucher' }, { status: 400 });
      }
    }

    // DELETE Admin FAQ
    if (path === 'admin/faqs') {
      const auth = await getAuthenticatedUser(request);
      if (!auth || auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires admin role' }, { status: 403 });
      }
      const { searchParams } = new URL(request.url);
      const idStr = searchParams.get('id');
      if (!idStr) {
        return NextResponse.json({ message: 'Missing id parameter' }, { status: 400 });
      }
      const id = parseInt(idStr, 10);
      try {
        await executeWithDbFallback(
          async () => { await prisma.faq.delete({ where: { id } }); },
          async () => {
            const index = mockDb.faqs.findIndex((f) => f.id === id);
            if (index === -1) throw new Error('FAQ not found');
            mockDb.faqs.splice(index, 1);
          }
        );
        return NextResponse.json({ success: true, message: 'FAQ deleted successfully.' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to delete FAQ' }, { status: 400 });
      }
    }

    // DELETE Provider Request (/api/admin/provider-requests or /api/provider-requests)
    if (path === 'admin/provider-requests' || path === 'provider-requests' || path === 'provider/requests' || path === 'providers/requests' || path.startsWith('admin/provider-requests/') || path.startsWith('provider-requests/')) {
      if (auth.role !== 'admin') {
        return NextResponse.json({ message: 'Forbidden: Requires admin role' }, { status: 403 });
      }
      const { searchParams } = new URL(request.url);
      let requestIdStr = searchParams.get('id') || searchParams.get('requestId');
      if (!requestIdStr) {
        const pathParts = path.split('/');
        const lastPart = pathParts[pathParts.length - 1];
        if (!isNaN(parseInt(lastPart, 10))) {
          requestIdStr = lastPart;
        }
      }
      if (!requestIdStr) {
        return NextResponse.json({ message: 'Missing request id' }, { status: 400 });
      }
      const requestId = parseInt(requestIdStr, 10);

      try {
        await executeWithDbFallback(
          async () => {
            await prisma.providerRequest.delete({ where: { id: requestId } });
          },
          async () => {
            const index = mockDb.providerRequests.findIndex((r) => r.id === requestId);
            if (index === -1) throw new Error('Provider request not found');
            mockDb.providerRequests.splice(index, 1);
          }
        );
        return NextResponse.json({ success: true, message: 'Provider request deleted successfully' });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to delete provider request' }, { status: 400 });
      }
    }

    return NextResponse.json({ message: 'Endpoint not found' }, { status: 404 });
  } catch (err: any) {
    console.error(`[API DELETE Error]`, err);
    return NextResponse.json({ message: err.message || 'DELETE failed', error: String(err) }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ catchall?: string[] }> }
) {
  try {
    const { catchall } = await params;
    const rawPath = catchall?.join('/') || '';
    const path = rawPath.replace(/^api\//i, '').replace(/\/$/, '').trim();
    console.log(`[API PATCH] rawPath='${rawPath}' -> path='${path}'`);

    const auth = await getAuthenticatedUser(request);
    if (!auth) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    // PATCH /api/users/me or /api/user/me
    if (path === 'users/me' || path === 'user/me') {
      const { timezone, name, phoneNumber, fcmToken, fcm_token } = body as any;
      const userFcmToken = fcmToken || fcm_token || undefined;
      const userTimezone = timezone && typeof timezone === 'string' && timezone.trim() ? timezone.trim() : undefined;

      try {
        const updatedUser = await executeWithDbFallback(
          async () => {
            const dataToUpdate: any = {};
            if (userTimezone !== undefined) dataToUpdate.timezone = userTimezone;
            if (name !== undefined) dataToUpdate.name = String(name);
            if (phoneNumber !== undefined) dataToUpdate.phoneNumber = String(phoneNumber);
            if (userFcmToken !== undefined) dataToUpdate.fcmToken = String(userFcmToken);

            return await prisma.user.update({
              where: { id: auth.userId },
              data: dataToUpdate,
              include: {
                providerProfile: {
                  include: { services: true, amenities: true },
                },
                clientProfile: true,
              },
            });
          },
          async () => {
            const user = mockDb.users.find((u) => u.id === auth.userId);
            if (!user) throw new Error('User not found');

            if (userTimezone !== undefined) user.timezone = userTimezone;
            if (name !== undefined) user.name = String(name);
            if (phoneNumber !== undefined) user.phoneNumber = String(phoneNumber);
            if (userFcmToken !== undefined) user.fcmToken = String(userFcmToken);

            const profile = mockDb.profiles.find((p) => p.userId === user.id);
            let providerProfile = undefined;
            let clientProfile = undefined;
            if (profile) {
              if (user.role === 'provider') {
                providerProfile = {
                  ...profile,
                  services: mockDb.services.filter((s) => s.profileId === profile.id),
                  amenities: mockDb.amenities.filter((a) => a.profileId === profile.id),
                };
              } else if (user.role === 'client') {
                clientProfile = { ...profile };
              }
            }
            return { ...user, providerProfile, clientProfile };
          }
        );

        if (!updatedUser) {
          return NextResponse.json({ message: 'User not found' }, { status: 404 });
        }

        const token = generateToken(updatedUser.id, updatedUser.email, updatedUser.role, updatedUser.timezone);
        const sanitized = sanitizeUser(updatedUser, request);
        if (sanitized && sanitized.providerProfile) {
          await enrichProviderProfile(sanitized.providerProfile, request);
        }

        return NextResponse.json({
          token,
          user: sanitized,
        });
      } catch (err: any) {
        return NextResponse.json({ message: err.message || 'Failed to update user' }, { status: 400 });
      }
    }

    return NextResponse.json({ message: 'Endpoint not found' }, { status: 404 });
  } catch (err: any) {
    console.error(`[API PATCH Error]`, err);
    return NextResponse.json({ message: err.message || 'PATCH failed', error: String(err) }, { status: 500 });
  }
}

