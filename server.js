const express = require('express');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const prisma = require('./lib/prisma');
const { calculateTaxProvision } = require('./lib/tax-calculator');
const { getForecastVariance } = require('./lib/forecast-engine');

const app = express();
app.use((req, res, next) => {
    if (req.path === '/api/import/excel') return next();
    express.json({ limit: '10mb' })(req, res, next);
});
app.use(session({
    secret: 'gestao-financeira-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000, secure: false } // 24h
}));

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// ========================
// MIDDLEWARE DE AUTENTICAÇÃO
// ========================
function requireAuth(req, res, next) {
    if (req.session && req.session.userId) return next();
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(401).json({ error: 'Não autenticado' });
    }
    return res.redirect('/login.html');
}

// ========================
// AUTH ROUTES
// ========================
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return res.status(401).json({ error: 'E-mail ou senha inválidos' });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'E-mail ou senha inválidos' });

        req.session.userId = user.id;
        req.session.userName = user.name;
        req.session.userRole = user.role;
        res.json({ success: true, user: { name: user.name, role: user.role } });
    } catch (error) {
        console.error('Erro de login:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// ========================
// API: GET /api/config
// ========================
app.get('/api/config', (req, res) => {
    res.json({
        appName: process.env.APP_NAME || 'Lima Advocacia e Associados'
    });
});

app.post('/api/auth/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        if (password.length < 6) return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) return res.status(400).json({ error: 'Este e-mail já está cadastrado' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: { name, email, password: hashedPassword, role: 'user' }
        });

        req.session.userId = user.id;
        req.session.userName = user.name;
        req.session.userRole = user.role;
        res.status(201).json({ success: true, user: { name: user.name, role: user.role } });
    } catch (error) {
        console.error('Erro de cadastro:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ name: req.session.userName, role: req.session.userRole });
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// ========================
// TODAS AS ROTAS DE API REQUEREM AUTH
// ========================
app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth/')) return next();
    requireAuth(req, res, next);
});

