const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function parseTimeSlotMinutes(timeStr) {
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

function getBookingEndDateTime(dateInput, timeSlotStr, slotDurationMinutes = 60) {
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
    endMinutes = 23 * 60 + 59;
  }

  const endHours = Math.floor(endMinutes / 60);
  const endMins = endMinutes % 60;

  return new Date(year, month, day, endHours, endMins, 0, 0);
}

async function autoCompletePastBookings() {
  const now = new Date();
  console.log(`[Cron CLI] Running completed bookings check at ${now.toISOString()}...`);

  try {
    const activeBookings = await prisma.booking.findMany({
      where: {
        status: { in: ['pending', 'confirmed'] }
      },
      include: {
        client: true,
        provider: true
      }
    });

    let updatedCount = 0;
    const completedIds = [];

    for (const booking of activeBookings) {
      const endDateTime = getBookingEndDateTime(booking.date, booking.timeSlot);
      if (endDateTime < now) {
        await prisma.booking.update({
          where: { id: booking.id },
          data: { status: 'completed' }
        });
        updatedCount++;
        completedIds.push(booking.id);

        console.log(`[Cron CLI] Booking #${booking.id} (${booking.timeSlot} on ${booking.date.toISOString().split('T')[0]}) auto-completed.`);

        if (booking.clientId) {
          try {
            await prisma.notification.create({
              data: {
                userId: booking.clientId,
                title: 'Booking Completed! 🎉',
                message: 'Your appointment is complete. Tap here to share your review and rate your provider!',
                type: 'BOOKING_COMPLETED',
                data: JSON.stringify({ bookingId: String(booking.id), type: 'BOOKING_COMPLETED' })
              }
            });
          } catch (notifErr) {
            console.error(`[Cron CLI] Failed to create notification for booking #${booking.id}:`, notifErr.message);
          }
        }
      }
    }

    console.log(`[Cron CLI] Execution finished. Auto-completed ${updatedCount} booking(s).`);
  } catch (err) {
    console.error('[Cron CLI Error]', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

autoCompletePastBookings();
