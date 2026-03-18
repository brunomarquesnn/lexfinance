// ============================================
// Gestão Financeira — Frontend Application
// Lima Advocacia e Associados
// ============================================

let currentPage = 'dashboard';
let chartInstances = {};
let categoriesCache = [];
let chatHistory = [];
let currentUser = null;

// ============================================
// Inicialização
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  lucide.createIcons();
  await checkAuth();
  setupNavigation();
  await loadCategories();
  navigateTo('dashboard');
});

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { window.location.href = '/login.html'; return; }
    currentUser = await res.json();
    const initials = currentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    document.getElementById('sidebar-user-name').textContent = currentUser.name;
    document.getElementById('sidebar-user-role').textContent = currentUser.role === 'admin' ? 'Administradora' : 'Usuário';
    document.getElementById('sidebar-avatar').textContent = initials;
    document.getElementById('topbar-user-name').textContent = currentUser.name;
    document.getElementById('topbar-avatar').textContent = initials;
  } catch (e) { window.location.href = '/login.html'; }
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

// ============================================
// Navegação
// ============================================
function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => { e.preventDefault(); navigateTo(item.dataset.page); });
  });
}

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  switch (page) {
    case 'dashboard': loadDashboard(); break;
    case 'cash-flow': loadCashFlow(); break;
    case 'forecast': loadForecast(); break;
    case 'taxes': loadTaxes(); break;
  }
}

// ============================================
// Utilitários
// ============================================
function formatCurrency(value, prefix = 'R$') {
  const abs = Math.abs(value);
  return `${value < 0 ? '-' : ''}${prefix} ${abs.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusBadge(status, transactionId) {
  const s = status.toLowerCase();
  if (transactionId) {
    return `<span class="status-badge ${s}" style="cursor:pointer" onclick="cycleStatus('${transactionId}', '${status}')" title="Clique para alterar status">${status}</span>`;
  }
  return `<span class="status-badge ${s}">${status}</span>`;
}

function categoryBadge(cat) {
  return `<span class="category-badge" style="background:${cat.color}18;color:${cat.color}">${cat.name}</span>`;
}

function varianceBadge(pct) {
  const cls = pct > 5 ? 'positive' : pct < -5 ? 'negative' : 'neutral';
  const sign = pct >= 0 ? '+' : '';
  return `<span class="variance-badge ${cls}">${sign}${pct.toFixed(1)}%</span>`;
}

function destroyChart(id) {
  if (chartInstances[id]) { chartInstances[id].destroy(); delete chartInstances[id]; }
}

async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    categoriesCache = await res.json();
    const select = document.getElementById('modal-category-select');
    if (select) select.innerHTML = categoriesCache.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  } catch (e) { console.error('Falha ao carregar categorias', e); }
}

// ============================================
// Exportar PDF (captura de tela da página)
// ============================================
async function exportPagePDF(title) {
  const pageEl = document.querySelector('.page.active');
  if (!pageEl) return;

  // Mostrar loading
  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.textContent = 'Gerando PDF...'; }

  try {
    const bgColor = getComputedStyle(document.body).getPropertyValue('--bg-secondary').trim() || '#f3f1ee';
    const canvas = await html2canvas(pageEl, {
      scale: 2, useCORS: true, logging: false,
      backgroundColor: bgColor,
      windowWidth: 1200,
      onclone: (clonedDoc) => {
        const active = clonedDoc.querySelector('.page.active');
        if (active) {
          active.style.animation = 'none';
          active.style.opacity = '1';

          // Ensure the loading button itself is hidden in all PDFs
          const loadingBtn = Array.from(clonedDoc.querySelectorAll('button')).find(b => b.textContent.includes('Gerando PDF'));
          if (loadingBtn) loadingBtn.style.display = 'none';

          if (title !== 'Fluxo de Caixa') {
            const filters = active.querySelectorAll('.filter-bar, .btn-group, .export-buttons');
            filters.forEach(el => el.style.display = 'none');

            // Hide the "Novo Orçamento" button in Forecast and generic buttons
            const buttons = active.querySelectorAll('button:not(.btn-group button):not(.export-buttons button)');
            buttons.forEach(el => {
              if (el.textContent.includes('Novo') || el.textContent.includes('Exportar') || el.textContent.includes('Custo') || el.textContent.includes('Provisão')) {
                el.style.display = 'none';
              }
            });

            // Clean table action columns
            const actionCells = active.querySelectorAll('th:last-child, td:last-child');
            actionCells.forEach(el => {
              if (el.style.width === '60px' || !el.textContent.trim()) {
                el.style.display = 'none';
              }
            });
          } else {
            // Hide specific buttons on Fluxo de Caixa only
            const buttons = active.querySelectorAll('button');
            buttons.forEach(el => {
              if (el.textContent.includes('Excel') || el.textContent.includes('Importar') || el.textContent.includes('Novo Lançamento')) {
                el.style.display = 'none';
              }
            });
          }
        }
      }
    });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    // Header
    pdf.setFillColor(28, 38, 64);
    pdf.rect(0, 0, pageWidth, 18, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(14);
    pdf.setFont(undefined, 'bold');
    const appName = window.appConfig ? window.appConfig.appName : 'Lima Advocacia e Associados';
    pdf.text('Gestão Financeira — ' + appName, 10, 12);
    pdf.setFontSize(8);
    pdf.setFont(undefined, 'normal');
    pdf.text(title + ' | Gerado em ' + new Date().toLocaleDateString('pt-BR'), pageWidth - 10, 12, { align: 'right' });

    // Content
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const imgWidth = pageWidth - 16;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const maxHeight = pageHeight - 26;

    if (imgHeight <= maxHeight) {
      pdf.addImage(imgData, 'JPEG', 8, 22, imgWidth, imgHeight);
    } else {
      // Escalar para caber em uma página
      const scale = maxHeight / imgHeight;
      pdf.addImage(imgData, 'JPEG', 8, 22, imgWidth * scale, maxHeight);
    }

    // Footer
    pdf.setTextColor(100, 116, 139);
    pdf.setFontSize(7);
    const footerName = window.appConfig ? window.appConfig.appName : 'Lima Advocacia e Associados';
    pdf.text('© ' + footerName + ' — Documento gerado automaticamente pelo Gestão Financeira', pageWidth / 2, pageHeight - 4, { align: 'center' });

    pdf.save(`Gestão Financeira_${title.replace(/\s/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`);
  } catch (err) {
    console.error('Erro ao gerar PDF:', err);
    alert('Erro ao gerar PDF. Tente novamente.');
  }

  if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="file-text"></i> PDF'; lucide.createIcons(); }
}

function downloadExcel() {
  window.location.href = '/api/export/excel';
}

// ============================================
// PÁGINA: DASHBOARD
// ============================================
async function loadDashboard() {
  const page = document.getElementById('page-dashboard');
  page.innerHTML = `
    <div class="page-header-actions">
      <div class="page-header">
        <h2>Visão Geral Executiva</h2>
        <p>Dados consolidados do período atual — Lima Advocacia e Associados</p>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <div class="export-buttons">
          <button class="btn-outline" onclick="exportPagePDF('Relatório Executivo')"><i data-lucide="file-text"></i> PDF</button>
          <button class="btn-outline" onclick="downloadExcel()"><i data-lucide="table"></i> Excel</button>
        </div>
      </div>
    </div>
    <div class="kpi-grid" id="dash-kpis">
      ${[1, 2, 3, 4].map(() => `<div class="kpi-card"><div class="skeleton" style="height:90px"></div></div>`).join('')}
    </div>
    <div class="charts-grid">
      <div class="chart-card">
        <div class="chart-card-header">
          <div><h3>Entradas vs. Saídas</h3><span>Histórico dos últimos 6 meses</span></div>
          <div class="chart-legend">
            <div class="legend-item"><div class="legend-dot" style="background:var(--accent-blue)"></div> Entradas</div>
            <div class="legend-item"><div class="legend-dot" style="background:var(--text-light)"></div> Saídas</div>
          </div>
        </div>
        <div class="chart-container"><canvas id="cashflow-chart" height="240"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-card-header">
          <div><h3>Desempenho por Centro de Custo</h3><span>Distribuição do período</span></div>
        </div>
        <div class="donut-wrapper" style="max-height:180px"><canvas id="donut-chart" height="160" width="160"></canvas>
          <div class="donut-center"><div class="pct" id="donut-pct">100%</div><div class="label">TOTAL</div></div>
        </div>
        <div class="donut-legend" id="donut-legend"></div>
      </div>
    </div>
    <div class="table-card">
      <div class="table-card-header">
        <h3>Lançamentos Recentes</h3>
        <a onclick="navigateTo('cash-flow')">Ver tudo</a>
      </div>
      <table>
        <thead><tr><th>Descrição</th><th>Categoria</th><th>Data</th><th>Status</th><th class="text-right">Valor</th></tr></thead>
        <tbody id="recent-tbody"></tbody>
      </table>
    </div>
  `;
  lucide.createIcons();

  try {
    const res = await fetch('/api/summary');
    const data = await res.json();

    document.getElementById('dash-kpis').innerHTML = `
      <div class="kpi-card green">
        <div class="kpi-card-header">
          <span class="kpi-label">Faturamento Mensal</span>
          <span class="kpi-badge ${data.revenueChange >= 0 ? 'positive' : 'negative'}">${data.revenueChange >= 0 ? '+' : ''}${data.revenueChange}%</span>
        </div>
        <div class="kpi-value">${formatCurrency(data.monthlyRevenue)}</div>
        <div class="kpi-sub">vs. mês anterior</div>
      </div>
      <div class="kpi-card blue">
        <div class="kpi-card-header"><span class="kpi-label">Lucro Líquido</span><span class="kpi-badge info">Meta OK</span></div>
        <div class="kpi-value">${formatCurrency(data.netProfit)}</div>
        <div class="kpi-sub">▮ Margem de ${data.operatingMargin}%</div>
      </div>
      <div class="kpi-card purple">
        <div class="kpi-card-header"><span class="kpi-label">Margem de Operação</span><div class="kpi-icon purple"><i data-lucide="trending-up"></i></div></div>
        <div class="kpi-value">${data.operatingMargin}%</div>
      </div>
      <div class="kpi-card orange">
        <div class="kpi-card-header"><span class="kpi-label">Forecast (3 Meses)</span><div class="kpi-icon orange"><i data-lucide="calendar"></i></div></div>
        <div class="kpi-value">${formatCurrency(data.quarterlyForecast)}</div>
        <div class="kpi-sub">Baseado em orçamentos ativos</div>
      </div>
    `;
    lucide.createIcons();

    // Gráfico de barras
    destroyChart('cashflow-chart');
    const cfCtx = document.getElementById('cashflow-chart').getContext('2d');
    chartInstances['cashflow-chart'] = new Chart(cfCtx, {
      type: 'bar',
      data: {
        labels: data.cashFlowHistory.map(h => h.month),
        datasets: [
          { label: 'Entradas', data: data.cashFlowHistory.map(h => h.entradas), backgroundColor: '#2E3A5C', borderRadius: 6, barPercentage: 0.4 },
          { label: 'Saídas', data: data.cashFlowHistory.map(h => h.saidas), backgroundColor: '#94a3b8', borderRadius: 6, barPercentage: 0.4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { x: { grid: { display: false } }, y: { grid: { color: '#f1f5f9' }, ticks: { callback: v => `R$ ${(v / 1000).toFixed(0)}k` } } }
      }
    });

    // Gráfico Donut
    destroyChart('donut-chart');
    const dCtx = document.getElementById('donut-chart').getContext('2d');
    const expData = data.expenseByCategory.length > 0 ? data.expenseByCategory.slice(0, 5) : [{ name: 'Sem dados', color: '#e2e8f0', value: 1 }];
    const totalExp = expData.reduce((s, e) => s + e.value, 0);
    chartInstances['donut-chart'] = new Chart(dCtx, {
      type: 'doughnut',
      data: { labels: expData.map(e => e.name), datasets: [{ data: expData.map(e => e.value), backgroundColor: expData.map(e => e.color), borderWidth: 0, cutout: '72%' }] },
      options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatCurrency(ctx.raw)}` } } } }
    });
    document.getElementById('donut-legend').innerHTML = expData.map(e => {
      const pct = totalExp > 0 ? Math.round(e.value / totalExp * 100) : 0;
      return `<div class="donut-legend-item"><div class="donut-legend-left"><div class="donut-legend-dot" style="background:${e.color}"></div><span>${e.name}</span></div><strong>${pct}%</strong></div>`;
    }).join('');

    // Lançamentos recentes
    document.getElementById('recent-tbody').innerHTML = data.recentTransactions.length === 0
      ? '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-muted)">Nenhum lançamento registrado. Use o Fluxo de Caixa para adicionar.</td></tr>'
      : data.recentTransactions.map(t => `
        <tr>
          <td class="td-description"><strong>${t.description}</strong>${t.clientName ? `<span>${t.clientName}</span>` : ''}</td>
          <td>${categoryBadge(t.category)}</td><td>${formatDate(t.date)}</td>
          <td>${statusBadge(t.status)}</td>
          <td class="text-right ${t.type === 'ENTRADA' ? 'value-positive' : 'value-negative'}">${formatCurrency(t.value)}</td>
        </tr>`).join('');
  } catch (err) { console.error('Erro ao carregar dashboard:', err); }
}