// ========================
// API: GET /api/summary
// ========================
app.get('/api/summary', async (req, res) => {
    try {
        const now = new Date();
        const month = parseInt(req.query.month) || (now.getMonth() + 1);
        const year = parseInt(req.query.year) || now.getFullYear();
        const startOfMonth = new Date(year, month - 1, 1);
        const endOfMonth = new Date(year, month, 0, 23, 59, 59);

        const entriesAgg = await prisma.transaction.aggregate({
            where: { type: 'ENTRADA', date: { gte: startOfMonth, lte: endOfMonth }, status: 'PAGO' },
            _sum: { value: true }
        });
        const monthlyRevenue = entriesAgg._sum.value || 0;

        const expensesAgg = await prisma.transaction.aggregate({
            where: { type: 'SAIDA', date: { gte: startOfMonth, lte: endOfMonth }, status: 'PAGO' },
            _sum: { value: true }
        });
        const totalExpenses = Math.abs(expensesAgg._sum.value || 0);

        const taxes = await calculateTaxProvision(month, year);
        const netProfit = monthlyRevenue - totalExpenses - taxes.total;
        const operatingMargin = monthlyRevenue > 0 ? Math.round((netProfit / monthlyRevenue) * 1000) / 10 : 0;

        const prevStart = new Date(year, month - 2, 1);
        const prevEnd = new Date(year, month - 1, 0, 23, 59, 59);
        const prevAgg = await prisma.transaction.aggregate({
            where: { type: 'ENTRADA', date: { gte: prevStart, lte: prevEnd }, status: 'PAGO' },
            _sum: { value: true }
        });
        const prevRevenue = prevAgg._sum.value || 0;
        const revenueChange = prevRevenue > 0 ? Math.round(((monthlyRevenue - prevRevenue) / prevRevenue) * 1000) / 10 : 0;

        const forecastMonths = [];
        for (let i = 0; i < 3; i++) {
            const fm = ((month - 1 + i) % 12) + 1;
            const fy = year + Math.floor((month - 1 + i) / 12);
            forecastMonths.push({ month: fm, year: fy });
        }
        const forecastBudgets = await prisma.budget.findMany({ where: { OR: forecastMonths } });
        const quarterlyForecast = forecastBudgets.reduce((s, b) => s + b.amount, 0);

        const expensesByCostCenter = await prisma.transaction.groupBy({
            by: ['costCenter'],
            where: { type: 'SAIDA', date: { gte: startOfMonth, lte: endOfMonth }, status: 'PAGO' },
            _sum: { value: true }
        });

        const costCenterMap = { Litigation: 'Contencioso', Corporate: 'Societário', Labor: 'Trabalhista', Civil: 'Cível', Admin: 'Administrativo', Precatorio: 'Precatório', Familia: 'Família', Ambiental: 'Ambiental', Criminal: 'Criminal', Penal: 'Penal', Previdenciario: 'Previdenciário', Outros: 'Outros' };
        const donutColors = ['#2E3A5C', '#D4AF37', '#94A3B8', '#475569', '#1e293b', '#64748b', '#cbd5e1', '#f1f5f9'];

        const expenseByCategory = expensesByCostCenter.map((e, index) => {
            const translatedName = e.costCenter ? (costCenterMap[e.costCenter] || e.costCenter) : 'Não Alocado';
            return {
                name: translatedName,
                color: donutColors[index % donutColors.length],
                value: Math.abs(e._sum.value || 0)
            };
        }).sort((a, b) => b.value - a.value);



        const cashFlowHistory = [];
        for (let i = 5; i >= 0; i--) {
            const hm = new Date(year, month - 1 - i, 1);
            const hStart = new Date(hm.getFullYear(), hm.getMonth(), 1);
            const hEnd = new Date(hm.getFullYear(), hm.getMonth() + 1, 0, 23, 59, 59);
            const hMonth = hm.getMonth() + 1; const hYear = hm.getFullYear();
            const hComp = `${String(hMonth).padStart(2, '0')}/${hYear}`;
            const [inAgg, outAgg, taxAgg] = await Promise.all([
                prisma.transaction.aggregate({ where: { type: 'ENTRADA', date: { gte: hStart, lte: hEnd }, status: 'PAGO' }, _sum: { value: true } }),
                prisma.transaction.aggregate({ where: { type: 'SAIDA', date: { gte: hStart, lte: hEnd }, status: 'PAGO' }, _sum: { value: true } }),
                prisma.taxProvision.aggregate({ where: { competence: hComp, status: { not: 'CANCELADO' } }, _sum: { value: true } })
            ]);
            const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
            const directExpenses = Math.abs(outAgg._sum.value || 0);
            const taxExpenses = Math.abs(taxAgg._sum.value || 0);
            cashFlowHistory.push({
                month: monthNames[hm.getMonth()], year: hm.getFullYear(),
                entradas: Math.round(inAgg._sum.value || 0),
                saidas: Math.round(directExpenses + taxExpenses)
            });
        }

        const recentTransactions = await prisma.transaction.findMany({
            orderBy: { date: 'desc' }, take: 5, include: { category: true }
        });

        res.json({
            monthlyRevenue: Math.round(monthlyRevenue), revenueChange, netProfit: Math.round(netProfit),
            operatingMargin, quarterlyForecast: Math.round(quarterlyForecast), taxes, expenseByCategory,
            cashFlowHistory, recentTransactions, month, year
        });
    } catch (error) {
        console.error('Erro no resumo:', error);
        res.status(500).json({ error: 'Falha ao buscar resumo' });
    }
});

