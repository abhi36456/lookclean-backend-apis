const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixNames() {
  console.log('Fixing existing ProviderService records in database...');
  try {
    const services = await prisma.providerService.findMany();
    const settings = await prisma.serviceSetting.findMany();
    const settingsMap = new Map(settings.map(s => [s.id, s.title]));

    let updatedCount = 0;
    for (const svc of services) {
      if (!svc.name || svc.name.startsWith('Service #')) {
        const title = settingsMap.get(svc.id) || (svc.category && svc.category !== 'General' ? `${svc.category} Service` : 'Beauty & Wellness Service');
        await prisma.providerService.update({
          where: { id: svc.id },
          data: { name: title }
        });
        updatedCount++;
        console.log(`Updated Service ID ${svc.id} -> ${title}`);
      }
    }
    console.log(`Successfully updated ${updatedCount} ProviderService records.`);
  } catch (err) {
    console.error('Error fixing service names in DB:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

fixNames();