// ============================================
// PÁGINA: FLUXO DE CAIXA
// ============================================
let cfFilters = {};

async function loadCashFlow() {
  const now = new Date();
  cfFilters = { month: now.getMonth() + 1, year: now.getFullYear() };
  const page = document.getElementById('page-cash-flow');
  page.innerHTML = `
    <div class="page-header-actions">
      <div class="page-header"><h2>Fluxo de Caixa Detalhado</h2><p>Monitoramento de movimentações financeiras</p></div>
      <div style="display:flex;gap:10px;align-items:center">
        <div class="export-buttons">
          <button class="btn-outline" onclick="exportPagePDF('Fluxo de Caixa')"><i data-lucide="file-text"></i> PDF</button>
          <button class="btn-outline" onclick="downloadExcel()"><i data-lucide="table"></i> Excel</button>
          <button class="btn-outline" onclick="openImportModal()" style="border-color:var(--brand-gold);color:var(--brand-gold)"><i data-lucide="upload"></i> Importar</button>
        </div>
        <button class="new-entry-btn" onclick="openModal()"><i data-lucide="plus-circle"></i> Novo Lançamento</button>
      </div>
    </div>
    <div class="summary-row" id="cf-summary">${[1, 2, 3].map(() => `<div class="summary-card"><div class="skeleton" style="height:80px"></div></div>`).join('')}</div>
    <div class="filter-bar">
      <label><i data-lucide="filter"></i> Filtros:</label>
      <select class="filter-select" id="cf-filter-year" onchange="applyCashFlowFilters()">
        ${Array.from({ length: 5 }, (_, i) => {
    const y = new Date().getFullYear() - 2 + i;
    return `<option value="${y}" ${y === cfFilters.year ? 'selected' : ''}>${y}</option>`;
  }).join('')}
      </select>
      <select class="filter-select" id="cf-filter-month" onchange="applyCashFlowFilters()">
        <option value="">Todos os meses</option>
        ${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === cfFilters.month ? 'selected' : ''}>${new Date(2023, i).toLocaleDateString('pt-BR', { month: 'long' })}</option>`).join('')}
      </select>
      <select class="filter-select" id="cf-filter-status" onchange="applyCashFlowFilters()">
        <option value="">Todos os Status</option><option value="PAGO">Pago</option><option value="PENDENTE">Pendente</option><option value="VENCIDO">Vencido</option><option value="CANCELADO">Cancelado</option>
      </select>
      <select class="filter-select" id="cf-filter-category" onchange="applyCashFlowFilters()">
        <option value="">Todas as Categorias</option>${categoriesCache.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
      </select>
      <select class="filter-select" id="cf-filter-costcenter" onchange="applyCashFlowFilters()">
        <option value="">Todos os Centros</option>
        <option value="Litigation">Contencioso</option>
        <option value="Labor">Trabalhista</option>
        <option value="Civil">Cível</option>
        <option value="Precatorio">Precatório</option>
        <option value="Familia">Família</option>
        <option value="Ambiental">Ambiental</option>
        <option value="Criminal">Criminal</option><option value="Penal">Penal</option>
        <option value="Previdenciario">Previdenciário</option>
        <option value="Corporate">Societário</option>
        <option value="Admin">Administrativo</option>
        <option value="Outros">Outros</option>
      </select>
      <button class="filter-clear" onclick="clearCashFlowFilters()">Limpar</button>
    </div>
    <div class="table-card">
      <table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Centro de Custo</th><th>Status</th><th class="text-center">Banco</th><th class="text-right">Valor</th><th></th></tr></thead>
      <tbody id="cf-tbody"><tr><td colspan="7"><div class="skeleton" style="height:200px"></div></td></tr></tbody></table>
      <div class="table-footer" id="cf-footer"></div>
    </div>`;
  lucide.createIcons();
  await fetchCashFlowData();
}

async function applyCashFlowFilters() {
  const monthVal = document.getElementById('cf-filter-month').value;
  cfFilters.month = monthVal ? parseInt(monthVal) : null;
  cfFilters.year = parseInt(document.getElementById('cf-filter-year').value);
  cfFilters.status = document.getElementById('cf-filter-status').value;
  cfFilters.category = document.getElementById('cf-filter-category').value;
  cfFilters.costCenter = document.getElementById('cf-filter-costcenter').value;
  await fetchCashFlowData();
}

function clearCashFlowFilters() {
  document.getElementById('cf-filter-status').value = '';
  document.getElementById('cf-filter-category').value = '';
  document.getElementById('cf-filter-costcenter').value = '';
  cfFilters = { month: cfFilters.month, year: cfFilters.year };
  fetchCashFlowData();
}

async function fetchCashFlowData() {
  try {
    const params = new URLSearchParams();
    if (cfFilters.month) params.set('month', cfFilters.month);
    if (cfFilters.year) params.set('year', cfFilters.year);
    if (cfFilters.status) params.set('status', cfFilters.status);
    if (cfFilters.category) params.set('category', cfFilters.category);
    if (cfFilters.costCenter) params.set('costCenter', cfFilters.costCenter);
    params.set('limit', '50');

    const res = await fetch(`/api/transactions?${params}`);
    const data = await res.json();

    document.getElementById('cf-summary').innerHTML = `
      <div class="summary-card">
        <div class="summary-icon" style="background:var(--accent-green-bg);color:var(--accent-green)"><i data-lucide="trending-up"></i></div>
        <div class="summary-label">Total Entradas</div>
        <div class="summary-value value-positive">${formatCurrency(data.totalIn)}</div>
      </div>
      <div class="summary-card">
        <div class="summary-icon" style="background:var(--accent-red-bg);color:var(--accent-red)"><i data-lucide="trending-down"></i></div>
        <div class="summary-label">Total Saídas</div>
        <div class="summary-value value-negative">${formatCurrency(data.totalOut)}</div>
      </div>
      <div class="summary-card highlight">
        <div class="summary-icon" style="background:rgba(255,255,255,0.15);color:white"><i data-lucide="landmark"></i></div>
        <div class="summary-label">Saldo Líquido</div>
        <div class="summary-value">${formatCurrency(data.netBalance)}</div>
        <div class="summary-sub">Disponível para distribuição</div>
      </div>`;
    lucide.createIcons();

    const costCenterMap = { Litigation: 'Contencioso', Corporate: 'Societário', Labor: 'Trabalhista', Civil: 'Cível', Admin: 'Administrativo', Precatorio: 'Precatório', Familia: 'Família', Ambiental: 'Ambiental', Criminal: 'Criminal', Penal: 'Penal', Previdenciario: 'Previdenciário', Outros: 'Outros' };
    document.getElementById('cf-tbody').innerHTML = data.transactions.length === 0
      ? '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted)">Nenhum lançamento encontrado. Clique em "Novo Lançamento" para adicionar.</td></tr>'
      : data.transactions.map(t => `<tr>
          <td>${formatDate(t.date)}</td>
          <td class="td-description"><strong>${t.description}</strong>${t.clientName ? `<span>Cliente: ${t.clientName}</span>` : ''}${t.reference ? `<span>Ref: ${t.reference}</span>` : ''}</td>
          <td>${categoryBadge(t.category)}</td>
          <td>${costCenterMap[t.costCenter] || t.costCenter || '—'}</td>
          <td>${statusBadge(t.status, t.id)}</td>
          <td class="text-center" style="font-size:0.85rem;color:var(--text-muted)">${t.bank || '—'}</td>
          <td class="text-right ${t.type === 'ENTRADA' ? 'value-positive' : 'value-negative'}">${formatCurrency(t.value)}</td>
          <td style="width:60px;white-space:nowrap">
            <button class="icon-btn" onclick="editTransaction('${t.id}')" title="Editar" style="color:var(--text-muted);font-size:0.8rem;margin-right:4px"><i data-lucide="edit-2" style="width:14px;height:14px"></i></button>
            <button class="icon-btn" onclick="deleteTransaction('${t.id}')" title="Excluir" style="color:var(--text-muted);font-size:0.8rem"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
          </td>
        </tr>`).join('');
    lucide.createIcons();
    document.getElementById('cf-footer').innerHTML = `<strong>Saldo do Período: ${formatCurrency(data.netBalance)}</strong>`;
  } catch (err) { console.error('Erro ao carregar fluxo de caixa:', err); }
}

// ============================================
// PÁGINA: FORECAST
// ============================================
let forecastFilters = {};
let forecastPeriod = 'monthly';

async function loadForecast() {
  const now = new Date();
  forecastFilters = { month: now.getMonth() + 1, year: now.getFullYear() };
  const page = document.getElementById('page-forecast');
  page.innerHTML = `
    <div class="page-header-actions">
      <div class="page-header"><h2>Planejamento Orçamentário</h2><p>Visão abrangente de Orçado vs. Realizado em todos os departamentos jurídicos.</p></div>
      <div style="display:flex;gap:10px;align-items:center">
        <div class="btn-group">
          <button class="active" onclick="setForecastPeriod('monthly', this)">Mensal</button>
          <button onclick="setForecastPeriod('quarterly', this)">Trimestral</button>
          <button onclick="setForecastPeriod('yearly', this)">Anual</button>
        </div>
        <button class="btn-outline" onclick="exportPagePDF('Planejamento Orçamentário')"><i data-lucide="download"></i> Exportar PDF</button>
        <button class="btn-primary" onclick="openBudgetModal()"><i data-lucide="plus"></i> Novo Orçamento</button>
      </div>
    </div>
    <div class="filter-bar">
      <label><i data-lucide="filter"></i> Filtros:</label>
      <select class="filter-select" id="fc-filter-year" onchange="applyForecastFilters()">
        ${[2024, 2025, 2026, 2027].map(y => `<option value="${y}" ${y === forecastFilters.year ? 'selected' : ''}>${y}</option>`).join('')}
      </select>
      <select class="filter-select" id="fc-filter-month" onchange="applyForecastFilters()">
        <option value="0">Todos os meses</option>
        ${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === forecastFilters.month ? 'selected' : ''}>${new Date(2023, i).toLocaleDateString('pt-BR', { month: 'long' })}</option>`).join('')}
      </select>
      <select class="filter-select" id="fc-filter-category" onchange="applyForecastFilters()">
        <option value="">Todas as Categorias</option>
        ${categoriesCache.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
      </select>
      <select class="filter-select" id="fc-filter-costcenter" onchange="applyForecastFilters()">
        <option value="">Todos os Departamentos</option>
        <option value="Litigation">Contencioso</option>
        <option value="Labor">Trabalhista</option>
        <option value="Civil">Cível</option>
        <option value="Precatorio">Precatório</option>
        <option value="Familia">Família</option>
        <option value="Ambiental">Ambiental</option>
        <option value="Criminal">Criminal</option><option value="Penal">Penal</option>
        <option value="Previdenciario">Previdenciário</option>
        <option value="Corporate">Societário</option>
        <option value="Admin">Administrativo</option>
        <option value="Outros">Outros</option>
      </select>
    </div>
    <div class="summary-row" id="fc-summary">${[1, 2, 3].map(() => `<div class="summary-card"><div class="skeleton" style="height:80px"></div></div>`).join('')}</div>
    <div class="progress-section" id="fc-progress"></div>
    <div class="table-card">
      <table><thead><tr><th>Categoria</th><th>Centro de Custo</th><th>Período</th><th>Orçado</th><th>Realizado</th><th class="text-right">Variância (%)</th><th></th></tr></thead>
      <tbody id="fc-tbody"><tr><td colspan="7"><div class="skeleton" style="height:200px"></div></td></tr></tbody>
      <tfoot id="fc-tfoot"></tfoot></table>
    </div>
    <div class="insight-grid" id="fc-insights"></div>`;
  lucide.createIcons();
  await fetchForecastData();
}