// ========================
// API: GET /api/transactions
// ========================
app.get('/api/transactions', async (req, res) => {
    try {
        const { month, year, category, status, costCenter, type, page = '1', limit = '50', search } = req.query;
        const where = {};
        if (month && year) {
            const m = parseInt(month); const y = parseInt(year);
            where.date = { gte: new Date(y, m - 1, 1), lte: new Date(y, m, 0, 23, 59, 59) };
        }
        if (category) where.categoryId = category;
        if (status) where.status = status;
        if (costCenter) where.costCenter = costCenter;
        if (type) where.type = type;
        if (search) where.description = { contains: search };

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [transactions, total, inAgg, outAgg] = await Promise.all([
            prisma.transaction.findMany({ where, skip, take: parseInt(limit), orderBy: { date: 'desc' }, include: { category: true } }),
            prisma.transaction.count({ where }),
            prisma.transaction.aggregate({ where: { ...where, type: 'ENTRADA', status: 'PAGO' }, _sum: { value: true } }),
            prisma.transaction.aggregate({ where: { ...where, type: 'SAIDA', status: 'PAGO' }, _sum: { value: true } })
        ]);

        const totalIn = inAgg._sum.value || 0;
        const totalOut = Math.abs(outAgg._sum.value || 0);
        res.json({
            transactions, total, totalIn, totalOut,
            netBalance: totalIn - totalOut,
            page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        console.error('Erro nas transações:', error);
        res.status(500).json({ error: 'Falha ao buscar transações' });
    }
});

// ========================
// API: POST /api/transactions
// ========================
app.post('/api/transactions', async (req, res) => {
    try {
        const { date, description, value, type, categoryId, costCenter, bank, reference, clientName, isReimbursement } = req.body;
        const transaction = await prisma.transaction.create({
            data: {
                date: new Date(date), description, value: parseFloat(value), type, status: 'PENDENTE',
                categoryId, costCenter: costCenter || null, bank: bank || null, reference: reference || null,
                clientName: clientName || null, isReimbursement: isReimbursement || false
            },
            include: { category: true }
        });

        // Removido: A criação automática de imposto foi removida a pedido do usuário.
        // Impostos agora só entram de forma manual via '+ Nova Provisão' na página Impostos.
        res.status(201).json(transaction);
    } catch (error) {
        console.error('Erro ao criar transação:', error);
        res.status(500).json({ error: 'Falha ao criar transação' });
    }
});

app.get('/api/transactions/:id', async (req, res) => {
    try {
        const transaction = await prisma.transaction.findUnique({ where: { id: req.params.id }, include: { category: true } });
        res.json(transaction);
    } catch (error) { res.status(500).json({ error: 'Falha ao buscar transação' }); }
});

app.put('/api/transactions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const data = {};
        if (req.body.status !== undefined) data.status = req.body.status;
        if (req.body.description !== undefined) data.description = req.body.description;
        if (req.body.value !== undefined) data.value = parseFloat(req.body.value);
        if (req.body.date !== undefined) data.date = new Date(req.body.date);
        if (req.body.type !== undefined) data.type = req.body.type;
        if (req.body.categoryId !== undefined) data.categoryId = req.body.categoryId;
        if (req.body.costCenter !== undefined) data.costCenter = req.body.costCenter;
        if (req.body.bank !== undefined) data.bank = req.body.bank;
        if (req.body.clientName !== undefined) data.clientName = req.body.clientName;
        if (req.body.reference !== undefined) data.reference = req.body.reference;
        if (req.body.isReimbursement !== undefined) data.isReimbursement = req.body.isReimbursement;

        const transaction = await prisma.transaction.update({ where: { id }, data, include: { category: true } });
        res.json(transaction);
    } catch (error) {
        console.error('Falha ao atualizar transação', error);
        res.status(500).json({ error: 'Falha ao atualizar transação' });
    }
});

app.delete('/api/transactions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.taxProvision.deleteMany({ where: { transactionId: id } });
        await prisma.transaction.delete({ where: { id } });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Falha ao excluir transação' }); }
});

// ========================
// API: GET /api/categories
// ========================
app.get('/api/categories', async (req, res) => {
    try {
        const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } });
        res.json(categories);
    } catch (error) { res.status(500).json({ error: 'Falha ao buscar categorias' }); }
});

// ========================
// API: GET /api/notifications
// ========================
app.get('/api/notifications', async (req, res) => {
    try {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        const fiveDaysFromNow = new Date(now.getTime() + (5 * 24 * 60 * 60 * 1000));

        // 1) Transações recentes (Entradas e Saídas dos últimos 7 dias baseados em createdAt - Assumindo que newly inserted items have date close to now or we can use the date field if createdAt isn't reliable, let's use date for simplicity since this is a financial monitor)
        const recentTransactions = await prisma.transaction.findMany({
            where: { date: { gte: sevenDaysAgo, lte: now } },
            orderBy: { date: 'desc' },
            take: 10
        });

        // 2) Obrigações Fiscais próximas ao vencimento (próximos 5 dias)
        const upcomingTaxes = await prisma.taxProvision.findMany({
            where: {
                dueDate: { gte: now, lte: fiveDaysFromNow },
                status: { notIn: ['PAGO', 'CANCELADO'] }
            },
            orderBy: { dueDate: 'asc' }
        });

        const notifications = [];

        // Map taxes (High Priority)
        upcomingTaxes.forEach(t => {
            const diffDays = Math.ceil((new Date(t.dueDate) - now) / (1000 * 60 * 60 * 24));
            notifications.push({
                id: `tax-${t.id}`,
                type: diffDays <= 1 ? 'danger' : 'warning',
                title: `Obrigação Fiscal Vencendo`,
                message: `${t.taxType} no valor de R$ ${t.value.toFixed(2).replace('.', ',')} vence em ${diffDays} dia(s).`,
                date: t.dueDate,
                read: false
            });
        });

        // Map transactions
        recentTransactions.forEach(t => {
            notifications.push({
                id: `tx-${t.id}`,
                type: t.type === 'ENTRADA' ? 'success' : 'info',
                title: t.type === 'ENTRADA' ? 'Nova Entrada Registrada' : 'Nova Saída Registrada',
                message: `${t.description} (R$ ${Math.abs(t.value).toFixed(2).replace('.', ',')})`,
                date: t.date,
                read: false
            });
        });

        // Sort by date mostly recent/urgent
        notifications.sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json(notifications);
    } catch (error) {
        console.error('Erro ao buscar notificações:', error);
        res.status(500).json({ error: 'Erro ao carregar notificações' });
    }
});

