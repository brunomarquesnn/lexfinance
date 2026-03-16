const prisma = require('./prisma');

async function getConfig(key) {
    const config = await prisma.appConfig.findUnique({ where: { key } });
    return config ? parseFloat(config.value) : 0;
}

async function calculateTaxProvision(month, year) {
    const competence = `${String(month).padStart(2, '0')}/${year}`;
    const provisions = await prisma.taxProvision.findMany({ where: { competence, status: { not: 'CANCELADO' } } });

    const breakdown = {
        iss: Math.round(provisions.filter(p => p.taxType === 'ISS').reduce((a, b) => a + b.value, 0) * 100) / 100,
        pis: Math.round(provisions.filter(p => p.taxType === 'PIS').reduce((a, b) => a + b.value, 0) * 100) / 100,
        cofins: Math.round(provisions.filter(p => p.taxType === 'COFINS').reduce((a, b) => a + b.value, 0) * 100) / 100,
        irpj: Math.round(provisions.filter(p => p.taxType === 'IRPJ').reduce((a, b) => a + b.value, 0) * 100) / 100,
        csll: Math.round(provisions.filter(p => p.taxType === 'CSLL').reduce((a, b) => a + b.value, 0) * 100) / 100
    };
    const total = Object.values(breakdown).reduce((a, b) => a + b, 0);

    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59);

    const revAgg = await prisma.transaction.aggregate({
        where: { type: 'ENTRADA', date: { gte: startOfMonth, lte: endOfMonth } },
        _sum: { value: true }
    });
    const rev = revAgg._sum.value || 0;

    return {
        taxableBase: rev, // Full revenue for effective rate calculation purposes
        breakdown,
        total,
        effectiveRate: rev > 0 ? Math.round((total / rev) * 10000) / 100 : 0
    };
}

module.exports = { calculateTaxProvision, getConfig };