async function applyForecastFilters() {
  const m = parseInt(document.getElementById('fc-filter-month').value);
  forecastFilters.month = m === 0 ? 1 : m;
  forecastFilters.year = parseInt(document.getElementById('fc-filter-year').value);
  forecastFilters.category = document.getElementById('fc-filter-category').value || null;
  forecastFilters.costCenter = document.getElementById('fc-filter-costcenter').value || null;

  const buttons = document.querySelectorAll('.page-header-actions .btn-group button');
  if (m === 0) {
    forecastPeriod = 'yearly';
    buttons.forEach(b => b.classList.remove('active'));
    if (buttons[2]) buttons[2].classList.add('active'); // Anual button
  } else {
    if (forecastPeriod === 'yearly') {
      forecastPeriod = 'monthly';
      buttons.forEach(b => b.classList.remove('active'));
      if (buttons[0]) buttons[0].classList.add('active'); // Mensal button
    }
  }
  await fetchForecastData();
}

function setForecastPeriod(period, btn) {
  forecastPeriod = period;
  btn.parentNode.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const monthSelect = document.getElementById('fc-filter-month');
  if (monthSelect) {
    if (period === 'yearly') {
      monthSelect.disabled = true;
      monthSelect.value = '1';
      forecastFilters.month = 1;
    } else {
      monthSelect.disabled = false;
    }
  }
  fetchForecastData();
}

