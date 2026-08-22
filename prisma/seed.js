const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function main() {
  console.log('Seeding database and updating existing passwords to hash format...');
  
  // 1. Seed the admin user
  const admin = await prisma.user.upsert({
    where: { email: 'admin@lookclean.com' },
    update: {
      password: hashPassword('admin123'),
    },
    create: {
      email: 'admin@lookclean.com',
      password: hashPassword('admin123'),
      name: 'System Admin',
      role: 'admin',
      isPhoneVerified: true,
      onboardingCompleted: true,
    },
  });

  // 2. Seed a demo provider with complete provider profile, services, and amenities
  const provider = await prisma.user.upsert({
    where: { email: 'provider.user@lookclean.com' },
    update: {
      password: hashPassword('123456'),
    },
    create: {
      email: 'provider.user@lookclean.com',
      password: hashPassword('123456'),
      name: 'Maison Lumière',
      role: 'provider',
      providerType: 'freelancer',
      isPhoneVerified: true,
      onboardingCompleted: true,
      providerProfile: {
        create: {
          location: '72 Fifth Ave, New York, NY',
          experience: 6,
          licenseType: 'State Cosmetology License',
          certificateUrl: 'ny_license_7891.pdf',
          coverImageUrl: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=600',
          services: {
            create: [
              { name: 'Women’s Haircut', price: 35, rushPrice: 50, category: 'Haircut & Styling' },
              { name: 'Men’s Haircut', price: 45, rushPrice: 60, category: 'Haircut & Styling' },
              { name: 'Beard Styling', price: 25, rushPrice: 35, category: 'Men’s Grooming' },
            ],
          },
          amenities: {
            create: [
              { name: 'Parking area' },
              { name: 'AC waiting area' },
              { name: 'Tidy & hygienic' },
            ],
          },
        },
      },
    },
  });

  // 3. Seed a demo client with a client profile
  const client = await prisma.user.upsert({
    where: { email: 'client.user@lookclean.com' },
    update: {
      password: hashPassword('123456'),
    },
    create: {
      email: 'client.user@lookclean.com',
      password: hashPassword('123456'),
      name: 'Sarah Connor',
      role: 'client',
      isPhoneVerified: true,
      onboardingCompleted: true,
      clientProfile: {
        create: {},
      },
    },
  });

  // 4. Seed the fixed Ambience & Amenities Settings
  const ambienceGroups = [
    { title: 'Comfort & Atmosphere' },
    { title: 'Convenience & Refreshments' },
    { title: 'Safety & Hygiene' },
    { title: 'Accessibility & Family Friendly' },
    { title: 'Premium Add-Ons' },
  ];

  console.log('Seeding Ambience Groups...');
  const groupMap = {};
  for (const grp of ambienceGroups) {
    const created = await prisma.ambienceGroupSetting.upsert({
      where: { title: grp.title },
      update: {},
      create: { title: grp.title },
    });
    groupMap[grp.title] = created.id;
  }

  const ambienceData = [
    // Comfort & Atmosphere
    { mainType: 'Comfort & Atmosphere', title: 'Comfortable seating', icon: '/assets/ambience/icons/comfortable-seating.svg' },
    { mainType: 'Comfort & Atmosphere', title: 'Relaxing music', icon: '/assets/ambience/icons/relaxing-music.svg' },
    { mainType: 'Comfort & Atmosphere', title: 'Aromatherapy scents', icon: '/assets/ambience/icons/aromatherapy.svg' },
    { mainType: 'Comfort & Atmosphere', title: 'Natural lighting', icon: '/assets/ambience/icons/natural-lighting.svg' },
    { mainType: 'Comfort & Atmosphere', title: 'Temperature control', icon: '/assets/ambience/icons/temperature-control.svg' },
    { mainType: 'Comfort & Atmosphere', title: 'Private & quiet zones', icon: '/assets/ambience/icons/private-zones.svg' },
    { mainType: 'Comfort & Atmosphere', title: 'Luxurious décor', icon: '/assets/ambience/icons/luxurious-decor.svg' },
    { mainType: 'Comfort & Atmosphere', title: 'Eco-friendly materials', icon: '/assets/ambience/icons/eco-friendly.svg' },

    // Convenience & Refreshments
    { mainType: 'Convenience & Refreshments', title: 'Complimentary beverages', icon: '/assets/ambience/icons/complimentary-beverages.svg' },
    { mainType: 'Convenience & Refreshments', title: 'Snack bar', icon: '/assets/ambience/icons/snack-bar.svg' },
    { mainType: 'Convenience & Refreshments', title: 'Free Wi-Fi', icon: '/assets/ambience/icons/free-wifi.svg' },
    { mainType: 'Convenience & Refreshments', title: 'Charging stations', icon: '/assets/ambience/icons/charging-stations.svg' },

    // Safety & Hygiene
    { mainType: 'Safety & Hygiene', title: 'Sanitized after each client', icon: '/assets/ambience/icons/sanitized.svg' },
    { mainType: 'Safety & Hygiene', title: 'Licensed professionals', icon: '/assets/ambience/icons/licensed-professionals.svg' },
    { mainType: 'Safety & Hygiene', title: 'Security surveillance', icon: '/assets/ambience/icons/security-surveillance.svg' },
    { mainType: 'Safety & Hygiene', title: 'Safety measures', icon: '/assets/ambience/icons/safety-measures.svg' },

    // Accessibility & Family Friendly
    { mainType: 'Accessibility & Family Friendly', title: 'Parking area', icon: '/assets/ambience/icons/parking-area.svg' },
    { mainType: 'Accessibility & Family Friendly', title: 'Wheelchair access', icon: '/assets/ambience/icons/wheelchair-access.svg' },
    { mainType: 'Accessibility & Family Friendly', title: 'Child-friendly space', icon: '/assets/ambience/icons/child-friendly.svg' },
    { mainType: 'Accessibility & Family Friendly', title: 'Pet-friendly zone', icon: '/assets/ambience/icons/pet-friendly.svg' },

    // Premium Add-Ons
    { mainType: 'Premium Add-Ons', title: 'VIP waiting area', icon: '/assets/ambience/icons/vip-waiting-area.svg' },
    { mainType: 'Premium Add-Ons', title: 'Express services', icon: '/assets/ambience/icons/express-services.svg' },
    { mainType: 'Premium Add-Ons', title: 'Loyalty rewards', icon: '/assets/ambience/icons/loyalty-rewards.svg' },
    { mainType: 'Premium Add-Ons', title: 'Express service lane', icon: '/assets/ambience/icons/express-lane.svg' },
  ];

  console.log('Seeding Ambience Items...');
  for (const item of ambienceData) {
    const groupId = groupMap[item.mainType];
    await prisma.ambienceSetting.upsert({
      where: {
        ambienceGroupId_title: {
          ambienceGroupId: groupId,
          title: item.title,
        },
      },
      update: {
        icon: item.icon,
      },
      create: {
        ambienceGroupId: groupId,
        title: item.title,
        icon: item.icon,
      },
    });
  }

  // 5. Seed default Categories & Services Settings (Dump current & seed new ones)
  console.log('Dumping current Category and Service settings...');
  await prisma.serviceSetting.deleteMany({});
  await prisma.categorySetting.deleteMany({});

  console.log('Seeding new Categories & Services Settings...');
  const categoriesData = [
    {
      title: 'Haircut & Styling',
      services: [
        'Women’s Haircut',
        'Men’s Haircut',
        'Kids’ Haircut',
        'Bang Trim',
        'Beard Trim',
        'Shampoo & Blow Dry',
        'Blowout',
        'Hair Styling',
        'Updo',
        'Braids',
        'Curls',
      ],
    },
    {
      title: 'Hair Colour',
      services: [
        'Root Touch-Up',
        'Full Colour',
        'Highlights',
        'Lowlights',
        'Balayage',
        'Ombre',
        'Toner',
        'Colour Correction',
        'Hair Gloss',
      ],
    },
    {
      title: 'Hair Treatments',
      services: [
        'Deep Conditioning',
        'Keratin Treatment',
        'Olaplex Treatment',
        'Hair Botox',
        'Scalp Treatment',
        'Hair Spa',
        'Protein Treatment',
      ],
    },
    {
      title: 'Hair Extensions',
      services: [
        'Consultation',
        'Tape-In Extensions',
        'Clip-In Extensions',
        'Sew-In Extensions',
        'Fusion Extensions',
        'Extension Removal',
        'Extension Maintenance',
      ],
    },
    {
      title: 'Bridal & Event Hair',
      services: [
        'Bridal Hairstyle',
        'Bridesmaid Hair',
        'Party Hairstyle',
        'Hair Trial Session',
      ],
    },
    {
      title: 'Nails',
      services: [
        'Classic Manicure',
        'Gel Manicure',
        'Acrylic Nails',
        'Dip Powder Nails',
        'Nail Extensions',
        'Nail Art',
        'Classic Pedicure',
        'Gel Pedicure',
      ],
    },
    {
      title: 'Brows & Lashes',
      services: [
        'Eyebrow Shaping',
        'Eyebrow Threading',
        'Brow Tint',
        'Brow Lamination',
        'Lash Lift',
        'Lash Tint',
        'Eyelash Extensions',
        'Lash Fill',
      ],
    },
    {
      title: 'Facials & Skincare',
      services: [
        'Express Facial',
        'Hydrating Facial',
        'Anti-Aging Facial',
        'Acne Facial',
        'Deep Cleansing Facial',
        'Chemical Peel',
        'Microdermabrasion',
      ],
    },
    {
      title: 'Waxing',
      services: [
        'Eyebrows',
        'Upper Lip',
        'Chin',
        'Full Face',
        'Underarms',
        'Arms',
        'Legs',
        'Bikini Wax',
        'Brazilian Wax',
        'Back',
        'Chest',
      ],
    },
    {
      title: 'Threading',
      services: [
        'Eyebrows',
        'Upper Lip',
        'Chin',
        'Full Face',
      ],
    },
    {
      title: 'Makeup',
      services: [
        'Everyday Makeup',
        'Party Makeup',
        'Bridal Makeup',
        'Engagement Makeup',
        'Photoshoot Makeup',
        'Airbrush Makeup',
      ],
    },
    {
      title: 'Massage & Spa',
      services: [
        'Swedish Massage',
        'Deep Tissue Massage',
        'Aromatherapy Massage',
        'Hot Stone Massage',
        'Head Massage',
        'Foot Massage',
      ],
    },
    {
      title: 'Tanning',
      services: [
        'Spray Tan',
        'Full-Body Tan',
        'Face Tan',
      ],
    },
    {
      title: 'Advanced Beauty',
      services: [
        'HydraFacial',
        'Microneedling',
        'Dermaplaning',
        'LED Light Therapy',
        'Skin Consultation',
      ],
    },
    {
      title: 'Piercing',
      services: [
        'Ear Lobe Piercing',
        'Cartilage Piercing',
        'Nose Piercing',
      ],
    },
    {
      title: 'Men’s Grooming',
      services: [
        'Men’s Haircut',
        'Beard Styling',
        'Shave',
        'Hair Colour',
        'Men’s Facial',
        'Scalp Treatment',
      ],
    },
    {
      title: 'Kids’ Services',
      services: [
        'Kids’ Haircut',
        'Kids’ Hair Styling',
      ],
    },
  ];

  for (const catObj of categoriesData) {
    const createdCat = await prisma.categorySetting.upsert({
      where: { title: catObj.title },
      update: {},
      create: { title: catObj.title },
    });

    for (const svcTitle of catObj.services) {
      await prisma.serviceSetting.upsert({
        where: {
          mainTypeId_title: {
            mainTypeId: createdCat.id,
            title: svcTitle,
          },
        },
        update: {},
        create: {
          mainTypeId: createdCat.id,
          title: svcTitle,
        },
      });
    }
  }

  // 6. Generate Dummy Bookings for June and July 2026
  console.log('Generating dummy bookings and reviews for June and July...');
  const providerProfile = await prisma.providerProfile.findUnique({
    where: { userId: provider.id },
    include: { services: true }
  });

  if (providerProfile && providerProfile.services.length > 0) {
    const services = providerProfile.services;
    const bookingDates = [];

    // Add 4 bookings for June
    for (let i = 0; i < 4; i++) {
      const day = Math.floor(Math.random() * 28) + 1;
      bookingDates.push(new Date(`2026-06-${String(day).padStart(2, '0')}T10:00:00Z`));
    }

    // Add 25 bookings for July
    for (let i = 0; i < 25; i++) {
      const day = Math.floor(Math.random() * 28) + 1;
      const hour = Math.floor(Math.random() * 8) + 9; // 9 AM to 4 PM
      bookingDates.push(new Date(`2026-07-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`));
    }

    let bCount = 0;
    for (const date of bookingDates) {
      bCount++;
      const service = services[Math.floor(Math.random() * services.length)];
      
      const b = await prisma.booking.create({
        data: {
          clientId: client.id,
          providerId: provider.id,
          date: date,
          timeSlot: `${date.getUTCHours() > 12 ? date.getUTCHours() - 12 : date.getUTCHours()}:00 ${date.getUTCHours() >= 12 ? 'PM' : 'AM'}`,
          status: 'completed',
          serviceAmount: service.price,
          grandTotal: service.price,
          services: {
            create: [
              {
                serviceId: service.id
              }
            ]
          }
        }
      });

      // Add a review
      const ratings = [4, 5, 5, 4.5, 5];
      const rating = ratings[Math.floor(Math.random() * ratings.length)];
      const comments = [
        "Great service!", 
        "Loved the " + service.name.toLowerCase() + "!", 
        "Very professional and clean.", 
        "Best experience, highly recommend.", 
        "Will definitely book again."
      ];
      
      await prisma.review.create({
        data: {
          clientId: client.id,
          providerId: provider.id,
          bookingId: b.id,
          rating: rating,
          comment: comments[Math.floor(Math.random() * comments.length)],
          createdAt: date
        }
      });
    }
    console.log(`Created ${bCount} dummy bookings with reviews.`);
  }

  console.log('Seeding sample notifications...');
  await prisma.notification.createMany({
    data: [
      {
        userId: provider.id,
        title: 'New Booking Request! 📅',
        message: 'Sarah Connor booked a service with you.',
        type: 'NEW_BOOKING',
        data: JSON.stringify({ bookingId: '1' }),
      },
      {
        userId: provider.id,
        title: 'New Rating & Review Received ⭐',
        message: 'Sarah Connor rated you 5 stars: "Great service!"',
        type: 'NEW_REVIEW',
        data: JSON.stringify({ reviewId: '1' }),
      },
      {
        userId: client.id,
        title: 'Booking Confirmed! ✅',
        message: 'Your appointment with Maison Lumière has been confirmed.',
        type: 'BOOKING_STATUS_CHANGED',
        data: JSON.stringify({ bookingId: '1', status: 'confirmed' }),
      },
      {
        userId: client.id,
        title: 'Welcome to Look Clean! 🎉',
        message: 'Explore top salons and beauty professionals near you.',
        type: 'WELCOME',
      },
    ]
  });

  console.log('Seed completed successfully! Default admin:', admin.email);
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