// ========================
// API: GET /api/forecast/variance
// ========================
app.get('/api/forecast/variance', async (req, res) => {
    try {
        const now = new Date();
        const month = parseInt(req.query.month) || (now.getMonth() + 1);
        const year = parseInt(req.query.year) || now.getFullYear();
        const category = req.query.category || null;
        const costCenter = req.query.costCenter || null;
        const result = await getForecastVariance(month, year, category, costCenter);

        res.json({
            items: result.items,
            departments: result.departments,
            totalBudgeted: Math.round(result.totalBudgeted),
            totalActual: Math.round(result.totalActual),
            remaining: Math.round(result.remaining),
            netProfit: Math.round(result.netProfit),
            totalRevenue: Math.round(result.totalRevenue),
            totalExpenses: Math.round(result.totalExpenses),
            totalTaxes: Math.round(result.totalTaxes),
            month, year
        });
    } catch (error) {
        console.error('Erro no forecast:', error);
        res.status(500).json({ error: 'Falha ao buscar forecast' });
    }
});

// ========================
// API: GET /api/taxes
// ========================
app.get('/api/taxes', async (req, res) => {
    try {
        const now = new Date();
        const monthParam = parseInt(req.query.month);
        const year = parseInt(req.query.year) || now.getFullYear();
        const allMonths = monthParam === 0;
        const month = allMonths ? (now.getMonth() + 1) : (monthParam || (now.getMonth() + 1));

        // Date range
        const startOfPeriod = allMonths ? new Date(year, 0, 1) : new Date(year, month - 1, 1);
        const endOfPeriod = allMonths ? new Date(year, 11, 31, 23, 59, 59) : new Date(year, month, 0, 23, 59, 59);

        // Provisions
        const provWhere = allMonths
            ? { competence: { endsWith: `/${year}` } }
            : { competence: `${String(month).padStart(2, '0')}/${year}` };
        const provisions = await prisma.taxProvision.findMany({
            where: provWhere, include: { transaction: true }, orderBy: { dueDate: 'asc' }
        });

        const totalProvisionado = provisions.filter(p => p.status === 'PROVISIONADO').reduce((s, p) => s + p.value, 0);
        const totalPago = provisions.filter(p => p.status === 'PAGO').reduce((s, p) => s + p.value, 0);
        const totalPlanejado = provisions.filter(p => p.status === 'PLANEJADO').reduce((s, p) => s + p.value, 0);

        const proximasObrigacoes = await prisma.taxProvision.findMany({
            where: { dueDate: { gte: new Date() }, status: { notIn: ['PAGO', 'CANCELADO'] } },
            orderBy: { dueDate: 'asc' }, take: 3
        });

        const taxCalc = await calculateTaxProvision(allMonths ? now.getMonth() + 1 : month, year);

        const fixedCategories = ['Aluguel', 'Salários', 'Software/SaaS'];
        const dateFilter = { gte: startOfPeriod, lte: endOfPeriod };
        const fixedCosts = await prisma.transaction.aggregate({
            where: { type: 'SAIDA', date: dateFilter, category: { name: { in: fixedCategories } }, status: 'PAGO' },
            _sum: { value: true }
        });
        const variableCosts = await prisma.transaction.aggregate({
            where: { type: 'SAIDA', date: dateFilter, category: { name: { notIn: fixedCategories } }, status: 'PAGO' },
            _sum: { value: true }
        });

        // Individual costs list for table
        const costTransactions = await prisma.transaction.findMany({
            where: { type: 'SAIDA', date: dateFilter, isReimbursement: true },
            include: { category: true },
            orderBy: { date: 'desc' }
        });
        const custosList = costTransactions.map(c => ({
            id: c.id, description: c.description, date: c.date,
            value: Math.abs(c.value), category: c.category?.name || '—',
            isFixed: fixedCategories.includes(c.category?.name)
        }));

        // Tax history (last 6 months from the reference month)
        const refMonth = allMonths ? 12 : month;
        const taxHistory = [];
        for (let i = 5; i >= 0; i--) {
            const hm = new Date(year, refMonth - 1 - i, 1);
            const hMonth = hm.getMonth() + 1; const hYear = hm.getFullYear();
            const hComp = `${String(hMonth).padStart(2, '0')}/${hYear}`;
            const hStart = new Date(hYear, hMonth - 1, 1);
            const hEnd = new Date(hYear, hMonth, 0, 23, 59, 59);
            const [hRevAgg, hTaxAgg] = await Promise.all([
                prisma.transaction.aggregate({ where: { type: 'ENTRADA', date: { gte: hStart, lte: hEnd }, status: 'PAGO' }, _sum: { value: true } }),
                prisma.taxProvision.aggregate({ where: { competence: hComp, status: { not: 'CANCELADO' } }, _sum: { value: true } })
            ]);
            const hRev = hRevAgg._sum.value || 0;
            const hTax = hTaxAgg._sum.value || 0;
            const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
            taxHistory.push({
                month: monthNames[hm.getMonth()], revenue: Math.round(hRev), taxes: Math.round(hTax),
                rate: hRev > 0 ? Math.round((hTax / hRev) * 1000) / 10 : 0
            });
        }

        const fundoTotal = await prisma.taxProvision.aggregate({ where: { status: { not: 'CANCELADO' } }, _sum: { value: true } });
        const fundoConf = await prisma.appConfig.findUnique({ where: { key: 'TAX_FUND_META' } });
        const fundoPeriodConf = await prisma.appConfig.findUnique({ where: { key: 'TAX_FUND_PERIOD' } });
        const fundoMeta = fundoConf ? parseFloat(fundoConf.value) : 80000;
        const fundoPeriod = fundoPeriodConf ? fundoPeriodConf.value : 'trimestre';

        // Calculate Tax Target based on budgeted revenue
        const budgetRevAgg = await prisma.budget.aggregate({
            where: { month: parseInt(month), year: parseInt(year), category: { taxable: true, type: 'RECEITA' } },
            _sum: { amount: true }
        });
        const budgetedRevenue = budgetRevAgg._sum.amount || 0;
        const issRateConfig = await prisma.appConfig.findUnique({ where: { key: 'TAX_RATE_ISS' } });
        const issRate = issRateConfig ? parseFloat(issRateConfig.value) : 0;
        const cargaTarget = issRate * 100; // e.g., 0.045 * 100 = 4.5%

        res.json({
            provisions, totalProvisionado: Math.round(totalProvisionado), totalPago: Math.round(totalPago),
            totalPlanejado: Math.round(totalPlanejado), fundoDeProvisao: {
                acumulado: Math.round(fundoTotal._sum.value || 0), meta: fundoMeta, period: fundoPeriod,
                percentual: Math.round(((fundoTotal._sum.value || 0) / fundoMeta) * 1000) / 10
            }, proximasObrigacoes, taxCalc,
            custosFixos: Math.abs(Math.round(fixedCosts._sum.value || 0)),
            custosVariaveis: Math.abs(Math.round(variableCosts._sum.value || 0)),
            custosList,
            cargaTributaria: taxCalc.effectiveRate, cargaTarget, taxHistory, month, year
        });
    } catch (error) {
        console.error('Erro nos impostos:', error);
        res.status(500).json({ error: 'Falha ao buscar impostos' });
    }
});