async function fetchForecastData() {
  try {
    // Determine months to fetch based on period
    const months = [];
    const baseMonth = forecastFilters.month;
    const baseYear = forecastFilters.year;
    const count = forecastPeriod === 'yearly' ? 12 : forecastPeriod === 'quarterly' ? 3 : 1;
    for (let i = 0; i < count; i++) {
      let m = baseMonth + i;
      let y = baseYear;
      while (m > 12) { m -= 12; y++; }
      months.push({ month: m, year: y });
    }

    // Fetch all months and aggregate
    const results = await Promise.all(months.map(({ month, year }) => {
      let url = `/api/forecast/variance?month=${month}&year=${year}`;
      if (forecastFilters.category) url += `&category=${encodeURIComponent(forecastFilters.category)}`;
      if (forecastFilters.costCenter) url += `&costCenter=${encodeURIComponent(forecastFilters.costCenter)}`;
      return fetch(url).then(r => r.json());
    }));

    // Aggregate data
    const data = {
      totalBudgeted: results.reduce((s, r) => s + r.totalBudgeted, 0),
      totalActual: results.reduce((s, r) => s + r.totalActual, 0),
      remaining: results.reduce((s, r) => s + r.remaining, 0),
      netProfit: results.reduce((s, r) => s + (r.netProfit || 0), 0),
      totalRevenue: results.reduce((s, r) => s + (r.totalRevenue || 0), 0),
      totalExpenses: results.reduce((s, r) => s + (r.totalExpenses || 0), 0),
      totalTaxes: results.reduce((s, r) => s + (r.totalTaxes || 0), 0),
      departments: {},
      items: [],
      month: baseMonth,
      year: baseYear
    };

    // Merge departments and items
    results.forEach(r => {
      r.items.forEach(item => {
        const existing = data.items.find(i => i.budgetId === item.budgetId);
        if (existing) {
          existing.budgeted += item.budgeted;
          existing.actual += item.actual;
          existing.variancePct = existing.budgeted > 0 ? Math.round(((existing.actual - existing.budgeted) / existing.budgeted) * 1000) / 10 : 0;
          existing.status = existing.actual > existing.budgeted ? 'over_budget' : existing.actual < existing.budgeted * 0.8 ? 'under_budget' : 'on_track';
        } else {
          data.items.push({
            ...item,
            month: forecastPeriod !== 'monthly' ? null : item.month,
            year: forecastPeriod !== 'monthly' ? null : item.year
          });
        }
      });
      for (const [dept, items] of Object.entries(r.departments)) {
        if (!data.departments[dept]) data.departments[dept] = [];
        items.forEach(item => {
          const ex = data.departments[dept].find(i => i.budgetId === item.budgetId);
          if (ex) {
            ex.budgeted += item.budgeted;
            ex.actual += item.actual;
            ex.variancePct = ex.budgeted > 0 ? Math.round(((ex.actual - ex.budgeted) / ex.budgeted) * 1000) / 10 : 0;
          } else {
            data.departments[dept].push({
              ...item,
              month: forecastPeriod !== 'monthly' ? null : item.month,
              year: forecastPeriod !== 'monthly' ? null : item.year
            });
          }
        });
      }
    });

    const periodLabel = forecastPeriod === 'yearly' ? `Anual ${baseYear}` : forecastPeriod === 'quarterly' ? `T${Math.ceil(baseMonth / 3)} ${baseYear}` : `${baseMonth}/${baseYear}`;

    const exceeded = data.totalActual >= data.totalBudgeted;
    const reachPct = data.totalBudgeted > 0 ? Math.round((data.totalActual / data.totalBudgeted) * 1000) / 10 : 0;
    const saldo = data.totalActual - data.totalBudgeted;
    document.getElementById('fc-summary').innerHTML = `
      <div class="summary-card">
        <div class="summary-icon" style="background:var(--accent-blue-bg);color:var(--accent-blue)"><i data-lucide="target"></i></div>
        <div class="summary-label">Meta Orçada</div>
        <div class="summary-value">${formatCurrency(data.totalBudgeted)}</div>
        <div class="summary-sub">${periodLabel}</div>
      </div>
      <div class="summary-card">
        <div class="summary-icon" style="background:${exceeded ? 'var(--accent-green-bg)' : 'var(--accent-orange-bg)'};color:${exceeded ? 'var(--accent-green)' : 'var(--accent-orange)'}"><i data-lucide="bar-chart-3"></i></div>
        <div class="summary-label">Lucro Líquido (Realizado)</div>
        <div class="summary-value">${formatCurrency(data.totalActual)}</div>
        <div class="summary-sub ${saldo === 0 ? '' : exceeded ? 'value-positive' : 'value-negative'}" ${saldo === 0 ? 'style="color:var(--accent-blue)"' : ''}>${data.totalBudgeted > 0 ? (saldo === 0 ? '100% — Dentro da Meta ✓' : `${reachPct}% da meta — ${exceeded ? 'meta superada ✓' : 'abaixo da meta'}`) : 'Sem meta definida'}</div>
      </div>
      <div class="summary-card">
        <div class="summary-icon" style="background:${saldo === 0 ? 'var(--accent-blue-bg)' : saldo > 0 ? 'var(--accent-green-bg)' : 'var(--accent-red-bg)'};color:${saldo === 0 ? 'var(--accent-blue)' : saldo > 0 ? 'var(--accent-green)' : 'var(--accent-red)'}"><i data-lucide="${saldo === 0 ? 'check-circle' : saldo > 0 ? 'trending-up' : 'trending-down'}"></i></div>
        <div class="summary-label">Saldo</div>
        <div class="summary-value" style="color:${saldo === 0 ? 'var(--accent-blue)' : saldo > 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">${saldo === 0 ? 'R$ 0,00' : (saldo > 0 ? '+' : '') + formatCurrency(saldo)}</div>
        <div class="summary-sub"><span style="color:${saldo === 0 ? 'var(--accent-blue)' : saldo > 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">● ${saldo === 0 ? 'Dentro da Meta' : saldo > 0 ? 'Superávit' : `Faltam ${formatCurrency(Math.abs(saldo))}`}</span></div>
      </div>`;
    lucide.createIcons();

    document.getElementById('fc-progress').innerHTML = data.totalBudgeted > 0 ? `
      <div class="progress-header"><h3><i data-lucide="gauge"></i> Atingimento da Meta</h3><span class="progress-pct">${reachPct}%</span></div>
      <div class="progress-bar-wrapper"><div class="progress-bar-fill" style="width:${Math.min(reachPct, 100)}%;background:${exceeded ? 'var(--accent-green)' : reachPct > 70 ? 'var(--accent-orange)' : 'var(--accent-red)'}"></div></div>
      <div class="progress-labels"><span>0%</span><span>Meta: ${formatCurrency(data.totalBudgeted)}</span><span>100%</span></div>
    ` : `<div class="progress-header"><h3><i data-lucide="gauge"></i> Atingimento da Meta</h3><span class="progress-pct">0%</span></div>
      <div class="progress-bar-wrapper"><div class="progress-bar-fill" style="width:0%"></div></div>
      <p style="text-align:center;color:var(--text-muted);margin-top:8px;font-size:0.85rem">Nenhuma meta definida para este período.</p>`;
    lucide.createIcons();

    // Tabela por departamento
    const deptNames = { Litigation: 'Contencioso', Corporate: 'Societário', Labor: 'Trabalhista', Civil: 'Cível', Admin: 'Administrativo', Operations: 'Operações', Marketing: 'Marketing', Personnel: 'Pessoal', Infrastructure: 'Infraestrutura', Precatorio: 'Precatório', Familia: 'Família', Ambiental: 'Ambiental', Criminal: 'Criminal', Previdenciario: 'Previdenciário', Outros: 'Outros' };
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    let tableHtml = '';
    if (data.items.length === 0) {
      tableHtml = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-muted)">Nenhum orçamento encontrado para este período.</td></tr>';
    } else {
      data.items.forEach(item => {
        const periodText = item.month && item.year ? `${monthNames[(item.month || 1) - 1]}/${item.year}` : periodLabel;
        const itemSaldo = item.actual - item.budgeted;
        tableHtml += `<tr>
          <td><span style="display:inline-block;width:8px;height:8px;background:${item.categoryColor || 'var(--text-muted)'};border-radius:50%;margin-right:6px"></span>${item.category}</td>
          <td>${deptNames[item.department] || item.department || '—'}</td>
          <td>${periodText}</td>
          <td>${formatCurrency(item.budgeted)}</td>
          <td>${formatCurrency(item.actual)}</td>
          <td class="text-right"><span class="status-badge ${itemSaldo === 0 ? 'pendente' : itemSaldo > 0 ? 'recebido' : 'vencido'}" style="font-size:0.78rem;${itemSaldo === 0 ? 'background:var(--accent-blue-bg);color:var(--accent-blue)' : ''}">${itemSaldo === 0 ? '0.0%' : (itemSaldo > 0 ? '+' : '') + item.variancePct + '%'}</span></td>
          <td style="width:60px;white-space:nowrap">
            <button class="icon-btn" onclick="editBudget('${item.budgetId}')" title="Editar orçamento" style="color:var(--text-muted);margin-right:4px"><i data-lucide="edit-2" style="width:14px;height:14px"></i></button>
            <button class="icon-btn" onclick="deleteBudget('${item.budgetId}')" title="Excluir orçamento" style="color:var(--text-muted)"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
          </td>
        </tr>`;
      });
    }

    // Add subtotal and tax deduction rows for transparency
    const itemsSubtotal = data.items.reduce((s, i) => s + i.actual, 0);
    const taxes = data.totalTaxes || 0;
    const costs = data.totalCosts || 0;
    if (data.items.length > 0 && (taxes > 0 || costs > 0)) {
      tableHtml += `<tr style="background:var(--bg-secondary);font-weight:600">
        <td colspan="3">Subtotal Operacional</td>
        <td>${formatCurrency(data.items.reduce((s, i) => s + i.budgeted, 0))}</td>
        <td>${formatCurrency(itemsSubtotal)}</td><td></td><td></td></tr>`;
      if (costs > 0) {
        tableHtml += `<tr style="color:var(--accent-purple)">
          <td><span style="display:inline-block;width:8px;height:8px;background:var(--accent-purple);border-radius:50%;margin-right:6px"></span>(-) Custos Fixos/Variáveis</td>
          <td colspan="2"></td><td></td><td>-${formatCurrency(costs)}</td><td></td><td></td></tr>`;
      }
      if (taxes > 0) {
        tableHtml += `<tr style="color:var(--accent-orange)">
          <td><span style="display:inline-block;width:8px;height:8px;background:var(--accent-orange);border-radius:50%;margin-right:6px"></span>(-) Impostos Provisionados</td>
          <td colspan="2"></td><td></td><td>-${formatCurrency(taxes)}</td><td></td><td></td></tr>`;
      }
    }

    document.getElementById('fc-tbody').innerHTML = tableHtml;

    const totalVariancePct = data.totalBudgeted > 0 ? ((data.totalActual - data.totalBudgeted) / data.totalBudgeted * 100) : 0;
    document.getElementById('fc-tfoot').innerHTML = data.totalBudgeted > 0 ? `<tr style="font-weight:700;background:var(--bg-secondary)">
      <td><strong>LUCRO LÍQUIDO</strong></td><td></td><td></td><td><strong>${formatCurrency(data.totalBudgeted)}</strong></td>
      <td><strong>${formatCurrency(data.totalActual)}</strong></td><td class="text-right"><span class="status-badge ${saldo === 0 ? 'pendente' : saldo > 0 ? 'recebido' : 'vencido'}" style="${saldo === 0 ? 'background:var(--accent-blue-bg);color:var(--accent-blue)' : ''}">${saldo === 0 ? 'Dentro da Meta' : (saldo > 0 ? '+' : '') + totalVariancePct.toFixed(1) + '%'}</span></td><td></td></tr>` : '';

    // Insights
    // Insights
    const deptStats = Object.keys(data.departments).map(deptKey => {
      const dItems = data.departments[deptKey];
      return {
        department: deptNames[deptKey] || deptKey || 'Não Alocado',
        budgeted: dItems.reduce((s, i) => s + i.budgeted, 0),
        actual: dItems.reduce((s, i) => s + i.actual, 0)
      };
    }).filter(d => d.budgeted > 0 || d.actual > 0).sort((a, b) => b.budgeted - a.budgeted);

    const belowTargetDepts = deptStats.filter(d => d.actual < d.budgeted);
    const aboveTargetDepts = deptStats.filter(d => d.actual >= d.budgeted);
    document.getElementById('fc-insights').innerHTML = `
      <div class="risk-card">
        <h3><i data-lucide="bar-chart-2"></i> Desempenho por Centro de Custo</h3>
        ${deptStats.length === 0 ? '<p style="color:var(--text-muted);font-size:0.85rem">Sem dados de orçamento para análise.</p>' :
        deptStats.map(i => {
          const pct = i.budgeted > 0 ? Math.round((i.actual / i.budgeted) * 100) : 0;
          const good = i.actual >= i.budgeted;
          return `<div class="risk-item"><span class="risk-label">${i.department}</span><span class="risk-status ${good ? 'medium' : 'critical'}">${pct}% da meta</span></div>
          <div class="mini-progress"><div class="mini-progress-fill" style="width:${Math.min(pct, 100)}%;background:${good ? 'var(--accent-green)' : pct > 70 ? 'var(--accent-orange)' : 'var(--accent-red)'}"></div></div>`;
        }).join('')}
      </div>
      <div class="insight-card">
        <h3><i data-lucide="lightbulb"></i> Projeção Financeira</h3>
        <p>${data.totalBudgeted > 0 ? `Com base na captação atual, ${exceeded
        ? `a meta foi superada em <span class="highlight-value">${formatCurrency(saldo)}</span>. ${aboveTargetDepts.length > 0 ? `Centros com bom desempenho: ${aboveTargetDepts.map(i => i.department).join(', ')}.` : ''}`
        : `faltam <span class="highlight-value">${formatCurrency(Math.abs(saldo))}</span> para atingir a meta. ${belowTargetDepts.length > 0 ? `Centros abaixo da meta: ${belowTargetDepts.map(i => i.department).join(', ')}.` : ''}`}` :
        'Defina metas orçamentárias para visualizar projeções.'}</p>
        <a onclick="openBudgetModal()" style="cursor:pointer">Ajustar Projeções Futuras</a>
      </div>`;
    lucide.createIcons();
  } catch (err) { console.error('Erro ao carregar forecast:', err); }
}

