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
