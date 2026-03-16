const prisma = require('./lib/prisma');

async function main() {
    // Zero out all taxes except ISS
    await prisma.appConfig.updateMany({
        where: { key: { in: ['TAX_RATE_PIS', 'TAX_RATE_COFINS', 'TAX_RATE_IRPJ', 'TAX_RATE_CSLL'] } },
        data: { value: '0' }
    });

    // Set ISS to 4.5%
    await prisma.appConfig.upsert({
        where: { key: 'TAX_RATE_ISS' },
        update: { value: '0.045' },
        create: { key: 'TAX_RATE_ISS', value: '0.045' }
    });

    const all = await prisma.appConfig.findMany({ where: { key: { startsWith: 'TAX_RATE' } } });
    console.log('Tax rates updated:');
    all.forEach(r => console.log(`  ${r.key} = ${r.value} (${(parseFloat(r.value) * 100).toFixed(1)}%)`));

    await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