async function deleteBudget(id) {
  if (!confirm('Deseja excluir este orçamento?')) return;
  try {
    const res = await fetch(`/api/budgets/${id}`, { method: 'DELETE' });
    if (res.ok) await fetchForecastData();
  } catch (err) { console.error('Erro ao excluir orçamento:', err); }
}

// ============================================
// PÁGINA: IMPOSTOS
// ============================================
let taxFilters = {};

async function loadTaxes() {
  const now = new Date();
  if (!taxFilters.month) { taxFilters.month = now.getMonth() + 1; taxFilters.year = now.getFullYear(); }
  const page = document.getElementById('page-taxes');
  page.innerHTML = `
    <div class="page-header-actions">
      <div class="page-header"><h2>Fiscal & Provisões</h2><p>Acompanhamento de obrigações fiscais e controle de carga tributária</p></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <select class="filter-select" id="tax-filter-year" onchange="applyTaxFilters()" style="padding:6px 10px;font-size:0.82rem">
          ${[2024, 2025, 2026, 2027].map(y => `<option value="${y}" ${y === taxFilters.year ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
        <select class="filter-select" id="tax-filter-month" onchange="applyTaxFilters()" style="padding:6px 10px;font-size:0.82rem">
          <option value="0" ${taxFilters.month === 0 ? 'selected' : ''}>Todos os meses</option>
          ${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === taxFilters.month ? 'selected' : ''}>${new Date(2023, i).toLocaleDateString('pt-BR', { month: 'long' })}</option>`).join('')}
        </select>
        <button class="new-entry-btn" onclick="openCostModal('fixo')" style="height:36px;background:var(--accent-blue)"><i data-lucide="building"></i> Custo Fixo</button>
        <button class="new-entry-btn" onclick="openCostModal('variavel')" style="height:36px;background:var(--accent-purple)"><i data-lucide="shuffle"></i> Custo Variável</button>
        <button class="new-entry-btn" onclick="openProvisionModal()" style="height:36px"><i data-lucide="plus"></i> Nova Provisão</button>
      </div>
    </div>
    <div class="kpi-grid" id="tax-kpis">${[1, 2, 3, 4].map(() => `<div class="kpi-card"><div class="skeleton" style="height:90px"></div></div>`).join('')}</div>
    <div class="taxes-grid">
      <div class="table-card">
        <div class="table-card-header"><h3>Impostos Provisionados</h3><a onclick="openTaxHistoryModal()" style="cursor:pointer">Ver Histórico</a></div>
        <table><thead><tr><th>Imposto</th><th>Competência</th><th>Vencimento</th><th>Valor</th><th>Status</th><th></th></tr></thead>
        <tbody id="tax-tbody"><tr><td colspan="6"><div class="skeleton" style="height:150px"></div></td></tr></tbody></table>
        <div class="table-footer" id="tax-footer"></div>
      </div>
      <div>
        <div class="fund-card" id="tax-fund"></div>
        <div class="fund-card" style="margin-top:18px" id="tax-obligations">
          <h3><i data-lucide="calendar-clock"></i> Próximas Obrigações</h3>
          <div id="obligation-list"></div>
        </div>
      </div>
    </div>
    <div class="table-card" style="margin-top:18px">
      <div class="table-card-header"><h3>Custos Fixos e Variáveis</h3></div>
      <table><thead><tr><th>Descrição</th><th>Tipo</th><th>Categoria</th><th>Data</th><th>Status</th><th>Valor</th><th></th></tr></thead>
      <tbody id="costs-tbody"><tr><td colspan="7"><div class="skeleton" style="height:100px"></div></td></tr></tbody></table>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(400px, 1fr));gap:24px;margin-top:24px">
      <div class="chart-card">
        <div class="chart-card-header">
          <div><h3>Evolução de Tributos (R$)</h3><span>Histórico dos últimos 6 meses</span></div>
        </div>
        <div class="chart-container" style="position:relative;height:250px"><canvas id="tax-chart-bar"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-card-header">
          <div><h3>Proporção Carga Tributária (%)</h3><span>Acumulado dos últimos 6 meses</span></div>
        </div>
        <div class="chart-container" style="position:relative;height:250px"><canvas id="tax-chart-pie"></canvas></div>
      </div>
    </div>`;
  lucide.createIcons();

  try {
    const res = await fetch(`/api/taxes?month=${taxFilters.month}&year=${taxFilters.year}`);
    const data = await res.json();
    const totalProv = data.totalProvisionado + data.totalPago + data.totalPlanejado;

    document.getElementById('tax-kpis').innerHTML = `
      <div class="kpi-card blue"><div class="kpi-card-header"><span class="kpi-label">Custos Fixos</span></div><div class="kpi-value">${formatCurrency(data.custosFixos)}</div></div>
      <div class="kpi-card purple"><div class="kpi-card-header"><span class="kpi-label">Custos Variáveis</span></div><div class="kpi-value">${formatCurrency(data.custosVariaveis)}</div></div>
      <div class="kpi-card green"><div class="kpi-card-header"><span class="kpi-label">Total Provisionado</span></div><div class="kpi-value">${formatCurrency(totalProv)}</div></div>
      <div class="kpi-card orange"><div class="kpi-card-header"><span class="kpi-label">Carga Tributária</span></div><div class="kpi-value">${data.cargaTributaria}%</div><div class="kpi-sub">Meta: ${data.cargaTarget}%</div></div>`;

    const taxTypeNames = { 'ISS': 'Serviços Advocatícios', 'PIS/COFINS': 'Faturamento Bruto', 'IRPJ': 'Lucro Presumido', 'CSLL': 'Contribuição Social', 'FGTS': 'Folha de Pagamento' };
    document.getElementById('tax-tbody').innerHTML = data.provisions.length === 0
      ? '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-muted)">Nenhuma provisão. Clique em "+ Nova Provisão" para adicionar.</td></tr>'
      : data.provisions.map(p => `<tr>
          <td class="td-description"><strong>${p.taxType}</strong><span>${taxTypeNames[p.taxType] || ''}</span></td>
          <td>${p.competence}</td><td>${formatDate(p.dueDate)}</td><td>${formatCurrency(p.value)}</td>
          <td><span class="status-badge ${p.status.toLowerCase()}" style="cursor:pointer" onclick="cycleProvisionStatus('${p.id}', '${p.status}')" title="Clique para alterar">${p.status}</span></td>
          <td style="width:60px;white-space:nowrap">
            <button class="icon-btn" onclick="editProvision('${p.id}')" title="Editar" style="color:var(--text-muted);margin-right:4px"><i data-lucide="edit-2" style="width:14px;height:14px"></i></button>
            <button class="icon-btn" onclick="deleteProvision('${p.id}')" title="Excluir" style="color:var(--text-muted)"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
          </td>
        </tr>`).join('');
    lucide.createIcons();

    document.getElementById('tax-footer').innerHTML = `<span style="margin-right:auto;color:var(--text-muted);font-size:0.82rem">Próxima apuração automática em: 5 dias</span>
      <button class="btn-outline" style="margin-right:8px">Anterior</button><button class="btn-outline">Próximo</button>`;

    document.getElementById('tax-fund').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3><i data-lucide="landmark"></i> Fundo de Provisão</h3>
        <button class="icon-btn" onclick="openFundConfigModal(${data.fundoDeProvisao.meta}, '${data.fundoDeProvisao.period}')" title="Ajustar Meta"><i data-lucide="settings" style="width:16px;height:16px;color:var(--text-muted)"></i></button>
      </div>
      <div class="fund-value">${formatCurrency(data.fundoDeProvisao.acumulado)} / ${formatCurrency(data.fundoDeProvisao.meta)}</div>
      <div class="fund-sub">Total Acumulado</div>
      <div class="mini-progress" style="height:10px"><div class="mini-progress-fill" style="width:${Math.min(data.fundoDeProvisao.percentual, 100)}%;background:linear-gradient(90deg, var(--accent-blue), var(--accent-green))"></div></div>
      <p style="margin-top:14px;font-size:0.82rem;color:var(--text-muted)">Você atingiu ${data.fundoDeProvisao.percentual}% da meta de reserva para o próximo ${data.fundoDeProvisao.period || 'trimestre fiscal'}.</p>`;
    lucide.createIcons();

    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    document.getElementById('obligation-list').innerHTML = data.proximasObrigacoes.length === 0
      ? '<p style="color:var(--text-muted);font-size:0.85rem;padding:10px 0">Sem obrigações pendentes.</p>'
      : data.proximasObrigacoes.map(o => {
        const d = new Date(o.dueDate);
        return `<div class="obligation-item"><div class="obligation-date"><span class="month">${monthNames[d.getMonth()]}</span><span class="day">${d.getDate()}</span></div>
          <div class="obligation-info"><strong>${o.taxType}</strong><span>Vence em ${Math.max(0, Math.ceil((d - new Date()) / 86400000))} dias</span></div>
          <span class="obligation-value">${formatCurrency(o.value)}</span></div>`;
      }).join('') + '<a style="display:block;text-align:center;padding:10px;color:var(--accent-blue);font-size:0.85rem;font-weight:600;cursor:pointer;margin-top:8px">Ver Calendário Completo</a>';

    // Custos Fixos e Variáveis table
    if (data.custosList && data.custosList.length > 0) {
      document.getElementById('costs-tbody').innerHTML = data.custosList.map(c => `<tr>
        <td>${c.description}</td>
        <td><span class="status-badge ${c.isFixed ? 'pendente' : 'planejado'}" style="font-size:0.75rem;${c.isFixed ? 'background:var(--accent-blue-bg);color:var(--accent-blue)' : 'background:var(--accent-purple-bg);color:var(--accent-purple)'}">${c.isFixed ? 'Fixo' : 'Variável'}</span></td>
        <td>${c.category || '—'}</td>
        <td>${formatDate(c.date)}</td>
        <td><span class="status-badge ${c.status?.toLowerCase() || 'pendente'}" style="cursor:pointer" onclick="cycleStatus('${c.id}', '${c.status || 'PENDENTE'}')" title="Clique para alterar">${c.status || 'PENDENTE'}</span></td>
        <td>${formatCurrency(c.value)}</td>
        <td style="width:60px;white-space:nowrap">
          <button class="icon-btn" onclick="editCost('${c.id}')" title="Editar" style="color:var(--text-muted);margin-right:4px"><i data-lucide="edit-2" style="width:14px;height:14px"></i></button>
          <button class="icon-btn" onclick="deleteTransaction('${c.id}')" title="Excluir" style="color:var(--text-muted)"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
        </td>
      </tr>`).join('');
    } else {
      document.getElementById('costs-tbody').innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted)">Nenhum custo lançado. Use os botões acima para adicionar.</td></tr>';
    }

    // Store tax history data for charts
    window._taxHistoryData = data.taxHistory;
    renderTaxChart();
    lucide.createIcons();
  } catch (err) { console.error('Erro ao carregar impostos:', err); }
}

function renderTaxChart() {
  const data = window._taxHistoryData;
  if (!data || data.length === 0) return;
  destroyChart('tax-chart-bar');
  destroyChart('tax-chart-pie');

  // Bar Chart Data (Historical by month)
  const labels = data.map(d => d.month);
  const revData = data.map(d => d.revenue);
  const taxData = data.map(d => d.taxes || (d.revenue * d.rate / 100));

  const ctxBar = document.getElementById('tax-chart-bar')?.getContext('2d');
  if (ctxBar) {
    chartInstances['tax-chart-bar'] = new Chart(ctxBar, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Receita Bruta (R$)', data: revData, backgroundColor: '#2E3A5C', borderRadius: 4 },
          { label: 'Impostos (R$)', data: taxData, backgroundColor: '#D4A76A', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false } },
          y: { grid: { borderDash: [4, 4], color: '#EBE0D0' }, ticks: { callback: v => 'R$ ' + (v / 1000).toFixed(0) + 'k' } }
        },
        plugins: {
          legend: { position: 'top', align: 'end', labels: { boxWidth: 12, usePointStyle: true } },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}` } }
        }
      }
    });
  }

  // Pie Chart Data (Aggregate)
  let totalRevenue = 0;
  let totalTaxes = 0;
  data.forEach(h => {
    totalRevenue += h.revenue;
    totalTaxes += (h.taxes || h.revenue * h.rate / 100);
  });

  const ctxPie = document.getElementById('tax-chart-pie')?.getContext('2d');
  if (ctxPie) {
    const revPct = totalRevenue > 0 ? 100 - (totalTaxes / totalRevenue * 100) : 0;
    const taxPct = totalRevenue > 0 ? (totalTaxes / totalRevenue * 100) : 0;

    chartInstances['tax-chart-pie'] = new Chart(ctxPie, {
      type: 'doughnut',
      data: {
        labels: ['Receita Líquida (%)', 'Impostos (%)'],
        datasets: [{
          data: [revPct, taxPct],
          backgroundColor: ['#2E3A5C', '#D4A76A'],
          borderWidth: 0,
          cutout: '65%'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12, usePointStyle: true } },
          tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw.toFixed(1)}%` } }
        }
      }
    });
  }
}

// ============================================
// STATUS & AÇÕES EM TRANSAÇÕES
// ============================================
const statusCycle = ['PENDENTE', 'PAGO', 'VENCIDO', 'CANCELADO'];

async function cycleStatus(id, currentStatus) {
  const currentIdx = statusCycle.indexOf(currentStatus);
  const nextStatus = statusCycle[(currentIdx + 1) % statusCycle.length];

  // Atualização otimista na UI
  const el = document.querySelector(`span[onclick="cycleStatus('${id}', '${currentStatus}')"]`);
  if (el) {
    el.className = `status-badge ${nextStatus.toLowerCase()}`;
    el.textContent = nextStatus;
    el.setAttribute('onclick', `cycleStatus('${id}', '${nextStatus}')`);
  }

  try {
    await fetch(`/api/transactions/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus })
    });
    
    // Atualizar os totais na tela principal correspondente
    if (currentPage === 'cash-flow') await fetchCashFlowData();
    else if (currentPage === 'dashboard') await loadDashboard();
    else if (currentPage === 'taxes') await loadTaxes();
  } catch (err) { console.error('Erro ao atualizar status:', err); }
}

