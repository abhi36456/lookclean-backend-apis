import { prisma } from '@/lib/prisma';
import cron from 'node-cron';

// Mock DB reference fallback when MySQL is disconnected
let mockDbRef: any = null;
let sendNotificationRef: any = null;

export function setCronDependencies(mockDb: any, sendNotificationFn: any) {
  mockDbRef = mockDb;
  sendNotificationRef = sendNotificationFn;
}

/**
 * Parses a time string (e.g. "09:00 AM", "02:30 PM", "14:00") into total minutes from 00:00.
 */
export function parseTimeSlotMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const cleanStr = timeStr.trim();
  const [time, modifier] = cleanStr.split(' ');
  if (!time) return 0;

  const parts = time.split(':');
  let hours = parseInt(parts[0], 10) || 0;
  const minutes = parseInt(parts[1], 10) || 0;

  if (hours === 12) {
    hours = 0;
  }
  if (modifier && modifier.toUpperCase() === 'PM') {
    hours += 12;
  }
  return hours * 60 + minutes;
}

/**
 * Calculates the exact end DateTime object for a booking based on its date and timeSlot.
 * Supports single time slots (e.g., "09:00 AM") and slot ranges (e.g., "09:00 AM - 10:00 AM").
 */
export function getBookingEndDateTime(
  dateInput: Date | string,
  timeSlotStr: string,
  slotDurationMinutes = 60
): Date {
  const d = new Date(dateInput);

  let dateStr = '';
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateInput)) {
    dateStr = dateInput.split('T')[0];
  } else if (d instanceof Date && !isNaN(d.getTime())) {
    dateStr = d.toISOString().split('T')[0];
  } else {
    dateStr = String(dateInput).split('T')[0];
  }

  const parts = dateStr.split('-');
  const year = parseInt(parts[0], 10) || d.getFullYear();
  const month = (parseInt(parts[1], 10) || (d.getMonth() + 1)) - 1;
  const day = parseInt(parts[2], 10) || d.getDate();

  let endMinutes = 0;
  if (timeSlotStr) {
    // Check for range format like "09:00 AM - 10:00 AM" or "09:00 AM to 10:00 AM"
    const timeParts = timeSlotStr.split(/\s*[-–—]|to\s*/i);
    if (timeParts.length >= 2 && timeParts[1].trim()) {
      try {
        endMinutes = parseTimeSlotMinutes(timeParts[1].trim());
      } catch {
        endMinutes = parseTimeSlotMinutes(timeParts[0].trim()) + slotDurationMinutes;
      }
    } else {
      try {
        const startMinutes = parseTimeSlotMinutes(timeSlotStr.trim());
        endMinutes = startMinutes + slotDurationMinutes;
      } catch {
        endMinutes = 23 * 60 + 59;
      }
    }
  } else {
    endMinutes = 23 * 60 + 59; // Fallback to end of day
  }

  const endHours = Math.floor(endMinutes / 60);
  const endMins = endMinutes % 60;

  return new Date(year, month, day, endHours, endMins, 0, 0);
}

/**
 * Core function that checks for active bookings whose date & end time slot have passed,
 * automatically marks them as 'completed', and sends completion push notifications.
 */
export async function autoCompletePastBookings(): Promise<{ updatedCount: number; completedBookingIds: number[] }> {
  const now = new Date();
  let updatedCount = 0;
  const completedBookingIds: number[] = [];

  try {
    // 1. Database approach using Prisma
    const activeBookings = await prisma.booking.findMany({
      where: {
        status: { in: ['pending', 'confirmed'] }
      },
      include: {
        client: true,
        provider: true
      }
    });

    for (const booking of activeBookings) {
      const endDateTime = getBookingEndDateTime(booking.date, booking.timeSlot);
      if (endDateTime < now) {
        await prisma.booking.update({
          where: { id: booking.id },
          data: { status: 'completed' }
        });
        updatedCount++;
        completedBookingIds.push(booking.id);

        if (sendNotificationRef && booking.clientId) {
          try {
            await sendNotificationRef(
              booking.clientId,
              'Booking Completed! 🎉',
              'Your appointment is complete. Tap here to share your review and rate your provider!',
              {
                bookingId: String(booking.id),
                clientId: String(booking.clientId),
                providerId: String(booking.providerId || ''),
                type: 'BOOKING_COMPLETED'
              }
            );
          } catch (notifErr) {
            console.error(`[Cron Completed Bookings] FCM Notification error for booking #${booking.id}:`, notifErr);
          }
        }
      }
    }
  } catch (dbErr) {
    console.warn('[Cron Completed Bookings] Primary DB query failed, falling back to mockDb if present:', dbErr);

    // 2. Fallback using mockDb if passed
    if (mockDbRef && Array.isArray(mockDbRef.bookings)) {
      const mockActiveBookings = mockDbRef.bookings.filter(
        (b: any) => b.status === 'pending' || b.status === 'confirmed'
      );

      for (const booking of mockActiveBookings) {
        const endDateTime = getBookingEndDateTime(booking.date, booking.timeSlot);
        if (endDateTime < now) {
          booking.status = 'completed';
          updatedCount++;
          completedBookingIds.push(booking.id);

          if (sendNotificationRef && booking.clientId) {
            try {
              await sendNotificationRef(
                booking.clientId,
                'Booking Completed! 🎉',
                'Your appointment is complete. Tap here to share your review and rate your provider!',
                {
                  bookingId: String(booking.id),
                  clientId: String(booking.clientId),
                  providerId: String(booking.providerId || ''),
                  type: 'BOOKING_COMPLETED'
                }
              );
            } catch (notifErr) {
              console.error(`[Cron Completed Bookings] FCM Notification error for mock booking #${booking.id}:`, notifErr);
            }
          }
        }
      }
    }
  }

  if (updatedCount > 0) {
    console.log(`[Cron Job] Auto-completed ${updatedCount} expired booking(s): [${completedBookingIds.join(', ')}]`);
  }

  return { updatedCount, completedBookingIds };
}

let isCronStarted = false;

/**
 * Initializes a node-cron recurring job running every minute ("* * * * *")
 * to automatically process expired bookings.
 */
export function initCompletedBookingsCron(cronSchedule = '* * * * *') {
  if (isCronStarted) {
    return;
  }
  isCronStarted = true;

  console.log(`[Cron Job] Initializing completed bookings cron with schedule: "${cronSchedule}"`);

  cron.schedule(cronSchedule, async () => {
    try {
      await autoCompletePastBookings();
    } catch (err) {
      console.error('[Cron Job Error] Error executing completed bookings task:', err);
    }
  });
}