// ========================
// API: POST /api/config/tax-fund
// ========================
app.post('/api/config/tax-fund', async (req, res) => {
    try {
        const { meta, period } = req.body;
        if (meta) {
            await prisma.appConfig.upsert({
                where: { key: 'TAX_FUND_META' },
                update: { value: String(meta) },
                create: { key: 'TAX_FUND_META', value: String(meta) }
            });
        }
        if (period) {
            await prisma.appConfig.upsert({
                where: { key: 'TAX_FUND_PERIOD' },
                update: { value: String(period) },
                create: { key: 'TAX_FUND_PERIOD', value: String(period) }
            });
        }
        res.status(200).json({ success: true });
    } catch (e) {
        console.error('Erro ao salvar meta do fundo:', e);
        res.status(500).json({ error: 'Falha ao salvar' });
    }
});

// ========================
// API: POST /api/taxes/provision — Nova Provisão manual
// ========================
app.post('/api/taxes/provision', async (req, res) => {
    try {
        const { taxType, competence, dueDate, value, status, baseValue, rate } = req.body;
        const provision = await prisma.taxProvision.create({
            data: {
                taxType, competence,
                dueDate: new Date(dueDate),
                value: parseFloat(value),
                status: status || 'PROVISIONADO',
                baseValue: parseFloat(baseValue || value),
                rate: parseFloat(rate || 0.145)
            }
        });
        res.status(201).json(provision);
    } catch (error) {
        console.error('Erro ao criar provisão:', error);
        res.status(500).json({ error: 'Falha ao criar provisão' });
    }
});

app.get('/api/taxes/provision/:id', async (req, res) => {
    try {
        const provision = await prisma.taxProvision.findUnique({ where: { id: req.params.id } });
        res.json(provision);
    } catch (error) { res.status(500).json({ error: 'Falha ao buscar provisão' }); }
});