async function deleteTransaction(id) {
  if (!confirm('Excluir este lançamento?')) return;
  try {
    const res = await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
    if (res.ok) {
      if (currentPage === 'taxes') await loadTaxes();
      else await fetchCashFlowData();
    }
  } catch (err) { console.error('Erro ao excluir:', err); }
}

async function applyTaxFilters() {
  const m = parseInt(document.getElementById('tax-filter-month').value);
  taxFilters.month = m;
  taxFilters.year = parseInt(document.getElementById('tax-filter-year').value);
  await loadTaxes();
}

// ============================================
// MODAL: CUSTO FIXO / VARIÁVEL
// ============================================
let costModalType = 'fixo';
let editingCostId = null;
const fixedCategories = ['Aluguel', 'Salários', 'Software/SaaS'];

function openCostModal(type) {
  costModalType = type;
  editingCostId = null;
  document.getElementById('cost-modal-overlay').classList.remove('hidden');
  document.getElementById('cost-form').reset();
  document.getElementById('cost-modal-title').textContent = type === 'fixo' ? 'Novo Custo Fixo' : 'Novo Custo Variável';
  const catSelect = document.getElementById('cost-category-select');
  const filtered = type === 'fixo'
    ? categoriesCache.filter(c => fixedCategories.includes(c.name))
    : categoriesCache.filter(c => !fixedCategories.includes(c.name) && c.type === 'DESPESA');
  catSelect.innerHTML = filtered.length > 0
    ? filtered.map(c => `<option value="${c.id}">${c.name}</option>`).join('')
    : categoriesCache.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  // Set the submit button text back to default
  document.querySelector('#cost-form button[type="submit"]').textContent = 'Salvar Custo';
  lucide.createIcons();
}

async function editCost(id) {
  try {
    const res = await fetch(`/api/transactions/${id}`);
    if (!res.ok) throw new Error('Falha ao buscar custo');
    const data = await res.json();

    editingCostId = id;
    document.getElementById('cost-modal-overlay').classList.remove('hidden');
    document.getElementById('cost-modal-title').textContent = 'Editar Custo';

    const catSelect = document.getElementById('cost-category-select');
    catSelect.innerHTML = categoriesCache.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

    const form = document.getElementById('cost-form');
    form.description.value = data.description;
    form.date.value = data.date.split('T')[0];
    form.value.value = Math.abs(data.value);
    form.categoryId.value = data.categoryId || '';
    form.costCenter.value = data.costCenter || '';

    document.querySelector('#cost-form button[type="submit"]').textContent = 'Salvar Alterações';
    lucide.createIcons();
  } catch (e) {
    console.error('Error fetching cost details:', e);
  }
}

function closeCostModal() {
  document.getElementById('cost-modal-overlay').classList.add('hidden');
  editingCostId = null;
}

