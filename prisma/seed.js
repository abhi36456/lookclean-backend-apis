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
    where: { email: 'provider@lookclean.com' },
    update: {
      password: hashPassword('123456'),
    },
    create: {
      email: 'provider@lookclean.com',
      password: hashPassword('123456'),
      name: 'Maison Lumière',
      role: 'provider',
      providerType: 'freelancer',
      isPhoneVerified: true,
      onboardingCompleted: true,
      providerProfile: {
        create: {
          name: 'Maison Lumière',
          location: '72 Fifth Ave, New York, NY',
          experience: 6,
          licenseType: 'State Cosmetology License',
          certificateUrl: 'ny_license_7891.pdf',
          coverImageUrl: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=600',
          services: {
            create: [
              { name: 'Classic cut', price: 35, category: 'Haircut' },
              { name: 'Skin fade', price: 45, category: 'Haircut' },
              { name: 'Beard sculpt & hot towel', price: 25, category: 'Beard' },
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
    where: { email: 'client@lookclean.com' },
    update: {
      password: hashPassword('123456'),
    },
    create: {
      email: 'client@lookclean.com',
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
    { title: 'Comfort & Atmosphere', icon: '🍃' },
    { title: 'Convenience & Refreshments', icon: '☕' },
    { title: 'Safety & Hygiene', icon: '🛡️' },
    { title: 'Accessibility & Family Friendly', icon: '🚗' },
    { title: 'Premium Add-Ons', icon: '💎' },
  ];

  console.log('Seeding Ambience Groups...');
  const groupMap = {};
  for (const grp of ambienceGroups) {
    const created = await prisma.ambienceGroupSetting.upsert({
      where: { title: grp.title },
      update: { icon: grp.icon },
      create: { title: grp.title, icon: grp.icon },
    });
    groupMap[grp.title] = created.id;
  }

  const ambienceData = [
    // Comfort & Atmosphere
    { mainType: 'Comfort & Atmosphere', title: 'Comfortable seating', icon: '🪑' },
    { mainType: 'Comfort & Atmosphere', title: 'Relaxing music', icon: '🎵' },
    { mainType: 'Comfort & Atmosphere', title: 'Aromatherapy scents', icon: '🕯️' },
    { mainType: 'Comfort & Atmosphere', title: 'Natural lighting', icon: '☀️' },
    { mainType: 'Comfort & Atmosphere', title: 'Temperature control', icon: '🌡️' },
    { mainType: 'Comfort & Atmosphere', title: 'Private & quiet zones', icon: '🔒' },
    { mainType: 'Comfort & Atmosphere', title: 'Luxurious décor', icon: '⚜️' },
    { mainType: 'Comfort & Atmosphere', title: 'Eco-friendly materials', icon: '♻️' },

    // Convenience & Refreshments
    { mainType: 'Convenience & Refreshments', title: 'Complimentary beverages', icon: '☕' },
    { mainType: 'Convenience & Refreshments', title: 'Snack bar', icon: '🍽️' },
    { mainType: 'Convenience & Refreshments', title: 'Free Wi-Fi', icon: '📶' },
    { mainType: 'Convenience & Refreshments', title: 'Charging stations', icon: '🔌' },

    // Safety & Hygiene
    { mainType: 'Safety & Hygiene', title: 'Sanitized after each client', icon: '🧴' },
    { mainType: 'Safety & Hygiene', title: 'Licensed professionals', icon: '⭐' },
    { mainType: 'Safety & Hygiene', title: 'Security surveillance', icon: '🔐' },
    { mainType: 'Safety & Hygiene', title: 'Safety measures', icon: '🛡️' },

    // Accessibility & Family Friendly
    { mainType: 'Accessibility & Family Friendly', title: 'Parking area', icon: '🚗' },
    { mainType: 'Accessibility & Family Friendly', title: 'Wheelchair access', icon: '♿' },
    { mainType: 'Accessibility & Family Friendly', title: 'Child-friendly space', icon: '👶' },
    { mainType: 'Accessibility & Family Friendly', title: 'Pet-friendly zone', icon: '🐾' },

    // Premium Add-Ons
    { mainType: 'Premium Add-Ons', title: 'VIP waiting area', icon: '👑' },
    { mainType: 'Premium Add-Ons', title: 'Express services', icon: '✅' },
    { mainType: 'Premium Add-Ons', title: 'Loyalty rewards', icon: '🎁' },
    { mainType: 'Premium Add-Ons', title: 'Express service lane', icon: '⚡' },
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

  // 5. Seed default Categories & Services Settings
  const defaultCategories = ['Haircut', 'Beard', 'Hair Color'];
  console.log('Seeding Category Settings...');
  const catMap = {};
  for (const cat of defaultCategories) {
    const created = await prisma.categorySetting.upsert({
      where: { title: cat },
      update: {},
      create: { title: cat },
    });
    catMap[cat] = created.id;
  }

  const defaultServices = [
    { mainType: 'Haircut', title: 'Classic cut' },
    { mainType: 'Haircut', title: 'Skin fade' },
    { mainType: 'Haircut', title: 'Kids cut' },
    { mainType: 'Beard', title: 'Beard trim' },
    { mainType: 'Beard', title: 'Hot-towel shave' },
    { mainType: 'Beard', title: 'Beard sculpt' },
    { mainType: 'Hair Color', title: 'Root touch-up' },
    { mainType: 'Hair Color', title: 'Full color' },
    { mainType: 'Hair Color', title: 'Balayage' },
  ];

  console.log('Seeding Service Settings...');
  for (const svc of defaultServices) {
    const catId = catMap[svc.mainType];
    await prisma.serviceSetting.upsert({
      where: {
        mainTypeId_title: {
          mainTypeId: catId,
          title: svc.title,
        },
      },
      update: {},
      create: {
        mainTypeId: catId,
        title: svc.title,
      },
    });
  }

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
