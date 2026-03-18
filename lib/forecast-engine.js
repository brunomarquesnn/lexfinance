const prisma = require('./prisma');
const { calculateTaxProvision } = require('./tax-calculator');

async function getForecastVariance(month, year, categoryName, costCenter) {
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59);

    // Filter build
    const budgetWhere = { month, year };
    if (categoryName) budgetWhere.category = { name: categoryName }; // Requires relational filter
    if (costCenter) budgetWhere.department = costCenter;

    const txWhereBase = { date: { gte: startOfMonth, lte: endOfMonth } };
    if (categoryName) txWhereBase.category = { name: categoryName };
    if (costCenter) txWhereBase.costCenter = costCenter;

    const budgets = await prisma.budget.findMany({
        where: budgetWhere,
        include: { category: true }
    });

    // Calculate net profit (lucro líquido) for the period
    const [revenueAgg, expensesAgg, costsAgg] = await Promise.all([
        prisma.transaction.aggregate({
            where: { ...txWhereBase, type: 'ENTRADA', status: 'PAGO' },
            _sum: { value: true }
        }),
        prisma.transaction.aggregate({
            where: { ...txWhereBase, type: 'SAIDA', status: 'PAGO' },
            _sum: { value: true }
        }),
        prisma.transaction.aggregate({
            where: { ...txWhereBase, type: 'SAIDA', isReimbursement: true, status: 'PAGO' },
            _sum: { value: true }
        })
    ]);

    const totalRevenue = revenueAgg._sum.value || 0;
    const totalExpenses = Math.abs(expensesAgg._sum.value || 0);
    const totalCosts = Math.abs(costsAgg?._sum?.value || 0);

    let totalTaxes = 0;
    try {
        // Taxes only make sense if not filtered by costCenter/category, but we'll leave it globally for now as provision
        if (!categoryName && !costCenter) {
            const taxCalc = await calculateTaxProvision(month, year);
            totalTaxes = taxCalc.total || 0;
        }
    } catch (e) { /* ignore */ }

    const netProfit = totalRevenue - totalExpenses - totalTaxes;

    // Per-category & cost center: revenue minus expenses
    // Note: We retain groupBy even when filtering so that mapping to budgets later works cleanly.
    const revenueByCategory = await prisma.transaction.groupBy({
        by: ['categoryId', 'costCenter'],
        where: { ...txWhereBase, type: 'ENTRADA', status: 'PAGO' },
        _sum: { value: true }
    });
    const expensesByCategory = await prisma.transaction.groupBy({
        by: ['categoryId', 'costCenter'],
        where: { ...txWhereBase, type: 'SAIDA', status: 'PAGO' },
        _sum: { value: true }
    });

    const items = budgets.map(budget => {
        const bdgDept = budget.department || 'Operations';
        const rev = revenueByCategory.find(a => a.categoryId === budget.categoryId && (a.costCenter || 'Operations') === bdgDept);
        const exp = expensesByCategory.find(a => a.categoryId === budget.categoryId && (a.costCenter || 'Operations') === bdgDept);
        const revValue = rev?._sum?.value ?? 0;
        const expValue = Math.abs(exp?._sum?.value ?? 0);
        // Net for this category/department (revenue - expenses)
        const actualValue = revValue - expValue;



        const variance = actualValue - budget.amount;
        const variancePct = budget.amount > 0 ? Math.round((variance / budget.amount) * 1000) / 10 : 0;

        return {
            category: budget.category.name,
            categoryColor: budget.category.color,
            department: budget.department,
            budgeted: budget.amount,
            actual: actualValue,
            variance,
            variancePct,
            month: budget.month,
            year: budget.year,
            budgetId: budget.id,
            status: variancePct >= 0 ? 'on_track' : variancePct > -20 ? 'under_budget' : 'over_budget'
        };
    });

    // Override totals with actual net profit
    const totalBudgeted = budgets.reduce((s, b) => s + b.amount, 0);

    return {
        items,
        netProfit,
        totalRevenue,
        totalExpenses,
        totalTaxes,
        totalCosts,
        totalBudgeted,
        totalActual: netProfit,
        remaining: netProfit - totalBudgeted,
        departments: groupByDept(items)
    };
}

function groupByDept(items) {
    const departments = {};
    items.forEach(item => {
        if (!departments[item.department]) departments[item.department] = [];
        departments[item.department].push(item);
    });
    return departments;
}

module.exports = { getForecastVariance };