app.put('/api/taxes/provision/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const data = {};
        if (req.body.status !== undefined) data.status = req.body.status;
        if (req.body.value !== undefined) data.value = parseFloat(req.body.value);
        if (req.body.taxType !== undefined) data.taxType = req.body.taxType;
        if (req.body.competence !== undefined) data.competence = req.body.competence;
        if (req.body.dueDate !== undefined) data.dueDate = req.body.dueDate;

        const provision = await prisma.taxProvision.update({ where: { id }, data });
        res.json(provision);
    } catch (error) { res.status(500).json({ error: 'Falha ao atualizar provisão' }); }
});

app.delete('/api/taxes/provision/:id', async (req, res) => {
    try {
        await prisma.taxProvision.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Falha ao excluir provisão' }); }
});

// ========================
// API: GET /api/budgets
// ========================
app.get('/api/budgets', async (req, res) => {
    try {
        const budgets = await prisma.budget.findMany({ include: { category: true }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
        res.json(budgets);
    } catch (error) { res.status(500).json({ error: 'Falha ao buscar orçamentos' }); }
});

app.post('/api/budgets', async (req, res) => {
    try {
        const { categoryId, month, year, amount, department } = req.body;
        // Allows multiple budgets for the same category/month
        const budget = await prisma.budget.create({
            data: { categoryId, month: parseInt(month), year: parseInt(year), amount: parseFloat(amount), department: department || 'Operations' },
            include: { category: true }
        });
        res.status(201).json(budget);
    } catch (error) {
        console.error('Erro ao criar orçamento:', error);
        res.status(500).json({ error: 'Falha ao criar orçamento' });
    }
});

app.get('/api/budgets/:id', async (req, res) => {
    try {
        const budget = await prisma.budget.findUnique({ where: { id: req.params.id }, include: { category: true } });
        res.json(budget);
    } catch (error) { res.status(500).json({ error: 'Falha ao buscar orçamento' }); }
});

app.put('/api/budgets/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const data = {};
        if (req.body.categoryId !== undefined) data.categoryId = req.body.categoryId;
        if (req.body.month !== undefined) data.month = parseInt(req.body.month);
        if (req.body.year !== undefined) data.year = parseInt(req.body.year);
        if (req.body.amount !== undefined) data.amount = parseFloat(req.body.amount);
        if (req.body.department !== undefined) data.department = req.body.department;

        const budget = await prisma.budget.update({ where: { id }, data, include: { category: true } });
        res.json(budget);
    } catch (error) { res.status(500).json({ error: 'Falha ao atualizar orçamento' }); }
});

app.delete('/api/budgets/:id', async (req, res) => {
    try {
        await prisma.budget.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Falha ao excluir orçamento' }); }
});

// ========================
// API: GET /api/export/excel — Exportar base de dados como Excel
// ========================
app.get('/api/export/excel', async (req, res) => {
    try {
        const transactions = await prisma.transaction.findMany({
            include: { category: true }, orderBy: { date: 'desc' }
        });

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Gestão Financeira - Lima Advocacia e Associados';
        workbook.created = new Date();

        // Aba principal: Transações
        const wsTransactions = workbook.addWorksheet('Transações');
        wsTransactions.columns = [
            { header: 'Data', key: 'date', width: 14 },
            { header: 'Descrição', key: 'description', width: 35 },
            { header: 'Categoria', key: 'category', width: 20 },
            { header: 'Tipo', key: 'type', width: 12 },
            { header: 'Centro de Custo', key: 'costCenter', width: 16 },
            { header: 'Banco', key: 'bank', width: 16 },
            { header: 'Status', key: 'status', width: 14 },
            { header: 'Valor (R$)', key: 'value', width: 16 },
            { header: 'Cliente', key: 'clientName', width: 22 },
            { header: 'Referência', key: 'reference', width: 18 },
            { header: 'Reembolso?', key: 'isReimbursement', width: 12 },
        ];

        // Estilo do header
        wsTransactions.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        wsTransactions.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };

        transactions.forEach(t => {
            wsTransactions.addRow({
                date: new Date(t.date).toLocaleDateString('pt-BR'),
                description: t.description,
                category: t.category.name,
                type: t.type === 'ENTRADA' ? 'Entrada' : 'Saída',
                costCenter: t.costCenter || '',
                bank: t.bank || '',
                status: t.status,
                value: t.value,
                clientName: t.clientName || '',
                reference: t.reference || '',
                isReimbursement: t.isReimbursement ? 'Sim' : 'Não'
            });
        });

        // Aba: Categorias
        const wsCategories = workbook.addWorksheet('Categorias');
        wsCategories.columns = [
            { header: 'Nome', key: 'name', width: 22 },
            { header: 'Tipo', key: 'type', width: 14 },
            { header: 'Tributável?', key: 'taxable', width: 12 },
        ];
        wsCategories.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        wsCategories.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
        const cats = await prisma.category.findMany();
        cats.forEach(c => wsCategories.addRow({ name: c.name, type: c.type, taxable: c.taxable ? 'Sim' : 'Não' }));

        // Aba: Provisões Fiscais
        const wsProvisions = workbook.addWorksheet('Provisões Fiscais');
        wsProvisions.columns = [
            { header: 'Imposto', key: 'taxType', width: 16 },
            { header: 'Competência', key: 'competence', width: 14 },
            { header: 'Vencimento', key: 'dueDate', width: 14 },
            { header: 'Valor (R$)', key: 'value', width: 16 },
            { header: 'Status', key: 'status', width: 16 },
            { header: 'Base (R$)', key: 'baseValue', width: 16 },
            { header: 'Taxa', key: 'rate', width: 10 },
        ];
        wsProvisions.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        wsProvisions.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
        const provs = await prisma.taxProvision.findMany();
        provs.forEach(p => wsProvisions.addRow({
            taxType: p.taxType, competence: p.competence,
            dueDate: new Date(p.dueDate).toLocaleDateString('pt-BR'),
            value: p.value, status: p.status, baseValue: p.baseValue, rate: p.rate
        }));

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=Gestão Financeira_BaseDados.xlsx');
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Erro ao exportar Excel:', error);
        res.status(500).json({ error: 'Falha ao exportar Excel' });
    }
});

// ========================
// API: POST /api/import/excel — Importar transações via Excel
// ========================
app.post('/api/import/excel', async (req, res) => {
    try {
        // Read raw body as buffer
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        await new Promise(resolve => req.on('end', resolve));
        const buffer = Buffer.concat(chunks);

        if (buffer.length === 0) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const ws = workbook.getWorksheet('Transações') || workbook.getWorksheet(1);
        if (!ws) return res.status(400).json({ error: 'Planilha "Transações" não encontrada' });

        // Load categories for mapping
        const categories = await prisma.category.findMany();
        const catMap = {};
        categories.forEach(c => { catMap[c.name.toLowerCase()] = c.id; });

        let imported = 0;
        let skipped = 0;
        const errors = [];

        const rows = [];
        ws.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // Skip header
            rows.push({ row, rowNumber });
        });

        // Determine if spreadsheet has the new "Banco" column (col 6)
        const headerRow = ws.getRow(1);
        const col6Name = String(headerRow.getCell(6).value || '').trim().toLowerCase();
        const hasBankCol = col6Name === 'banco';
        const offset = hasBankCol ? 1 : 0;

        for (const { row, rowNumber } of rows) {
            try {
                const dateVal = row.getCell(1).value;
                const description = String(row.getCell(2).value || '').trim();
                const categoryName = String(row.getCell(3).value || '').trim();
                const typeStr = String(row.getCell(4).value || '').trim();
                const costCenter = String(row.getCell(5).value || '').trim() || null;
                const bank = hasBankCol ? (String(row.getCell(6).value || '').trim() || null) : null;
                const status = String(row.getCell(6 + offset).value || 'PENDENTE').trim().toUpperCase();
                const value = parseFloat(row.getCell(7 + offset).value) || 0;
                const clientName = String(row.getCell(8 + offset).value || '').trim() || null;
                const reference = String(row.getCell(9 + offset).value || '').trim() || null;
                const reimbursement = String(row.getCell(10 + offset).value || '').trim().toLowerCase();

                if (!description || value === 0) { skipped++; continue; }

                // Parse date
                let date;
                if (dateVal instanceof Date) {
                    date = dateVal;
                } else if (typeof dateVal === 'string') {
                    const parts = dateVal.split('/');
                    if (parts.length === 3) {
                        date = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
                    } else {
                        date = new Date(dateVal);
                    }
                } else {
                    date = new Date();
                }
                if (isNaN(date.getTime())) date = new Date();

                // Map type
                const type = (typeStr.toLowerCase().includes('entrada') || typeStr === 'ENTRADA') ? 'ENTRADA' : 'SAIDA';

                // Map category
                let categoryId = catMap[categoryName.toLowerCase()];
                if (!categoryId) {
                    // Try to find closest match or use first category
                    categoryId = categories.length > 0 ? categories[0].id : null;
                }
                if (!categoryId) { skipped++; continue; }

                await prisma.transaction.create({
                    data: {
                        date, description,
                        value: type === 'SAIDA' && value > 0 ? -value : value,
                        type, status: ['PAGO', 'PENDENTE', 'RECEBIDO', 'VENCIDO', 'CANCELADO'].includes(status) ? status : 'PENDENTE',
                        categoryId, costCenter, bank, reference, clientName,
                        isReimbursement: reimbursement === 'sim' || reimbursement === 'true'
                    }
                });
                imported++;
            } catch (rowErr) {
                errors.push(`Linha ${rowNumber}: ${rowErr.message}`);
                skipped++;
            }
        }

        res.json({ success: true, imported, skipped, errors: errors.slice(0, 5), total: rows.length });
    } catch (error) {
        console.error('Erro ao importar Excel:', error);
        res.status(500).json({ error: 'Falha ao importar Excel. Verifique o formato do arquivo.' });
    }
});