async function handleNewCost(e) {
  e.preventDefault();
  const form = e.target;
  const data = {
    date: form.date.value,
    description: form.description.value,
    value: parseFloat(form.value.value),
    type: 'SAIDA',
    categoryId: form.categoryId.value,
    costCenter: form.costCenter.value || null,
    isReimbursement: true // prevents tax provisioning
  };

  try {
    const method = editingCostId ? 'PUT' : 'POST';
    const url = editingCostId ? `/api/transactions/${editingCostId}` : '/api/transactions';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      closeCostModal();
      await loadTaxes();
    }
  } catch (err) { console.error('Erro ao salvar custo:', err); }
}

// ============================================
// STATUS & AÇÕES EM PROVISÕES (IMPOSTOS)
// ============================================
const provisionStatusCycle = ['PROVISIONADO', 'PLANEJADO', 'PAGO', 'CANCELADO'];

async function cycleProvisionStatus(id, currentStatus) {
  const currentIdx = provisionStatusCycle.indexOf(currentStatus);
  const nextStatus = provisionStatusCycle[(currentIdx + 1) % provisionStatusCycle.length];

  // Atualização otimista na UI
  const el = document.querySelector(`span[onclick="cycleProvisionStatus('${id}', '${currentStatus}')"]`);
  if (el) {
    el.className = `status-badge ${nextStatus.toLowerCase()}`;
    el.textContent = nextStatus;
    el.setAttribute('onclick', `cycleProvisionStatus('${id}', '${nextStatus}')`);
  }

  try {
    await fetch(`/api/taxes/provision/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus })
    });
  } catch (err) { console.error('Erro ao atualizar provisão:', err); }
}

async function deleteProvision(id) {
  if (!confirm('Excluir esta provisão?')) return;
  try {
    const res = await fetch(`/api/taxes/provision/${id}`, { method: 'DELETE' });
    if (res.ok) await loadTaxes();
  } catch (err) { console.error('Erro ao excluir provisão:', err); }
}

// ============================================
// MODAL: ORÇAMENTO (FORECAST)
// ============================================
let editingBudgetId = null;
function openBudgetModal() {
  editingBudgetId = null;
  document.getElementById('budget-modal-overlay').classList.remove('hidden');
  document.getElementById('budget-form').reset();
  const catSelect = document.getElementById('budget-category-select');
  catSelect.innerHTML = categoriesCache.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  const now = new Date();
  document.getElementById('budget-month').value = forecastFilters.month || now.getMonth() + 1;
  document.getElementById('budget-year').value = forecastFilters.year || now.getFullYear();
  document.querySelector('#budget-form button[type="submit"]').textContent = 'Salvar Projeção';
  document.querySelector('#budget-modal-overlay h2').textContent = 'Novo Orçamento';
  document.getElementById('budget-installments-group').style.display = 'block';
  document.getElementById('budget-installments-warning').style.display = 'block';
  lucide.createIcons();
}
function closeBudgetModal() { document.getElementById('budget-modal-overlay').classList.add('hidden'); }

async function editBudget(id) {
  try {
    const res = await fetch(`/api/budgets/${id}`);
    const data = await res.json();
    editingBudgetId = id;
    document.getElementById('budget-modal-overlay').classList.remove('hidden');
    const form = document.getElementById('budget-form');
    form.reset();
    document.querySelector('#budget-form button[type="submit"]').textContent = 'Salvar Alterações';
    document.querySelector('#budget-modal-overlay h2').textContent = 'Editar Orçamento';
    document.getElementById('budget-installments-group').style.display = 'none'; // hide installments on edit
    document.getElementById('budget-installments-warning').style.display = 'none'; // hide warning on edit
    const catSelect = document.getElementById('budget-category-select');
    catSelect.innerHTML = categoriesCache.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

    form.categoryId.value = data.categoryId;
    form.department.value = data.department;
    form.amount.value = data.amount;
    form.month.value = data.month;
    form.year.value = data.year;
    lucide.createIcons();
  } catch (e) { console.error('Error fetching budget:', e); }
}

async function handleNewBudget(e) {
  e.preventDefault();
  const form = e.target;
  const totalAmount = parseFloat(form.amount.value);
  const installments = parseInt(form.installments.value) || 1;
  const startMonth = parseInt(form.month.value);
  const startYear = parseInt(form.year.value);
  const amountPerInstallment = Math.round((totalAmount / installments) * 100) / 100;

  try {
    if (editingBudgetId) {
      await fetch(`/api/budgets/${editingBudgetId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryId: form.categoryId.value,
          month: startMonth, year: startYear,
          amount: totalAmount,
          department: form.department.value
        })
      });
    } else {
      for (let i = 0; i < installments; i++) {
        // Calculate the absolute month offset from year zero
        const absoluteMonth = (startYear * 12) + (startMonth - 1) + i;
        const y = Math.floor(absoluteMonth / 12);
        const m = (absoluteMonth % 12) + 1;

        await fetch('/api/budgets', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            categoryId: form.categoryId.value,
            month: m, year: y,
            amount: amountPerInstallment,
            department: form.department.value
          })
        });
      }
    }
    closeBudgetModal();
    await loadForecast();
  } catch (err) { console.error('Erro ao salvar orçamento:', err); }
}

// ============================================
// MODAIS
// ============================================
let editingTransactionId = null;
function openModal() {
  editingTransactionId = null;
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('transaction-form').reset();
  
  const select = document.getElementById('modal-category-select');
  if (select) select.innerHTML = categoriesCache.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  
  document.querySelector('#transaction-form button[type="submit"]').textContent = 'Criar Lançamento';
  document.querySelector('#modal-overlay h2').textContent = 'Novo Lançamento';
  document.querySelector('input[name="date"]').value = new Date().toISOString().split('T')[0];
  lucide.createIcons();
}
function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); }

async function editTransaction(id) {
  try {
    const res = await fetch(`/api/transactions/${id}`);
    const data = await res.json();
    editingTransactionId = id;
    document.getElementById('modal-overlay').classList.remove('hidden');
    const form = document.getElementById('transaction-form');
    form.reset();
    
    // Repopular select antes de atribuir o valor
    const select = document.getElementById('modal-category-select');
    if (select) select.innerHTML = categoriesCache.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

    document.querySelector('#transaction-form button[type="submit"]').textContent = 'Salvar Alterações';
    document.querySelector('#modal-overlay h2').textContent = 'Editar Lançamento';
    form.description.value = data.description;
    form.value.value = Math.abs(data.value);
    form.date.value = data.date.split('T')[0];
    form.type.value = data.type;
    form.categoryId.value = data.categoryId;
    form.costCenter.value = data.costCenter || '';
    form.bank.value = data.bank || '';
    form.clientName.value = data.clientName || '';
    form.reference.value = data.reference || '';
    form.isReimbursement.checked = data.isReimbursement;
    lucide.createIcons();
  } catch (e) { console.error('Error fetching external transaction:', e); }
}

async function handleNewTransaction(e) {
  e.preventDefault();
  const form = e.target;
  const data = {
    description: form.description.value, value: parseFloat(form.value.value), date: form.date.value,
    type: form.type.value, categoryId: form.categoryId.value, costCenter: form.costCenter.value || null,
    bank: form.bank.value || null,
    clientName: form.clientName.value || null, reference: form.reference.value || null,
    isReimbursement: form.isReimbursement.checked
  };
  if (data.type === 'SAIDA' && data.value > 0) data.value = -data.value;
  try {
    const method = editingTransactionId ? 'PUT' : 'POST';
    const url = editingTransactionId ? `/api/transactions/${editingTransactionId}` : '/api/transactions';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (res.ok) { closeModal(); if (currentPage === 'cash-flow') await fetchCashFlowData(); else if (currentPage === 'dashboard') await loadDashboard(); }
  } catch (err) { console.error('Erro ao salvar transação:', err); }
}



function openFundConfigModal(currentMeta, currentPeriod) {
  const form = document.getElementById('fund-config-form');
  form.meta.value = currentMeta || 80000;
  form.period.value = currentPeriod || 'trimestre';
  document.getElementById('fund-config-modal-overlay').classList.remove('hidden');
}
function closeFundConfigModal() { document.getElementById('fund-config-modal-overlay').classList.add('hidden'); }
async function handleFundConfig(e) {
  e.preventDefault();
  const form = e.target;
  try {
    const res = await fetch('/api/config/tax-fund', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta: form.meta.value, period: form.period.value })
    });
    if (res.ok) { closeFundConfigModal(); loadTaxes(); }
    else alert('Erro ao salvar configuração do fundo');
  } catch (err) { console.error('Erro na requisição:', err); }
}

let editingProvisionId = null;
function openProvisionModal() {
  editingProvisionId = null;
  document.getElementById('provision-modal-overlay').classList.remove('hidden');
  document.getElementById('provision-form').reset();
  const now = new Date();
  document.querySelector('#provision-form input[name="competence"]').value = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  document.querySelector('#provision-form input[name="dueDate"]').value = new Date(now.getFullYear(), now.getMonth() + 1, 20).toISOString().split('T')[0];
  document.querySelector('#provision-form button[type="submit"]').textContent = 'Criar Provisão';
  document.querySelector('#provision-modal-overlay h2').textContent = 'Nova Provisão Fiscal';
  lucide.createIcons();
}
function closeProvisionModal() { document.getElementById('provision-modal-overlay').classList.add('hidden'); }

async function editProvision(id) {
  try {
    const res = await fetch(`/api/taxes/provision/${id}`);
    const data = await res.json();
    editingProvisionId = id;
    document.getElementById('provision-modal-overlay').classList.remove('hidden');
    const form = document.getElementById('provision-form');
    form.reset();
    document.querySelector('#provision-form button[type="submit"]').textContent = 'Salvar Alterações';
    document.querySelector('#provision-modal-overlay h2').textContent = 'Editar Provisão Fiscal';
    form.taxType.value = data.taxType;
    form.status.value = data.status;
    form.competence.value = data.competence;
    form.dueDate.value = data.dueDate.split('T')[0];
    form.value.value = Math.abs(data.value);
    lucide.createIcons();
  } catch (e) { console.error('Error fetching external provision:', e); }
}

