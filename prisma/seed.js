const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function seed() {
  console.log('🌱 Inicializando banco de dados...');

  // Limpar dados existentes
  await prisma.taxProvision.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.budget.deleteMany();
  await prisma.category.deleteMany();
  await prisma.appConfig.deleteMany();
  await prisma.user.deleteMany();

  // === Usuária Admin ===
  const hashedPassword = await bcrypt.hash('admin123', 10);
  await prisma.user.create({
    data: {
      name: 'Dr. Talissa Naiara Elias Lima',
      email: 'talissalima.adv@gmail.com',
      password: hashedPassword,
      role: 'admin'
    }
  });
  console.log('  ✅ Usuária admin criada (talissalima.adv@gmail.com / admin123)');

  // === Categorias ===
  const categories = await Promise.all([
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
  console.log('  ✅ 9 categorias criadas');

  // === Configurações ===
  const configs = [
    { key: 'TAX_RATE_ISS', value: '0.045' },
    { key: 'TAX_RATE_PIS', value: '0' },
    { key: 'TAX_RATE_COFINS', value: '0' },
    { key: 'TAX_RATE_IRPJ', value: '0' },
    { key: 'TAX_RATE_CSLL', value: '0' },
    { key: 'TAX_PROVISION_TOTAL', value: '0.145' },
    { key: 'COMPANY_NAME', value: 'Lima Advocacia e Associados' },
  ];
  for (const config of configs) {
    await prisma.appConfig.create({ data: config });
  }
  console.log('  ✅ Configurações padrão criadas');

  // === NENHUMA transação, budget ou provisão (dados zerados) ===
  console.log('  ℹ️  Dados zerados — importe seus dados via Excel');

  console.log('🎉 Banco de dados inicializado com sucesso!');
  console.log('\n📋 Credenciais de acesso:');
  console.log('   Email: talissalima.adv@gmail.com');
  console.log('   Senha: admin123');
}

seed()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