// ========================
// API: POST /api/ai/chat
// ========================
app.post('/api/ai/chat', async (req, res) => {
    try {
        const { message, history = [] } = req.body;
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey || apiKey === 'sua-chave-aqui') {
            return res.json({
                reply: '⚠️ **API Key não configurada.**\n\nPara usar o assistente de IA, configure sua `ANTHROPIC_API_KEY` no arquivo `.env`.\n\nPor enquanto, o sistema Gestão Financeira está funcionando corretamente com todos os dados carregados.',
                usage: null
            });
        }
        const now = new Date();
        const month = now.getMonth() + 1; const year = now.getFullYear();
        const [forecastRes, taxesRes, recent] = await Promise.all([
            getForecastVariance(month, year).catch(() => []),
            calculateTaxProvision(month, year).catch(() => ({})),
            prisma.transaction.findMany({ orderBy: { date: 'desc' }, take: 10, include: { category: true } })
        ]);

        const Anthropic = require('@anthropic-ai/sdk');
        const client = new Anthropic.default();
        const systemPrompt = `Você é um consultor financeiro especializado em escritórios de advocacia brasileiros.
Escritório: Lima Advocacia e Associados.
DADOS FINANCEIROS: ${JSON.stringify({ forecast: forecastRes, taxes: taxesRes, recent }, null, 2)}
REGRAS: Responda em PT-BR, use R$ para valores, seja conciso.`;

        const response = await client.messages.create({
            model: 'claude-sonnet-4-6', max_tokens: 1000, system: systemPrompt,
            messages: [...history, { role: 'user', content: message }]
        });
        res.json({ reply: response.content[0].text, usage: response.usage });
    } catch (error) {
        console.error('Erro no chat IA:', error);
        res.json({ reply: '❌ Erro ao processar sua pergunta. Verifique se a API key está configurada.', usage: null });
    }
});