async function handleNewProvision(e) {
  e.preventDefault();
  const form = e.target;
  const data = {
    taxType: form.taxType.value, competence: form.competence.value, dueDate: form.dueDate.value,
    value: parseFloat(form.value.value), status: form.status.value,
    baseValue: parseFloat(form.value.value), rate: 0
  };
  try {
    const method = editingProvisionId ? 'PUT' : 'POST';
    const url = editingProvisionId ? `/api/taxes/provision/${editingProvisionId}` : '/api/taxes/provision';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (res.ok) { closeProvisionModal(); if (currentPage === 'taxes') await loadTaxes(); }
  } catch (err) { console.error('Erro ao salvar provisão:', err); }
}

// ============================================
// MODAL: IMPORTAR EXCEL
// ============================================
function openImportModal() {
  document.getElementById('import-modal-overlay').classList.remove('hidden');
  document.getElementById('import-result').style.display = 'none';
  document.getElementById('import-file-input').value = '';
  lucide.createIcons();
}
function closeImportModal() {
  document.getElementById('import-modal-overlay').classList.add('hidden');
}

async function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const resultDiv = document.getElementById('import-result');
  const dropzone = document.getElementById('import-dropzone');

  // Show loading
  dropzone.innerHTML = '<div style="padding:20px"><i data-lucide="loader" style="width:32px;height:32px;color:var(--brand-gold);animation:spin 1s linear infinite"></i><p style="margin-top:12px;font-weight:600;color:var(--text-primary)">Importando dados...</p></div>';
  lucide.createIcons();

  try {
    const buffer = await file.arrayBuffer();
    const res = await fetch('/api/import/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buffer
    });
    const data = await res.json();

    if (data.success) {
      resultDiv.style.display = 'block';
      resultDiv.style.background = 'var(--accent-green-bg)';
      resultDiv.style.color = 'var(--accent-green)';
      resultDiv.innerHTML = `<strong>✅ Importação concluída!</strong><br>
        <span style="color:var(--text-secondary)">${data.imported} registros importados, ${data.skipped} ignorados de ${data.total} linhas total.</span>
        ${data.errors.length > 0 ? `<br><small style="color:var(--accent-orange)">⚠️ ${data.errors.join('<br>')}</small>` : ''}`;
    } else {
      resultDiv.style.display = 'block';
      resultDiv.style.background = 'var(--accent-red-bg)';
      resultDiv.style.color = 'var(--accent-red)';
      resultDiv.innerHTML = `<strong>❌ Erro:</strong> ${data.error}`;
    }
  } catch (err) {
    resultDiv.style.display = 'block';
    resultDiv.style.background = 'var(--accent-red-bg)';
    resultDiv.style.color = 'var(--accent-red)';
    resultDiv.innerHTML = `<strong>❌ Erro de conexão:</strong> ${err.message}`;
  }

  // Restore dropzone
  dropzone.innerHTML = `<i data-lucide="upload-cloud" style="width:40px;height:40px;color:var(--brand-gold);margin-bottom:12px"></i>
    <p style="font-weight:600;color:var(--text-primary);margin-bottom:4px">Arraste outro arquivo ou clique para selecionar</p>
    <p style="font-size:0.82rem;color:var(--text-muted)">Formatos aceitos: .xlsx (mesmo formato da exportação)</p>
    <input type="file" id="import-file-input" accept=".xlsx,.xls" style="display:none" onchange="handleImportFile(event)">`;
  lucide.createIcons();

  // Refresh current page data
  if (currentPage === 'cash-flow') await fetchCashFlowData();
  else if (currentPage === 'dashboard') await loadDashboard();
}

// ============================================
// CHAT IA
// ============================================
function toggleAIChat() {
  const panel = document.getElementById('ai-chat-panel');
  const overlay = document.getElementById('ai-chat-overlay');
  const fab = document.getElementById('ai-fab');
  const isHidden = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  overlay.classList.toggle('hidden');
  fab.style.display = isHidden ? 'none' : 'flex';
  lucide.createIcons();
}

function sendSuggestion(text) { document.getElementById('chat-input-field').value = text; sendChatMessage(); }

async function sendChatMessage() {
  const input = document.getElementById('chat-input-field');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  const suggestions = document.getElementById('chat-suggestions');
  if (suggestions) suggestions.style.display = 'none';
  const messagesDiv = document.getElementById('chat-messages');
  messagesDiv.innerHTML += `<div class="chat-message user"><div class="message-content">${escapeHtml(message)}</div></div>`;
  messagesDiv.innerHTML += `<div class="chat-message ai" id="typing-indicator"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  chatHistory.push({ role: 'user', content: message });
  try {
    const res = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, history: chatHistory.slice(-10) }) });
    const data = await res.json();
    document.getElementById('typing-indicator')?.remove();
    chatHistory.push({ role: 'assistant', content: data.reply });
    messagesDiv.innerHTML += `<div class="chat-message ai"><div class="message-content">${formatMarkdown(data.reply)}</div></div>`;
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  } catch (err) {
    document.getElementById('typing-indicator')?.remove();
    messagesDiv.innerHTML += `<div class="chat-message ai"><div class="message-content" style="color:var(--accent-red)">Erro ao se comunicar com a IA.</div></div>`;
  }
}

function escapeHtml(str) { return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function formatMarkdown(text) {
  return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code style="background:var(--bg-secondary);padding:2px 5px;border-radius:4px;font-size:0.82rem">$1</code>')
    .replace(/\n/g, '<br>');
}

// ============================================
// TEMAS
// ============================================
const themeLabels = { '': 'Claro', 'dark': 'Escuro', 'sepia': 'Sépia', 'midnight': 'Midnight' };

function setTheme(theme) {
  if (theme) {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  localStorage.setItem('lexfinance-theme', theme);
  const label = document.getElementById('current-theme-label');
  if (label) label.textContent = themeLabels[theme] || 'Claro';
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.theme === theme);
  });
  document.getElementById('theme-dropdown')?.classList.remove('open');
}

function toggleThemeDropdown() {
  const dd = document.getElementById('theme-dropdown');
  dd?.classList.toggle('open');
}

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.theme-dropdown-wrapper')) {
    document.getElementById('theme-dropdown')?.classList.remove('open');
  }
});

// Apply saved theme on load
(function () {
  const saved = localStorage.getItem('lexfinance-theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
    document.addEventListener('DOMContentLoaded', () => {
      const label = document.getElementById('current-theme-label');
      if (label) label.textContent = themeLabels[saved] || 'Claro';
      document.querySelectorAll('.theme-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.theme === saved);
      });
    });
  }
})();

// ============================================
// NOTIFICAÇÕES (SINO)
// ============================================
let notificationsData = [];
async function loadNotifications() {
  try {
    const res = await fetch('/api/notifications');
    const data = await res.json();
    notificationsData = data;
    renderNotifications();
  } catch (e) { console.error('Error fetching notifications API:', e) }
}

function renderNotifications() {
  const badge = document.getElementById('notification-badge');
  const list = document.getElementById('notification-list');
  const unreadCount = notificationsData.filter(n => !n.read).length;

  if (unreadCount > 0) {
    badge.textContent = unreadCount;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }

  if (notificationsData.length === 0) {
    list.innerHTML = `<div class="notif-empty">Boas notícias! Nenhuma obrigação pendente ou movimentação recente.</div>`;
    return;
  }

  list.innerHTML = notificationsData.map(n => `
    <div class="notif-item ${n.read ? 'read' : 'unread'}">
      <div class="notif-icon ${n.type}">
        ${n.type === 'danger' || n.type === 'warning' ? '<i data-lucide="alert-triangle"></i>' : (n.type === 'success' ? '<i data-lucide="arrow-up-right"></i>' : '<i data-lucide="arrow-down-right"></i>')}
      </div>
      <div class="notif-body">
        <strong>${n.title}</strong>
        <p>${n.message}</p>
        <span class="notif-time">${formatDate(n.date)}</span>
      </div>
    </div>
  `).join('');
  lucide.createIcons();
}

function toggleNotifications() {
  const dd = document.getElementById('notification-dropdown');
  dd?.classList.toggle('open');
}

function markAllNotificationsRead() {
  notificationsData.forEach(n => n.read = true);
  renderNotifications();
}

function clearAllNotifications() {
  notificationsData = [];
  renderNotifications();
}

// Fechar popup se clicar fora
document.addEventListener('click', (e) => {
  if (!e.target.closest('#notification-btn') && !e.target.closest('#notification-dropdown')) {
    document.getElementById('notification-dropdown')?.classList.remove('open');
  }
});

// Run on load
document.addEventListener('DOMContentLoaded', () => {
  loadNotifications();
  // Poll every 5 minutes
  setInterval(loadNotifications, 300000);
});

// ============================================
// GLOBAL SEARCH
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('global-search');
  if (searchInput) {
    searchInput.addEventListener('keyup', (e) => {
      const term = e.target.value.toLowerCase();
      const activePage = document.querySelector('.page.active');
      if (!activePage) return;

      const tbodies = activePage.querySelectorAll('tbody');
      tbodies.forEach(tbody => {
        const rows = tbody.querySelectorAll('tr');
        rows.forEach(row => {
          // Skip if it's a skeleton loading row
          if (row.querySelector('.skeleton') || row.querySelector('td[colspan]')) return;
          const text = row.textContent.toLowerCase();
          row.style.display = text.includes(term) ? '' : 'none';
        });
      });
    });
  }
});