// ========================
// ROTA PRINCIPAL (protegida)
// ========================
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// SPA fallback
app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Rota não encontrada' });
    if (req.path === '/login.html') return res.sendFile(path.join(__dirname, 'public', 'login.html'));
    if (!req.session || !req.session.userId) return res.redirect('/login.html');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`\n🏛️  Gestão Financeira`);
    console.log(`   Rodando em http://localhost:${PORT}\n`);
    
    try {
        const count = await prisma.category.count();
        if (count === 0) {
            console.log('Criando categorias padrão no banco de dados...');
            await Promise.all([
                prisma.category.create({ data: { name: 'Honorários', type: 'RECEITA', color: '#10b981', icon: 'Scale', taxable: true } }),
                prisma.category.create({ data: { name: 'Custas Judiciais', type: 'DESPESA', color: '#6366f1', icon: 'Gavel', taxable: false } }),
                prisma.category.create({ data: { name: 'Verbas de Reembolso', type: 'REEMBOLSO', color: '#f59e0b', icon: 'RotateCcw', taxable: false } }),
                prisma.category.create({ data: { name: 'Salários', type: 'DESPESA', color: '#ef4444', icon: 'Users', taxable: false } }),
                prisma.category.create({ data: { name: 'Impostos', type: 'DESPESA', color: '#8b5cf6', icon: 'Receipt', taxable: false } }),
                prisma.category.create({ data: { name: 'Software/SaaS', type: 'DESPESA', color: '#3b82f6', icon: 'Monitor', taxable: false } }),
                prisma.category.create({ data: { name: 'Aluguel', type: 'DESPESA', color: '#ec4899', icon: 'Building', taxable: false } }),
                prisma.category.create({ data: { name: 'Marketing', type: 'DESPESA', color: '#14b8a6', icon: 'Megaphone', taxable: false } }),
                prisma.category.create({ data: { name: 'Operacional', type: 'DESPESA', color: '#f97316', icon: 'Settings', taxable: false } }),
            ]);
            console.log('Categorias criadas com sucesso!');
        }
    } catch (e) {
        console.error('Falha ao verificar/criar categorias na inicialização:', e);
    }
});
