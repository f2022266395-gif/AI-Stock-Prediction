const API_BASE = '/api';
let currentUser = null;

// Synchronously restore session from localStorage to prevent flash of guest navbar
const cachedUserId = localStorage.getItem('user_id');
if (cachedUserId) {
    currentUser = {
        user_id: parseInt(cachedUserId),
        username: localStorage.getItem('username') || 'user',
        full_name: localStorage.getItem('full_name') || '',
        balance: parseFloat(localStorage.getItem('balance') || '0')
    };
}

let performanceChart = null;
let detailChart = null;
let marketOverviewChart = null;
let allocationChart = null;
let portPerfChart = null;
let dashAllocationChart = null;
let currentStock = null;
let currentViewedTicker = null;
let refreshInterval = null;
let tradeType = 'BUY';
let allStocks = [];
let allTransactions = [];
let marketCurrentPage = 1;
const marketItemsPerPage = 10;
let currentFilteredStocks = [];
let historyCurrentPage = 1;
const historyItemsPerPage = 10;
let currentFilteredTransactions = [];
let dashboardHoldings = [];
let currentView = 'home-view';
let dashOverviewPage = 1;
const dashOverviewItemsPerPage = 5;

// --- UI Components ---
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? 'check-circle' : 'alert-circle';
    toast.innerHTML = `
        <i data-lucide="${icon}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    lucide.createIcons();

    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- View Management ---
async function showView(viewId) {
    showAppLoader();
    currentView = viewId;
    
    // Save view history for seamless page refreshes (only protected/main dashboard views)
    if (viewId !== 'auth-login' && viewId !== 'auth-register' && viewId !== 'home-view') {
        localStorage.setItem('current_view', viewId);
    } else {
        localStorage.removeItem('current_view');
    }
    
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });
    
    const target = document.getElementById(viewId);
    if (target) {
        target.classList.add('active');
        try {
            if (viewId === 'dashboard-view') {
                await initDashboard();
            } else if (viewId === 'profile-view') {
                loadProfileData();
            } else if (viewId === 'markets-view') {
                await initMarkets();
            } else if (viewId === 'portfolio-view') {
                await initPortfolio();
            } else if (viewId === 'history-view') {
                await initHistory();
            } else if (viewId === 'leaderboard-view') {
                await initLeaderboard();
            }
        } catch (err) {
            console.error(`Error loading view ${viewId}:`, err);
        }
    }
    
    updateNavbar();
    setActiveTab(viewId);
    window.scrollTo(0, 0);
    
    // Small delay to ensure smooth transition
    setTimeout(hideAppLoader, 400);
}

function showAppLoader() {
    let loader = document.getElementById('app-loader');
    if (!loader) {
        // Re-create loader if it was removed
        const loaderHTML = `
            <div id="app-loader" class="app-loader">
                <div class="loader-content">
                    <div class="loader-logo"><i data-lucide="trending-up"></i></div>
                    <div class="loader-text">AI Stock<span>Prediction</span></div>
                    <div class="loader-bar"><div class="progress"></div></div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('afterbegin', loaderHTML);
        if (window.lucide) lucide.createIcons();
        loader = document.getElementById('app-loader');
    }
    loader.classList.remove('fade-out');
}

function hideAppLoader() {
    const loader = document.getElementById('app-loader');
    if (loader) {
        loader.classList.add('fade-out');
        // We don't remove it from DOM anymore, just keep it hidden for reuse
    }
}

function updateNavbar() {
    const guestNav = document.getElementById('guest-nav');
    const userNav = document.getElementById('user-nav');
    const mainTabs = document.getElementById('main-nav-tabs');
    
    // Determine if we should show user nav or guest nav
    if (currentUser) {
        guestNav.classList.add('hidden');
        userNav.classList.remove('hidden');
        
        // Show tabs only if NOT on the landing page
        if (currentView === 'home-view' || currentView === 'auth-login' || currentView === 'auth-register') {
            mainTabs.classList.add('hidden');
        } else {
            mainTabs.classList.remove('hidden');
        }
        
        // Update user info
        const initials = getInitials(currentUser.full_name || currentUser.username);
        document.getElementById('nav-user-initials').textContent = initials;
        document.getElementById('nav-user-full-name').textContent = currentUser.full_name || currentUser.username;
        
        const welcomeTitle = document.getElementById('dash-welcome');
        if (welcomeTitle) {
            const firstName = (currentUser.full_name || currentUser.username).split(' ')[0];
            welcomeTitle.textContent = `Welcome back, ${firstName}`;
        }
    } else {
        // Not logged in
        guestNav.classList.remove('hidden');
        userNav.classList.add('hidden');
        mainTabs.classList.add('hidden');
    }
}

function setActiveTab(viewId) {
    document.querySelectorAll('.tab-item').forEach(tab => {
        if (tab.getAttribute('data-tab') === viewId) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
}

function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
}

// --- Dashboard Logic ---
async function initDashboard() {
    try {
        await fetchMarketOverview();
        await fetchDashboardSummary();
        await fetchRecentTransactions();
        await fetchPortfolioData();
        
        renderMarketSnapshot();
        renderDashMixStats();
        renderDashAllocationChart();
        
        // Start live polling if not already started
        if (!refreshInterval) {
            refreshInterval = setInterval(refreshLiveData, 30000); // 30 seconds
        }
        renderPerformanceChart();
    } catch (error) {
        console.error("Error initializing dashboard:", error);
    }
}

async function refreshLiveData() {
    const indicator = document.getElementById('refresh-indicator');
    if (indicator) indicator.classList.add('spinning');
    
    try {
        await fetchMarketOverview();
        await fetchDashboardSummary();
        renderMarketSnapshot();
        renderDashAllocationChart();
        renderDashMixStats();
        
        // If we're looking at a specific stock, refresh it too
        if (currentViewedTicker && document.getElementById('stock-detail-view').classList.contains('active')) {
            await fetchStockDetailData(currentViewedTicker);
        }
    } catch (error) {
        console.error("Live refresh failed:", error);
    } finally {
        setTimeout(() => {
            if (indicator) indicator.classList.remove('spinning');
        }, 1000);
    }
}

async function fetchDashboardSummary() {
    const response = await fetch(`${API_BASE}/dashboard-summary/${currentUser.user_id}`);
    const data = await response.json();
    
    const balanceStr = `$${data.virtual_balance.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    document.getElementById('dash-widget-balance').textContent = balanceStr;
    document.getElementById('metric-balance').textContent = balanceStr;
    document.getElementById('metric-portfolio-value').textContent = `$${data.portfolio_value.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    
    const returnEl = document.getElementById('metric-return');
    const returnPctEl = document.getElementById('metric-return-pct');
    const isPos = data.total_return >= 0;
    
    returnEl.textContent = `${isPos ? '+' : '-'}$${Math.abs(data.total_return).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    returnEl.className = isPos ? 'green' : 'red';
    returnPctEl.textContent = `${isPos ? '+' : ''}${data.total_return_pct.toFixed(1)}%`;
    returnPctEl.className = `sub-label ${isPos ? 'green' : 'red'}`;
    
    document.getElementById('metric-trades').textContent = `${data.total_trades} Trades`;
}

async function fetchRecentTransactions() {
    const response = await fetch(`${API_BASE}/transactions/${currentUser.user_id}`);
    const trades = await response.json();
    const list = document.getElementById('trades-list');
    list.innerHTML = '';
    
    if (trades.length === 0) {
        list.innerHTML = '<p class="centered" style="color: var(--text-secondary); padding: 2rem;">No recent trades.</p>';
        return;
    }

    trades.slice(0, 5).forEach(trade => {
        const item = document.createElement('div');
        item.className = 'activity-item';
        item.innerHTML = `
            <div class="trade-type-badge ${trade.type.toLowerCase()}">${trade.type}</div>
            <div class="trade-info">
                <h4>${trade.symbol}</h4>
                <p>${trade.timestamp}</p>
            </div>
            <div class="trade-value">
                <span class="amount">$${trade.total.toLocaleString()}</span>
                <span class="size">${trade.quantity} @ $${trade.price}</span>
            </div>
        `;
        list.appendChild(item);
    });
}

async function fetchPortfolioData() {
    const response = await fetch(`${API_BASE}/portfolio/${currentUser.user_id}`);
    const holdings = await response.json();
    dashboardHoldings = holdings;
    const body = document.getElementById('holdings-table-body');
    const emptyState = document.getElementById('holdings-empty-state');
    body.innerHTML = '';

    if (holdings.length === 0) {
        body.style.display = 'none';
        if (emptyState) emptyState.style.display = 'flex';
        return;
    }

    body.style.display = '';
    if (emptyState) emptyState.style.display = 'none';

    holdings.forEach(h => {
        const totalValue = h.quantity * h.current_price;
        const profit = (h.current_price - h.avg_price) * h.quantity;
        const profitPct = ((h.current_price - h.avg_price) / h.avg_price) * 100;
        const isPos = profit > 0;
        const isZero = profit === 0;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="symbol-cell">${h.symbol}</td>
            <td>${h.quantity}</td>
            <td>$${h.avg_price.toFixed(2)}</td>
            <td class="price-cell">$${h.current_price.toFixed(2)}</td>
            <td class="gain-cell ${isZero ? 'grey' : (isPos ? 'green' : 'red')}">
                ${isZero ? '$0.00 (0.0%)' : (isPos ? '+' : '') + '$' + profit.toFixed(2) + ' (' + (isPos ? '+' : '') + profitPct.toFixed(1) + '%)'}
            </td>
        `;
        body.appendChild(row);
    });
}

async function fetchMarketOverview() {
    const response = await fetch(`${API_BASE}/stocks`);
    allStocks = await response.json();
    dashOverviewPage = 1;
    document.getElementById('market-update-time').textContent = new Date().toLocaleTimeString();
    updateDashMarketSummary();
    renderDashboardMarketOverview();
}

function renderDashboardMarketOverview() {
    const body = document.getElementById('dash-market-list');
    body.innerHTML = '';

    const totalItems = allStocks.length;
    const startIndex = (dashOverviewPage - 1) * dashOverviewItemsPerPage;
    const endIndex = Math.min(startIndex + dashOverviewItemsPerPage, totalItems);
    const paginatedStocks = allStocks.slice(startIndex, endIndex);

    const maxAbsChange = Math.max(...paginatedStocks.map(s => Math.abs(s.change_pct)), 0.01);

    paginatedStocks.forEach((s, i) => {
        const isPositive = s.change > 0;
        const isNegative = s.change < 0;
        const isZero = s.change === 0;
        const dirClass = isPositive ? 'up' : (isNegative ? 'down' : 'flat');
        const sign = isPositive ? '+' : (isNegative ? '' : '');
        const arrow = isZero ? '—' : (isPositive ? '▲' : '▼');
        const barPct = Math.min(Math.abs(s.change_pct) / maxAbsChange * 100, 100);

        const item = document.createElement('div');
        item.className = `dash-market-item ${dirClass}`;
        item.style.animationDelay = `${i * 0.05}s`;
        item.onclick = () => {
            currentStockSymbol = s.symbol;
            document.getElementById('detail-ticker').textContent = s.symbol;
            showView('markets-view');
            loadStockDetail(s.symbol);
        };

        const changePct = isZero ? '0.00%' : sign + s.change_pct.toFixed(2) + '%';
        const changeDollar = isZero ? '$0.00' : sign + '$' + s.change.toFixed(2);

        item.innerHTML = `
            <div class="dash-market-item-inner">
                <span class="dash-market-ticker ${dirClass}">${s.symbol}</span>
                <div class="dash-market-info">
                    <div class="name">${s.name}</div>
                    <div class="sub">
                        <span class="sector-tag">${s.sector || 'N/A'}</span>
                        <span class="change-row">${arrow} ${changeDollar}</span>
                    </div>
                </div>
                <div class="dash-market-right">
                    <div class="price-row">
                        <span class="price">$${s.price.toFixed(2)}</span>
                        <span class="change-pill ${dirClass}">${changePct}</span>
                    </div>
                    <div class="dash-market-bar"><div class="fill ${dirClass}" style="width:${barPct.toFixed(0)}%"></div></div>
                </div>
            </div>
        `;
        body.appendChild(item);
    });

    renderDashboardMarketPagination(totalItems);
}

function updateDashMarketSummary() {
    const advancers = allStocks.filter(s => s.change > 0).length;
    const decliners = allStocks.filter(s => s.change < 0).length;
    const unchanged = allStocks.filter(s => s.change === 0).length;
    const total = allStocks.length;
    document.getElementById('dash-advancers').textContent = advancers;
    document.getElementById('dash-decliners').textContent = decliners;
    document.getElementById('dash-unchanged').textContent = unchanged;
    document.getElementById('dash-total-stocks').textContent = total;
}

function renderDashboardMarketPagination(totalItems) {
    const pageNumbersContainer = document.getElementById('dash-market-page-numbers');
    const prevBtn = document.getElementById('dash-market-prev-btn');
    const nextBtn = document.getElementById('dash-market-next-btn');
    const pageInfo = document.getElementById('dash-market-page-info');

    const totalPages = Math.ceil(totalItems / dashOverviewItemsPerPage);

    const startIndex = totalItems > 0 ? (dashOverviewPage - 1) * dashOverviewItemsPerPage + 1 : 0;
    const endIndex = Math.min(dashOverviewPage * dashOverviewItemsPerPage, totalItems);
    pageInfo.textContent = `Showing ${startIndex}-${endIndex} of ${totalItems}`;

    prevBtn.disabled = dashOverviewPage === 1;
    nextBtn.disabled = dashOverviewPage === totalPages || totalPages === 0;

    prevBtn.onclick = () => {
        if (dashOverviewPage > 1) {
            dashOverviewPage--;
            renderDashboardMarketOverview();
        }
    };

    nextBtn.onclick = () => {
        if (dashOverviewPage < totalPages) {
            dashOverviewPage++;
            renderDashboardMarketOverview();
        }
    };

    pageNumbersContainer.innerHTML = '';

    if (totalPages <= 1) {
        if (totalPages === 1) {
            const pageNum = document.createElement('span');
            pageNum.className = 'page-num active';
            pageNum.textContent = '1';
            pageNumbersContainer.appendChild(pageNum);
        }
        return;
    }

    for (let i = 1; i <= totalPages; i++) {
        const pageNum = document.createElement('span');
        pageNum.className = `page-num ${i === dashOverviewPage ? 'active' : ''}`;
        pageNum.textContent = i;
        pageNum.onclick = () => {
            dashOverviewPage = i;
            renderDashboardMarketOverview();
        };
        pageNumbersContainer.appendChild(pageNum);
    }
}

let dashboardDays = 180;

function renderPerformanceChart(days) {
    days = days || dashboardDays || 180;
    const ctx = document.getElementById('performanceChart').getContext('2d');
    
    if (performanceChart) performanceChart.destroy();

    const labels = [];
    const dataPoints = [];
    let val = 10000;
    const now = new Date();
    const step = Math.max(1, Math.floor(180 / days));
    for (let i = 180; i >= 0; i -= step) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        val = val * (1 + (Math.random() * 0.03 - 0.01));
        dataPoints.push(Math.round(val * 100) / 100);
    }

    performanceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Portfolio Value',
                data: dataPoints,
                borderColor: '#2563eb',
                borderWidth: 3,
                pointRadius: 0,
                pointHoverRadius: 6,
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: '#ffffff',
                    titleColor: '#64748b',
                    bodyColor: '#1e293b',
                    borderColor: 'rgba(0,0,0,0.1)',
                    borderWidth: 1,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return '$' + context.parsed.y.toLocaleString();
                        }
                    }
                }
            },
            scales: {
                y: {
                    grid: { color: 'rgba(0, 0, 0, 0.06)', drawBorder: false },
                    ticks: {
                        color: '#64748b',
                        callback: value => '$' + (value / 1000) + 'k'
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#64748b' }
                }
            }
        }
    });
}

function switchDashboardRange(days, el) {
    el.parentElement.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    dashboardDays = days;
    renderPerformanceChart(days);
}

function renderMarketSnapshot() {
    if (!allStocks || allStocks.length === 0) return;

    const sorted = [...allStocks].sort((a, b) => b.change_pct - a.change_pct);
    const gainer = sorted[0];
    const loser = sorted[sorted.length - 1];

    document.getElementById('dash-top-gainer').textContent = gainer ? gainer.symbol : '---';
    document.getElementById('dash-top-gainer-pct').textContent = gainer ? `+${gainer.change_pct.toFixed(2)}%` : '---';

    document.getElementById('dash-top-loser').textContent = loser ? loser.symbol : '---';
    document.getElementById('dash-top-loser-pct').textContent = loser ? `${loser.change_pct.toFixed(2)}%` : '---';

    const advancers = allStocks.filter(s => s.change > 0).length;
    const decliners = allStocks.filter(s => s.change < 0).length;
    document.getElementById('dash-market-breadth').textContent = `${advancers}/${decliners}`;
    document.getElementById('dash-market-breadth-detail').textContent = `Advancers / Decliners`;
}

function renderDashMixStats() {
    const holdings = dashboardHoldings;
    if (!holdings || holdings.length === 0) {
        document.getElementById('dash-mix-invested').textContent = '$0.00';
        document.getElementById('dash-mix-best').textContent = '---';
        document.getElementById('dash-mix-worst').textContent = '---';
        document.getElementById('dash-mix-positions').textContent = '0';
        return;
    }

    let totalInvested = 0;
    let best = holdings[0];
    let worst = holdings[0];

    holdings.forEach(h => {
        totalInvested += h.quantity * h.avg_price;
        const pnl = (h.current_price - h.avg_price) / h.avg_price;
        if (pnl > (best.current_price - best.avg_price) / best.avg_price) best = h;
        if (pnl < (worst.current_price - worst.avg_price) / worst.avg_price) worst = h;
    });

    document.getElementById('dash-mix-invested').textContent = `$${totalInvested.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    document.getElementById('dash-mix-best').textContent = best.symbol;
    document.getElementById('dash-mix-worst').textContent = worst.symbol;
    document.getElementById('dash-mix-positions').textContent = holdings.length;
}

function renderDashAllocationChart() {
    const ctx = document.getElementById('dashAllocationChart').getContext('2d');
    if (dashAllocationChart) dashAllocationChart.destroy();

    const holdings = dashboardHoldings || [];

    if (holdings.length === 0) {
        dashAllocationChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['No Holdings'],
                datasets: [{
                    data: [1],
                    backgroundColor: ['rgba(0,0,0,0.06)'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '75%',
                plugins: { legend: { display: false } }
            }
        });
        return;
    }

    const colors = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#0891b2', '#84cc16', '#14b8a6', '#f97316'];
    dashAllocationChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: holdings.map(h => h.symbol),
            datasets: [{
                data: holdings.map(h => h.quantity * h.current_price),
                backgroundColor: colors.slice(0, holdings.length),
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '72%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#64748b',
                        usePointStyle: true,
                        padding: 12,
                        font: { size: 10 }
                    }
                }
            }
        }
    });
}

// --- Markets & Trading Logic ---
async function initMarkets() {
    try {
        const response = await fetch(`${API_BASE}/stocks`);
        allStocks = await response.json();
        currentFilteredStocks = [...allStocks];
        marketCurrentPage = 1;
        renderMarketMetrics();
        renderMarketOverviewChart();
        renderMarketCards();
    } catch (error) {
        console.error("Error loading markets:", error);
    }
}

function renderMarketMetrics() {
    const stocks = allStocks;
    if (stocks.length === 0) return;

    document.getElementById('market-total-stocks').textContent = stocks.length;

    let totalCap = 0;
    let advancers = 0;
    let decliners = 0;
    stocks.forEach(s => {
        totalCap += s.price;
        if (s.change > 0) advancers++;
        else if (s.change < 0) decliners++;
    });

    const advPct = (advancers / stocks.length * 100);
    const decPct = (decliners / stocks.length * 100);

    document.getElementById('market-total-cap').textContent = `$${totalCap.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}`;
    document.getElementById('market-total-cap-sub').textContent = `${stocks.length} companies`;

    document.getElementById('market-advancers').textContent = advancers;
    document.getElementById('market-advancers-pct').textContent = `+${advPct.toFixed(1)}%`;

    document.getElementById('market-decliners').textContent = decliners;
    document.getElementById('market-decliners-pct').textContent = `${decPct.toFixed(1)}%`;

    document.getElementById('market-chart-update-time').textContent = new Date().toLocaleTimeString();
}

function renderMarketCards() {
    const grid = document.getElementById('stock-cards-grid');
    const countEl = document.getElementById('market-results-count');
    grid.innerHTML = '';

    const stocks = currentFilteredStocks;
    countEl.textContent = `${stocks.length} Stocks`;

    const startIndex = (marketCurrentPage - 1) * marketItemsPerPage;
    const endIndex = Math.min(startIndex + marketItemsPerPage, stocks.length);
    const paginatedStocks = stocks.slice(startIndex, endIndex);

    paginatedStocks.forEach((s) => {
        const isPositive = s.change > 0;
        const isZero = s.change === 0;
        const sign = isPositive ? '+' : '';
        const dirClass = isPositive ? 'up' : (isZero ? '' : 'down');

        // Simple mini sparkline using ASCII-ish bars
        const sparkBars = generateSparkBars(s);

        const card = document.createElement('div');
        card.className = `stock-card`;
        card.onclick = () => viewStockDetail(s.symbol);
        card.innerHTML = `
            <div class="stock-card-header">
                <div>
                    <div class="stock-card-name">${s.name}</div>
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.25rem;">
                        <span class="stock-card-ticker">${s.symbol}</span>
                        <span class="stock-card-sector">${s.sector}</span>
                    </div>
                </div>
                <span class="stock-card-change ${dirClass}">${sign}${s.change_pct.toFixed(2)}%</span>
            </div>
            <div class="stock-card-body">
                <div class="stock-card-price-section">
                    <div class="stock-card-price">$${s.price.toFixed(2)}</div>
                    <div class="stock-card-volume">Vol: ${s.volume}</div>
                </div>
                <div class="stock-card-change-section">
                    <div class="stock-card-change-pct ${dirClass}">${sign}$${s.change.toFixed(2)}</div>
                    <div class="stock-card-mini-chart">${sparkBars}</div>
                </div>
            </div>
            <div class="stock-card-footer">
                <div class="stock-card-indicators">
                    <span class="stock-card-indicator">O <span>$${s.open ? s.open.toFixed(2) : s.price.toFixed(2)}</span></span>
                    <span class="stock-card-indicator">H <span>$${s.high ? s.high.toFixed(2) : (s.price * (1 + Math.abs(s.change_pct/100))).toFixed(2)}</span></span>
                    <span class="stock-card-indicator">L <span>$${s.low ? s.low.toFixed(2) : (s.price * (1 - Math.abs(s.change_pct/100))).toFixed(2)}</span></span>
                </div>
                <button class="btn btn-outline small stock-card-action" onclick="event.stopPropagation(); viewStockDetail('${s.symbol}')">View</button>
            </div>
        `;
        grid.appendChild(card);
    });

    renderPagination(stocks.length);
}

function generateSparkBars(s) {
    const isPos = s.change >= 0;
    const bars = [];
    const baseHeight = 8;
    const maxExtra = 28;
    for (let i = 0; i < 10; i++) {
        const h = baseHeight + Math.random() * maxExtra;
        const color = isPos ? '#059669' : '#dc2626';
        const opacity = 0.3 + (i / 10) * 0.7;
        bars.push(`<div style="width:6px;height:${h.toFixed(0)}px;background:${color};opacity:${opacity.toFixed(2)};border-radius:3px;display:inline-block;margin:0 1px;vertical-align:bottom;"></div>`);
    }
    return bars.join('');
}

function renderMarketOverviewChart() {
    const ctx = document.getElementById('marketOverviewChart').getContext('2d');
    if (marketOverviewChart) marketOverviewChart.destroy();

    if (!allStocks || allStocks.length === 0) return;

    const labels = [];
    const priceData = [];
    const changeData = [];

    const topStocks = allStocks.slice(0, 12);
    topStocks.forEach(s => {
        labels.push(s.symbol);
        priceData.push(s.price);
        changeData.push(s.change_pct);
    });

    marketOverviewChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Price',
                    data: priceData,
                    backgroundColor: '#2563eb',
                    borderRadius: 4,
                    yAxisID: 'y',
                    order: 2
                },
                {
                    label: 'Change %',
                    data: changeData,
                    type: 'line',
                    borderColor: '#059669',
                    backgroundColor: 'rgba(5, 150, 105, 0.1)',
                    pointBackgroundColor: changeData.map(v => v >= 0 ? '#059669' : '#dc2626'),
                    pointRadius: 4,
                    borderWidth: 2,
                    tension: 0.3,
                    fill: true,
                    yAxisID: 'y1',
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: '#64748b',
                        usePointStyle: true,
                        boxWidth: 8,
                        padding: 15,
                        font: { size: 11 }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: '#ffffff',
                    titleColor: '#64748b',
                    bodyColor: '#1e293b',
                    borderColor: 'rgba(0,0,0,0.1)',
                    borderWidth: 1,
                    displayColors: true
                }
            },
            scales: {
                y: {
                    position: 'left',
                    grid: { color: 'rgba(0, 0, 0, 0.06)', drawBorder: false },
                    ticks: {
                        color: '#64748b',
                        font: { size: 10 },
                        callback: value => '$' + value.toFixed(0)
                    }
                },
                y1: {
                    position: 'right',
                    grid: { display: false },
                    ticks: {
                        color: '#64748b',
                        font: { size: 10 },
                        callback: value => value.toFixed(1) + '%'
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#64748b', font: { size: 10 } }
                }
            }
        }
    });
}

function renderPagination(totalItems) {
    const pageNumbersContainer = document.getElementById('market-page-numbers');
    const prevBtn = document.getElementById('market-prev-btn');
    const nextBtn = document.getElementById('market-next-btn');
    const pageInfo = document.getElementById('market-page-info');
    
    const totalPages = Math.ceil(totalItems / marketItemsPerPage);
    
    // Update showing text
    const startIndex = totalItems > 0 ? (marketCurrentPage - 1) * marketItemsPerPage + 1 : 0;
    const endIndex = Math.min(marketCurrentPage * marketItemsPerPage, totalItems);
    pageInfo.textContent = `Showing ${startIndex}-${endIndex} of ${totalItems}`;
    
    // Update Previous/Next button states
    prevBtn.disabled = marketCurrentPage === 1;
    nextBtn.disabled = marketCurrentPage === totalPages || totalPages === 0;

    prevBtn.onclick = () => {
        if (marketCurrentPage > 1) {
            marketCurrentPage--;
            renderMarketCards();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    nextBtn.onclick = () => {
        if (marketCurrentPage < totalPages) {
            marketCurrentPage++;
            renderMarketCards();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    pageNumbersContainer.innerHTML = '';
    
    if (totalPages <= 1) {
        if (totalPages === 1) {
            const pageNum = document.createElement('span');
            pageNum.className = 'page-num active';
            pageNum.textContent = '1';
            pageNumbersContainer.appendChild(pageNum);
        }
        return;
    }

    for (let i = 1; i <= totalPages; i++) {
        const pageNum = document.createElement('span');
        pageNum.className = `page-num ${i === marketCurrentPage ? 'active' : ''}`;
        pageNum.textContent = i;
        pageNum.onclick = () => {
            marketCurrentPage = i;
            renderMarketCards();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };
        pageNumbersContainer.appendChild(pageNum);
    }
}



let detailTimeRange = 30;

async function viewStockDetail(ticker) {
    currentViewedTicker = ticker;
    detailTimeRange = 30;
    showView('stock-detail-view');
    await fetchStockDetailData(ticker, detailTimeRange);
}

async function switchDetailRange(range, el) {
    el.parentElement.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    detailTimeRange = range;
    await fetchStockDetailData(currentViewedTicker, range);
}

async function fetchStockDetailData(ticker, range) {
    range = range || 30;
    try {
        const response = await fetch(`${API_BASE}/predict/${ticker}?user_id=${currentUser.user_id}&range=${range}`);
        const data = await response.json();
        currentStock = data;
        
        // Populate UI
        document.getElementById('detail-company-name').textContent = data.name;
        document.getElementById('detail-ticker').textContent = data.symbol;
        document.getElementById('detail-sector').textContent = data.sector;
        document.getElementById('detail-price').textContent = `$${data.price.toFixed(2)}`;
        document.getElementById('detail-last-updated').textContent = `Last Updated: ${new Date().toLocaleTimeString()}`;
        
        const changeTxt = document.getElementById('detail-change');
        const changePctTxt = document.getElementById('detail-change-pct');
        const isPositive = data.change >= 0;
        
        changeTxt.textContent = `${isPositive ? '+' : ''}$${data.change.toFixed(2)}`;
        changePctTxt.textContent = `(${isPositive ? '+' : ''}${data.change_pct.toFixed(2)}%)`;
        changeTxt.className = isPositive ? 'green' : 'red';
        changePctTxt.className = isPositive ? 'green' : 'red';

        // Signal (use holding-aware `action` when available, fall back to `recommendation`)
        const banner = document.getElementById('detail-signal-banner');
        const action = data.action || data.recommendation || 'HOLD';
        const changePct = data.predicted_change_pct ?? 0;
        const rsiValue = data.rsi ?? 0;
        const macdValue = data.macd_signal ?? 0;

        let changeText = 'AI projects stable/sideways movement over the next 5 days.';
        if (changePct > 0.2) {
            changeText = `AI projects positive growth (+${changePct.toFixed(1)}%) over the next 5 days.`;
        } else if (changePct < -0.2) {
            changeText = `AI projects a downward correction (${changePct.toFixed(1)}%) over the next 5 days.`;
        }

        let momentumText = 'Steady & Neutral';
        if (rsiValue > 70) {
            momentumText = 'Overheated (High Selling Pressure)';
        } else if (rsiValue < 30) {
            momentumText = 'Oversold (Great Buying Opportunity)';
        } else if (rsiValue >= 55) {
            momentumText = 'Moderately Strong Momentum';
        } else if (rsiValue < 45) {
            momentumText = 'Moderately Weak Momentum';
        }

        const trendText = macdValue >= 0 ? 'Upward Strength' : 'Downward Correction';
        const bannerText = `${action} SIGNAL — ${changeText} Market Momentum: ${momentumText} | Trend Direction: ${trendText}`;

        if (action === 'BUY') {
            banner.className = 'signal-banner buy';
        } else if (action === 'SELL') {
            banner.className = 'signal-banner sell';
        } else {
            banner.className = 'signal-banner';
        }
        document.getElementById('detail-signal-text').textContent = bannerText;

        // Prediction Panel
        document.getElementById('detail-recommendation').textContent = action;
        const suggestedQty = data.suggested_qty !== undefined ? data.suggested_qty : (data.suggested_shares !== undefined ? data.suggested_shares : 0);
        document.getElementById('detail-suggested-shares').textContent = suggestedQty;
        document.getElementById('detail-confidence').textContent = (data.confidence !== undefined ? `${data.confidence}%` : '—');
        document.getElementById('detail-reason').textContent = (data.reason || '—');
        document.getElementById('detail-predicted-price').textContent = `$${data.predicted_price_5d.toFixed(2)}`;

        // Stats & Indicators
        document.getElementById('ind-sma20').textContent = `$${data.indicators.sma20}`;
        document.getElementById('ind-sma50').textContent = `$${data.indicators.sma50}`;
        document.getElementById('ind-rsi').textContent = data.indicators.rsi;
        document.getElementById('ind-volatility').textContent = data.indicators.volatility;
        
        document.getElementById('stat-52h').textContent = `$${data['52w_high']}`;
        document.getElementById('stat-52l').textContent = `$${data['52w_low']}`;
        document.getElementById('stat-avg-vol').textContent = data.volume;
        document.getElementById('stat-sector').textContent = data.sector;

        // Trade Side
        document.getElementById('trade-stock-name').textContent = data.name;
        document.getElementById('trade-stock-price').textContent = `$${data.price.toFixed(2)}`;
        document.getElementById('trade-available-balance').textContent = `$${currentUser.balance.toLocaleString()}`;
        
        setTradeType('BUY'); // Reset to buy
        document.getElementById('trade-quantity').value = '';
        updateEstimate();

        showView('stock-detail-view');
        renderDetailChart(data.history, data.forecast_series);
        lucide.createIcons();
    } catch (error) {
        console.error("Error loading stock detail:", error);
    }
}

function renderDetailChart(history, forecastSeries = []) {
    const ctx = document.getElementById('detail-history-chart').getContext('2d');
    if (detailChart) detailChart.destroy();

    const labels = history.map(h => h.date);
    const priceData = history.map(h => h.price);
    const forecastLabels = [];
    const forecastData = [];

    if (forecastSeries && forecastSeries.length > 0) {
        const lastDate = new Date(labels[labels.length - 1]);
        for (let i = 1; i <= forecastSeries.length; i++) {
            const nextDate = new Date(lastDate);
            nextDate.setDate(nextDate.getDate() + i);
            forecastLabels.push(nextDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
            forecastData.push(forecastSeries[i - 1]);
        }
    }

    detailChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [...labels, ...forecastLabels],
            datasets: [{
                label: 'Price',
                data: [...priceData, ...Array(forecastLabels.length).fill(null)],
                borderColor: '#2563eb',
                borderWidth: 3,
                pointRadius: 2,
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                fill: true,
                tension: 0.3
            }, {
                label: 'Forecast',
                data: [...Array(priceData.length).fill(null), ...forecastData],
                borderColor: '#f59e0b',
                borderWidth: 2,
                pointRadius: 0,
                borderDash: [8, 6],
                fill: false,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: 'rgba(0, 0, 0, 0.06)' }, ticks: { color: '#64748b' } },
                x: { grid: { display: false }, ticks: { color: '#64748b' } }
            }
        }
    });
}

function setTradeType(type) {
    tradeType = type;
    const buyBtn = document.getElementById('toggle-buy');
    const sellBtn = document.getElementById('toggle-sell');
    const confirmBtn = document.getElementById('confirm-trade-btn');

    if (type === 'BUY') {
        buyBtn.classList.add('active');
        sellBtn.classList.remove('active');
        confirmBtn.className = 'btn btn-primary full large';
        confirmBtn.textContent = 'Confirm BUY';
    } else {
        sellBtn.classList.add('active');
        buyBtn.classList.remove('active');
        confirmBtn.className = 'btn btn-danger full large';
        confirmBtn.textContent = 'Confirm SELL';
    }
    updateEstimate();
}

function updateEstimate() {
    const qty = parseInt(document.getElementById('trade-quantity').value) || 0;
    const estimateEl = document.getElementById('trade-estimate');
    if (currentStock) {
        const total = qty * currentStock.price;
        estimateEl.textContent = `$${total.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    }
}

async function confirmTrade() {
    const qty = parseInt(document.getElementById('trade-quantity').value);
    if (!qty || qty <= 0) {
        showToast('Please enter a valid quantity', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/trade`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: currentUser.user_id,
                ticker: currentStock.symbol,
                trade_type: tradeType,
                quantity: qty
            })
        });
        
        const data = await response.json();
        if (response.ok) {
            showToast(data.message);
            currentUser.balance = data.new_balance;
            document.getElementById('trade-available-balance').textContent = `$${currentUser.balance.toLocaleString()}`;
            document.getElementById('trade-quantity').value = '';
            updateEstimate();
            initDashboard(); // Refresh dashboard in background
        } else {
            showToast(data.error || 'Trade failed', 'error');
        }
    } catch (error) {
        showToast('Connection error', 'error');
    }
}

// --- Portfolio Logic ---
async function initPortfolio() {
    if (!currentUser) return;
    
    try {
        const [summRes, portRes, transRes] = await Promise.all([
            fetch(`${API_BASE}/dashboard-summary/${currentUser.user_id}`),
            fetch(`${API_BASE}/portfolio/${currentUser.user_id}`),
            fetch(`${API_BASE}/transactions/${currentUser.user_id}`)
        ]);
        
        const summary = await summRes.json();
        const holdings = await portRes.json();
        const transactions = await transRes.json();
        
        // Populate Metrics
        document.getElementById('port-total-value').textContent = `$${summary.portfolio_value.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        document.getElementById('port-cash').textContent = `$${summary.virtual_balance.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        
        const retEl = document.getElementById('port-return');
        const retPctEl = document.getElementById('port-return-pct');
        const isPos = summary.total_return >= 0;
        retEl.textContent = `${isPos ? '+' : '-'}$${Math.abs(summary.total_return).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        retEl.className = isPos ? 'green' : 'red';
        retPctEl.textContent = `${isPos ? '+' : ''}${summary.total_return_pct.toFixed(2)}%`;
        retPctEl.className = `sub-label ${isPos ? 'green' : 'red'}`;

        renderAllocationChart(holdings);
        renderPortfolioPerformance();
        renderPortfolioTable(holdings);

        const emptyEl = document.getElementById('port-empty');
        const tableCard = document.querySelector('#portfolio-view .table-card');
        if (holdings.length === 0) {
            if (emptyEl) emptyEl.style.display = 'flex';
            if (tableCard) tableCard.style.display = 'none';
        } else {
            if (emptyEl) emptyEl.style.display = 'none';
            if (tableCard) tableCard.style.display = '';
        }

        renderPortfolioStats(holdings, transactions, summary);
    } catch (e) {
        console.error("Portfolio load error:", e);
    }
}

function renderPortfolioStats(holdings, transactions, summary) {
    const healthEl = document.getElementById('port-health');
    if (holdings.length === 0) {
        healthEl.textContent = 'No Holdings';
        document.getElementById('port-diversity').textContent = '0 Stocks';
        document.getElementById('port-diversity-sectors').textContent = '0 Sectors';
        document.getElementById('port-win-rate').textContent = '--';
        document.getElementById('port-best-trade').textContent = '--';
        document.getElementById('port-worst-trade').textContent = '--';
        document.getElementById('port-avg-return').textContent = '--';
        document.getElementById('port-day-change').textContent = '--';
        return;
    }

    document.getElementById('port-diversity').textContent = `${holdings.length} Stocks`;
    const sectors = new Set(holdings.map(h => h.sector).filter(Boolean));
    document.getElementById('port-diversity-sectors').textContent = `${sectors.size} Sectors`;

    const returnPct = summary.total_return_pct || 0;
    if (returnPct > 5) healthEl.textContent = 'Excellent';
    else if (returnPct > 0) healthEl.textContent = 'Good';
    else if (returnPct > -5) healthEl.textContent = 'Fair';
    else healthEl.textContent = 'At Risk';
    healthEl.style.color = returnPct >= 0 ? 'var(--success)' : 'var(--danger)';

    const sellTrades = transactions.filter(t => t.type === 'SELL' && t.gain_loss != null);
    const wins = sellTrades.filter(t => t.gain_loss > 0).length;
    document.getElementById('port-win-rate').textContent = sellTrades.length > 0 ? `${(wins / sellTrades.length * 100).toFixed(0)}%` : '--';

    if (sellTrades.length > 0) {
        const best = Math.max(...sellTrades.map(t => t.gain_loss));
        const worst = Math.min(...sellTrades.map(t => t.gain_loss));
        document.getElementById('port-best-trade').textContent = `+$${best.toFixed(2)}`;
        document.getElementById('port-worst-trade').textContent = `$${worst.toFixed(2)}`;
        const avg = sellTrades.reduce((s, t) => s + t.gain_loss, 0) / sellTrades.length;
        document.getElementById('port-avg-return').textContent = `${avg >= 0 ? '+' : ''}$${avg.toFixed(2)}`;
    } else {
        document.getElementById('port-best-trade').textContent = '--';
        document.getElementById('port-worst-trade').textContent = '--';
        document.getElementById('port-avg-return').textContent = '--';
    }

    const totalChange = holdings.reduce((s, h) => s + (h.current_price - h.avg_price) * h.quantity, 0);
    const dayChangeEl = document.getElementById('port-day-change');
    dayChangeEl.textContent = `${totalChange >= 0 ? '+' : ''}$${totalChange.toFixed(2)}`;
    dayChangeEl.className = `value ${totalChange >= 0 ? 'green' : 'red'}`;
}

function renderAllocationChart(holdings) {
    const ctx = document.getElementById('allocationChart').getContext('2d');
    if (allocationChart) allocationChart.destroy();

    const colors = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#0891b2', '#84cc16', '#14b8a6', '#f97316'];

    if (holdings.length === 0) {
        allocationChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['No Holdings'],
                datasets: [{
                    data: [1],
                    backgroundColor: ['rgba(0,0,0,0.06)'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '72%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#64748b', usePointStyle: true, padding: 20 }
                    }
                }
            }
        });
        return;
    }

    allocationChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: holdings.map(h => h.symbol),
            datasets: [{
                data: holdings.map(h => h.quantity * h.current_price),
                backgroundColor: colors.slice(0, holdings.length),
                borderWidth: 2,
                borderColor: '#ffffff',
                hoverOffset: 12
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: { position: 'bottom', labels: { color: '#64748b', usePointStyle: true, padding: 20, font: { size: 11 } } },
                tooltip: {
                    backgroundColor: '#ffffff',
                    titleColor: '#64748b',
                    bodyColor: '#1e293b',
                    borderColor: 'rgba(0,0,0,0.1)',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = ((context.parsed / total) * 100).toFixed(1);
                            return ` ${context.label}: $${context.parsed.toLocaleString()} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

let portfolioDays = 180;

function switchPortfolioRange(days, el) {
    el.parentElement.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    portfolioDays = days;
    renderPortfolioPerformance(days);
}

function renderPortfolioPerformance(days) {
    days = days || portfolioDays || 180;
    const ctx = document.getElementById('portPerformanceChart').getContext('2d');
    if (portPerfChart) portPerfChart.destroy();

    const labels = [];
    const dataPoints = [];
    let val = 10000;
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        val = val * (1 + (Math.random() * 0.04 - 0.015));
        dataPoints.push(Math.round(val * 100) / 100);
    }

    portPerfChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Total Value',
                data: dataPoints,
                borderColor: '#059669',
                borderWidth: 3,
                pointRadius: 3,
                backgroundColor: 'rgba(5, 150, 105, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: 'rgba(0, 0, 0, 0.06)' }, ticks: { color: '#64748b' } },
                x: { grid: { display: false }, ticks: { color: '#64748b' } }
            }
        }
    });
}

function renderPortfolioTable(holdings) {
    const body = document.getElementById('port-holdings-body');
    body.innerHTML = '';
    
    let totalVal = 0;
    let totalPnL = 0;
    let totalInvested = 0;
    const maxVal = holdings.length > 0 ? Math.max(...holdings.map(h => h.quantity * h.current_price)) : 1;
    const colors = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#0891b2', '#84cc16', '#14b8a6', '#f97316'];

    holdings.forEach((h, idx) => {
        const val = h.quantity * h.current_price;
        const invested = h.quantity * h.avg_price;
        const pnl = (h.current_price - h.avg_price) * h.quantity;
        const pnlPct = ((h.current_price - h.avg_price) / h.avg_price) * 100;
        const isPos = pnl > 0;
        const isZero = pnl === 0;
        const allocPct = (val / maxVal) * 100;
        
        totalVal += val;
        totalPnL += pnl;
        totalInvested += invested;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <div style="display:flex;align-items:center;gap:0.75rem;">
                    <div style="width:4px;height:32px;background:${colors[idx % colors.length]};border-radius:4px;flex-shrink:0;"></div>
                    <div>
                        <div style="font-weight:700;font-size:0.95rem;">${h.company || h.symbol}</div>
                        <div style="font-size:0.75rem;color:var(--text-secondary);">${h.sector || ''}</div>
                    </div>
                </div>
            </td>
            <td class="symbol-cell">${h.symbol}</td>
            <td>${h.quantity}</td>
            <td>$${h.avg_price.toFixed(2)}</td>
            <td class="price-cell">$${h.current_price.toFixed(2)}</td>
            <td class="price-cell">$${val.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
            <td>
                <div style="display:flex;align-items:center;gap:0.5rem;">
                    <div class="alloc-bar-wrap">
                        <div class="alloc-bar-fill" style="width:${allocPct.toFixed(0)}%;background:${colors[idx % colors.length]};"></div>
                    </div>
                    <span style="font-size:0.75rem;color:var(--text-secondary);font-weight:600;">${allocPct.toFixed(0)}%</span>
                </div>
            </td>
            <td style="text-align:right;">
                <div class="${isZero ? 'grey' : (isPos ? 'green' : 'red')}" style="font-weight:700;">${isZero ? '$0.00' : (isPos ? '+' : '') + '$' + pnl.toFixed(2)}</div>
                <div class="${isZero ? 'grey' : (isPos ? 'green' : 'red')}" style="font-size:0.8rem;">${isZero ? '0.0%' : (isPos ? '+' : '') + pnlPct.toFixed(1) + '%'}</div>
            </td>
            <td><button class="btn btn-outline small" onclick="viewStockDetail('${h.symbol}')" style="${pnl >= 0 ? '' : 'border-color:rgba(220,38,38,0.2);color:var(--danger);'}">${pnl >= 0 ? 'View' : 'Sell'}</button></td>
        `;
        body.appendChild(row);
    });

    document.getElementById('port-total-holdings-value').textContent = `$${totalVal.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    const totalPos = totalPnL > 0;
    const totalZero = totalPnL === 0;
    const totalGainEl = document.getElementById('port-total-gain');
    const totalGainPctEl = document.getElementById('port-total-gain-pct');
    const investedEl = document.getElementById('port-invested-capital');
    
    totalGainEl.textContent = totalZero ? '$0.00' : `${totalPos ? '+' : ''}$${totalPnL.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    totalGainEl.className = `value ${totalZero ? 'grey' : (totalPos ? 'green' : 'red')}`;
    
    const overallPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;
    totalGainPctEl.textContent = totalZero ? '0.00%' : `${totalPos ? '+' : ''}${overallPct.toFixed(2)}%`;
    totalGainPctEl.className = `value ${totalZero ? 'grey' : (totalPos ? 'green' : 'red')}`;

    investedEl.textContent = `$${totalInvested.toLocaleString(undefined, {minimumFractionDigits: 2})}`;

    document.getElementById('port-holdings-count').textContent = `${holdings.length} Stock${holdings.length !== 1 ? 's' : ''}`;
}

// --- History Logic ---
async function initHistory() {
    if (!currentUser) return;
    try {
        const response = await fetch(`${API_BASE}/transactions/${currentUser.user_id}`);
        allTransactions = await response.json();
        
        const stockFilter = document.getElementById('history-stock-filter');
        const uniqueStocks = [...new Set(allTransactions.map(t => t.symbol))];
        stockFilter.innerHTML = '<option value="All">All Stocks</option>';
        uniqueStocks.forEach(s => {
            stockFilter.innerHTML += `<option value="${s}">${s}</option>`;
        });

        document.getElementById('history-date-from').addEventListener('change', applyHistoryFilters);
        document.getElementById('history-date-to').addEventListener('change', applyHistoryFilters);
        document.getElementById('history-type').addEventListener('change', applyHistoryFilters);
        document.getElementById('history-stock-filter').addEventListener('change', applyHistoryFilters);

        currentFilteredTransactions = [...allTransactions];
        historyCurrentPage = 1;

        if (allTransactions.length === 0) {
            const emptyEl = document.getElementById('hist-empty');
            const tableCard = document.querySelector('#history-view .table-card');
            const filterBar = document.querySelector('#history-view .hist-filter-bar');
            const metrics = document.querySelector('#history-view .hist-metrics');
            if (emptyEl) emptyEl.style.display = 'flex';
            if (tableCard) tableCard.style.display = 'none';
            if (filterBar) filterBar.style.display = 'none';
            if (metrics) metrics.style.display = 'none';
            const countEl = document.getElementById('hist-count');
            if (countEl) countEl.textContent = '0 Transactions';
        } else {
            applyHistoryFilters();
        }
    } catch (e) {
        console.error("History load error:", e);
    }
}

function applyHistoryFilters() {
    const dateFrom = document.getElementById('history-date-from').value;
    const dateTo = document.getElementById('history-date-to').value;
    const type = document.getElementById('history-type').value;
    const stock = document.getElementById('history-stock-filter').value;

    let filtered = allTransactions.filter(t => {
        const tDate = t.timestamp.split(' ')[0];
        const matchesDate = (!dateFrom || tDate >= dateFrom) && (!dateTo || tDate <= dateTo);
        const matchesType = type === 'All' || t.type === type;
        const matchesStock = stock === 'All' || t.symbol === stock;
        return matchesDate && matchesType && matchesStock;
    });

    currentFilteredTransactions = filtered;
    historyCurrentPage = 1;
    renderHistory();

    const filterLabel = document.getElementById('hist-filter-active');
    if (filterLabel) {
        let label = type;
        if (stock !== 'All') label += ` | ${stock}`;
        if (dateFrom || dateTo) label += ' | Filtered';
        filterLabel.textContent = label;
    }
}

function renderHistory() {
    const body = document.getElementById('history-table-body');
    const emptyEl = document.getElementById('hist-empty');
    const tableCard = document.querySelector('#history-view .table-card');
    const data = currentFilteredTransactions;
    body.innerHTML = '';

    if (data.length === 0 && allTransactions.length === 0) {
        if (emptyEl) emptyEl.style.display = 'flex';
        if (tableCard) tableCard.style.display = 'none';
    } else {
        if (emptyEl) emptyEl.style.display = 'none';
        if (tableCard) tableCard.style.display = '';
    }
    
    let totalBought = 0;
    let totalSold = 0;
    let netPnl = 0;

    data.forEach(t => {
        if (t.type === 'BUY') totalBought += t.total;
        else {
            totalSold += t.total;
            if (t.gain_loss != null) netPnl += t.gain_loss;
        }
    });

    const startIndex = (historyCurrentPage - 1) * historyItemsPerPage;
    const endIndex = Math.min(startIndex + historyItemsPerPage, data.length);
    const paginatedData = data.slice(startIndex, endIndex);

    paginatedData.forEach((t) => {
        const row = document.createElement('tr');
        const isGain = t.type === 'SELL' ? t.gain_loss > 0 : ((t.current_price || t.price) - t.price > 0);
        const unrealizedPnl = t.type === 'BUY' ? ((t.current_price || t.price) - t.price) * t.quantity : 0;
        const pnlValue = t.type === 'SELL' ? (t.gain_loss || 0) : unrealizedPnl;
        const pnlClass = pnlValue > 0 ? 'green' : (pnlValue < 0 ? 'red' : 'grey');
        const pnlDisplay = t.type === 'SELL'
            ? (t.gain_loss == null ? '--' : (t.gain_loss >= 0 ? '+' : '') + '$' + t.gain_loss.toFixed(2))
            : (unrealizedPnl === 0 ? '--' : (unrealizedPnl > 0 ? '+' : '') + '$' + unrealizedPnl.toFixed(2));
        
        const dateParts = t.timestamp ? t.timestamp.split(' ') : ['', ''];
        const dateStr = dateParts[0] || '';
        const timeStr = dateParts[1] || '';

        row.innerHTML = `
            <td>
                <span class="hist-timeline-dot ${t.type.toLowerCase()}"></span>
            </td>
            <td>
                <div style="font-weight:600;font-size:0.9rem;">${dateStr}</div>
                <div style="font-size:0.75rem;color:var(--text-secondary);">${timeStr}</div>
            </td>
            <td>
                <div class="hist-stock-cell">
                    <div class="hist-stock-icon ${t.type.toLowerCase()}">${t.symbol ? t.symbol.substring(0, 2) : '--'}</div>
                    <div>
                        <div style="font-weight:600;font-size:0.9rem;">${t.company || t.symbol || '---'}</div>
                    </div>
                </div>
            </td>
            <td class="symbol-cell">${t.symbol || '---'}</td>
            <td><span class="trade-type-badge ${t.type.toLowerCase()}">${t.type}</span></td>
            <td style="font-weight:600;">${t.quantity}</td>
            <td class="price-cell">$${t.price.toFixed(2)}</td>
            <td class="price-cell">$${t.total.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
            <td style="text-align:right;">
                <div class="${pnlClass}" style="font-weight:700;">${pnlDisplay}</div>
            </td>
        `;
        body.appendChild(row);
    });

    document.getElementById('hist-total-trades').textContent = data.length;
    document.getElementById('hist-total-bought').textContent = `$${totalBought.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    document.getElementById('hist-total-sold').textContent = `$${totalSold.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    document.getElementById('hist-count').textContent = `${data.length} Transaction${data.length !== 1 ? 's' : ''}`;

    const netPnlEl = document.getElementById('hist-net-pnl');
    const netPnlPctEl = document.getElementById('hist-net-pnl-pct');
    const isNetPos = netPnl >= 0;
    netPnlEl.textContent = `${isNetPos ? '+' : ''}$${netPnl.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    netPnlEl.className = isNetPos ? 'green' : 'red';
    const pnlPct = totalBought > 0 ? (netPnl / totalBought) * 100 : 0;
    netPnlPctEl.textContent = `${isNetPos ? '+' : ''}${pnlPct.toFixed(2)}%`;
    netPnlPctEl.className = `sub-label ${isNetPos ? 'green' : 'red'}`;

    const filterLabel = document.getElementById('hist-filter-active');
    const type = document.getElementById('history-type').value;
    filterLabel.textContent = type === 'All' ? 'All' : type;

    renderHistoryPagination(data.length);
}

function renderHistoryPagination(totalItems) {
    const pageNumbersContainer = document.getElementById('hist-pagination');
    const pageInfo = document.getElementById('hist-showing-text');
    
    const totalPages = Math.ceil(totalItems / historyItemsPerPage);
    const startIndex = (historyCurrentPage - 1) * historyItemsPerPage + 1;
    const endIndex = Math.min(historyCurrentPage * historyItemsPerPage, totalItems);

    pageInfo.textContent = `Showing ${totalItems > 0 ? startIndex : 0} to ${endIndex} of ${totalItems} results`;
    
    pageNumbersContainer.innerHTML = '';
    
    if (totalPages <= 1) return;

    for (let i = 1; i <= totalPages; i++) {
        const pageNum = document.createElement('div');
        pageNum.className = `page-num ${i === historyCurrentPage ? 'active' : ''}`;
        pageNum.textContent = i;
        pageNum.onclick = () => {
            historyCurrentPage = i;
            renderHistory();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };
        pageNumbersContainer.appendChild(pageNum);
    }
}

function resetHistoryFilters() {
    document.getElementById('history-date-from').value = '';
    document.getElementById('history-date-to').value = '';
    document.getElementById('history-type').value = 'All';
    document.getElementById('history-stock-filter').value = 'All';
    applyHistoryFilters();
}

function exportToCSV() {
    if (allTransactions.length === 0) return;
    
    const headers = ['Date', 'Stock', 'Ticker', 'Type', 'Quantity', 'Price', 'Total', 'Gain/Loss'];
    const rows = allTransactions.map(t => [
        t.timestamp, t.company, t.symbol, t.type, t.quantity, t.price, t.total, t.gain_loss
    ]);

    let csvContent = "data:text/csv;charset=utf-8," 
        + headers.join(",") + "\n"
        + rows.map(e => e.join(",")).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `trade_history_${currentUser.username}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
async function handleRegister(e) {
    e.preventDefault();
    const errorEl = document.getElementById('register-error');
    errorEl.classList.add('hidden');
    
    const fullName = document.getElementById('reg-fullname').value;
    const username = document.getElementById('reg-username').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const confirm = document.getElementById('reg-confirm').value;

    if (password !== confirm) {
        showError(errorEl, "Passwords do not match");
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ full_name: fullName, username, email, password })
        });
        const data = await response.json();
        if (response.ok) {
            e.target.reset();
            currentUser = data;
            
            // Cache session properties
            localStorage.setItem('user_id', data.user_id);
            localStorage.setItem('username', data.username || '');
            localStorage.setItem('full_name', data.full_name || '');
            localStorage.setItem('balance', data.balance || 0);
            
            showToast('Account created! Welcome to AI Stock Prediction.');
            showView('dashboard-view');
        } else {
            showError(errorEl, data.error || "Registration failed");
        }
    } catch (error) {
        showError(errorEl, "Connection error. Is the server running?");
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const errorEl = document.getElementById('login-error');
    errorEl.classList.add('hidden');
    
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    try {
        const response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (response.ok) {
            e.target.reset();
            currentUser = data;
            
            // Cache session properties
            localStorage.setItem('user_id', data.user_id);
            localStorage.setItem('username', data.username || '');
            localStorage.setItem('full_name', data.full_name || '');
            localStorage.setItem('balance', data.balance || 0);
            
            showToast('Login successful! Welcome back.');
            showView('dashboard-view');
        } else {
            showError(errorEl, data.error || "Login failed");
        }
    } catch (error) {
        showError(errorEl, "Connection error. Is the server running?");
    }
}

async function handleLiveDemo() {
    showAppLoader();
    try {
        const response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'demo', password: 'demo1234' })
        });
        const data = await response.json();
        if (response.ok) {
            currentUser = data;
            
            // Cache session properties
            localStorage.setItem('user_id', data.user_id);
            localStorage.setItem('username', data.username || '');
            localStorage.setItem('full_name', data.full_name || '');
            localStorage.setItem('balance', data.balance || 0);
            
            showToast('Welcome to the Live Demo!');
            showView('dashboard-view');
        } else {
            showToast('Demo user not found. Redirecting to login.', 'error');
            showView('auth-login');
        }
    } catch (error) {
        showToast('Connection error. Redirecting to login.', 'error');
        showView('auth-login');
    }
}

function logout() {
    currentUser = null;
    localStorage.removeItem('user_id');
    localStorage.removeItem('username');
    localStorage.removeItem('full_name');
    localStorage.removeItem('balance');
    localStorage.removeItem('current_view');
    showView('home-view');
}

async function checkAuth() {
    const userId = localStorage.getItem('user_id');
    const savedView = localStorage.getItem('current_view') || 'dashboard-view';
    if (userId) {
        try {
            const response = await fetch(`${API_BASE}/me/${userId}`);
            if (response.ok) {
                const userData = await response.json();
                currentUser = userData;
                
                // Update session properties cache
                localStorage.setItem('username', userData.username || '');
                localStorage.setItem('full_name', userData.full_name || '');
                localStorage.setItem('balance', userData.balance || 0);
                
                // If we are currently on the home/auth views, redirect to saved/default view
                const homeView = document.getElementById('home-view');
                if (homeView && homeView.classList.contains('active')) {
                    showView(savedView);
                } else {
                    updateNavbar();
                }
            } else {
                logout();
            }
        } catch (e) {
            console.error("Auth check failed:", e);
            updateNavbar();
        }
    } else {
        currentUser = null;
        updateNavbar();
    }
}

// --- Profile & Password ---
async function loadProfileData() {
    if (!currentUser) return;
    document.getElementById('profile-fullname').value = currentUser.full_name || '';
    document.getElementById('profile-username').value = currentUser.username || '';
    document.getElementById('profile-email').value = currentUser.email || '';

    const initials = (currentUser.full_name || currentUser.username || '??')
        .split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const avatarEl = document.getElementById('profile-avatar-initials');
    if (avatarEl) avatarEl.textContent = initials || '??';

    const nameEl = document.getElementById('profile-hero-name');
    if (nameEl) nameEl.textContent = currentUser.full_name || currentUser.username || 'Trader';

    try {
        const [tradesRes, portRes, lbRes] = await Promise.all([
            fetch(`${API_BASE}/transactions/${currentUser.user_id}`),
            fetch(`${API_BASE}/portfolio/${currentUser.user_id}`),
            fetch(`${API_BASE}/leaderboard`)
        ]);
        const trades = await tradesRes.json();
        const portfolio = await portRes.json();
        const leaderboard = await lbRes.json();

        const tradeCount = document.getElementById('profile-trades-count');
        if (tradeCount) tradeCount.textContent = Array.isArray(trades) ? trades.length : 0;

        const totalValue = (portfolio.balance || 0) + (portfolio.portfolio_value || 0);
        const totalReturn = portfolio.total_return || portfolio.return || 0;
        const returnEl = document.getElementById('profile-return-display');
        if (returnEl) {
            const sign = totalReturn >= 0 ? '+' : '';
            returnEl.textContent = `${sign}$${totalReturn.toLocaleString()}`;
            returnEl.style.color = totalReturn >= 0 ? 'var(--green)' : 'var(--red)';
        }

        const rankEl = document.getElementById('profile-rank-display');
        if (rankEl && Array.isArray(leaderboard)) {
            const sorted = [...leaderboard].sort((a, b) => (b.portfolio_value || 0) - (a.portfolio_value || 0));
            const rank = sorted.findIndex(u => u.user_id === currentUser.user_id) + 1;
            rankEl.textContent = rank > 0 ? `#${rank}` : '#--';
        }
    } catch (e) {
        // silently ignore
    }
}

async function handleProfileUpdate(e) {
    e.preventDefault();
    const errorEl = document.getElementById('profile-error');
    errorEl.classList.add('hidden');

    const fullName = document.getElementById('profile-fullname').value;
    const username = document.getElementById('profile-username').value;
    const email = document.getElementById('profile-email').value;

    try {
        const response = await fetch(`${API_BASE}/user/update/${currentUser.user_id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ full_name: fullName, username, email })
        });
        const data = await response.json();
        if (response.ok) {
            currentUser = data;
            updateNavbar();
            showToast('Profile updated successfully!');
        } else {
            showError(errorEl, data.error || 'Update failed');
        }
    } catch (error) {
        showError(errorEl, 'Connection error');
    }
}

async function handlePasswordUpdate(e) {
    e.preventDefault();
    const errorEl = document.getElementById('password-error');
    errorEl.classList.add('hidden');

    const currentPassword = document.getElementById('pass-current').value;
    const newPassword = document.getElementById('pass-new').value;
    const confirmPassword = document.getElementById('pass-confirm').value;

    if (newPassword !== confirmPassword) {
        showError(errorEl, 'New passwords do not match');
        return;
    }

    if (newPassword.length < 8) {
        showError(errorEl, 'New password must be at least 8 characters');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/user/update-password/${currentUser.user_id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
        });
        const data = await response.json();
        if (response.ok) {
            e.target.reset();
            showToast('Password updated successfully!');
        } else {
            showError(errorEl, data.error || 'Update failed');
        }
    } catch (error) {
        showError(errorEl, 'Connection error');
    }
}

async function handleAccountDeactivate() {
    const confirmed = confirm('Are you absolutely sure? This will permanently delete your account and all trading data.');
    if (!confirmed) return;

    try {
        const response = await fetch(`${API_BASE}/user/delete/${currentUser.user_id}`, {
            method: 'DELETE'
        });
        if (response.ok) {
            showToast('Account successfully deactivated.', 'error');
            setTimeout(() => {
                logout();
            }, 2000);
        } else {
            alert('Failed to deactivate account.');
        }
    } catch (error) {
        alert('Connection error');
    }
}

// --- Leaderboard Logic ---
async function initLeaderboard() {
    try {
        const response = await fetch(`${API_BASE}/leaderboard`);
        const data = await response.json();
        renderLeaderboard(data);
    } catch (e) {
        console.error("Leaderboard load error:", e);
    }
}

function renderLeaderboard(data) {
    const emptyEl = document.getElementById('lbd-empty');
    const podiumEl = document.querySelector('.podium-section');
    const tableCard = document.querySelector('#leaderboard-view .table-card');
    const bannerEl = document.getElementById('user-rank-banner');
    const metricsEl = document.querySelector('.lbd-metrics');

    if (!data || data.length === 0) {
        if (emptyEl) emptyEl.style.display = 'flex';
        if (podiumEl) podiumEl.style.display = 'none';
        if (tableCard) tableCard.style.display = 'none';
        if (bannerEl) bannerEl.style.display = 'none';
        if (metricsEl) metricsEl.style.display = 'none';
        document.getElementById('lbd-total-users').textContent = '0';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    if (podiumEl) podiumEl.style.display = 'flex';
    if (tableCard) tableCard.style.display = '';
    if (metricsEl) metricsEl.style.display = '';

    document.getElementById('lbd-total-users').textContent = data.length;

    const returns = data.map(u => u.return_pct);
    const topReturn = Math.max(...returns);
    const avgReturn = returns.reduce((s, v) => s + v, 0) / returns.length;
    const topPortfolio = Math.max(...data.map(u => u.portfolio_value));

    document.getElementById('lbd-top-return').textContent = `${topReturn >= 0 ? '+' : ''}${topReturn.toFixed(2)}%`;
    document.getElementById('lbd-top-return').className = topReturn >= 0 ? 'green' : 'red';
    document.getElementById('lbd-avg-return').textContent = `${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(2)}%`;
    document.getElementById('lbd-avg-return').className = avgReturn >= 0 ? 'green' : 'red';
    document.getElementById('lbd-top-portfolio').textContent = `$${topPortfolio.toLocaleString(undefined, {maximumFractionDigits: 0})}`;

    // 1. Render Podium (Top 3)
    const podiumData = data.slice(0, 3);
    const medalIcons = ['trophy', 'award', 'medal'];
    const rankColors = ['gold', 'silver', 'bronze'];
    
    for (let i = 0; i < 3; i++) {
        const rank = i + 1;
        const user = podiumData[i];
        
        const avatarEl = document.getElementById(`podium-${rank}-avatar`);
        const nameEl = document.getElementById(`podium-${rank}-name`);
        const returnEl = document.getElementById(`podium-${rank}-return`);
        const valueEl = document.getElementById(`podium-${rank}-value`);
        
        if (user) {
            avatarEl.textContent = getInitials(user.full_name || user.username);
            nameEl.textContent = user.full_name || user.username;
            const isPos = user.return_pct >= 0;
            returnEl.textContent = `${isPos ? '+' : ''}${user.return_pct.toFixed(2)}%`;
            returnEl.className = `return ${isPos ? 'green' : 'red'}`;
            valueEl.textContent = `$${user.portfolio_value.toLocaleString(undefined, {maximumFractionDigits: 0})}`;
        } else {
            avatarEl.textContent = '--';
            nameEl.textContent = '---';
            returnEl.textContent = '0.0%';
            valueEl.textContent = '$0';
        }
    }

    // 2. Render Full Table (All users)
    const body = document.getElementById('leaderboard-table-body');
    if (body) {
        body.innerHTML = '';
        const maxReturn = Math.max(...data.map(u => Math.abs(u.return_pct)), 1);

        data.forEach((user, index) => {
            const row = document.createElement('tr');
            const isCurrentUser = currentUser && user.user_id === currentUser.user_id;
            const isPos = user.return_pct >= 0;
            const barPct = Math.min(Math.abs(user.return_pct) / maxReturn * 100, 100);
            const rankClass = index === 0 ? 'gold' : (index === 1 ? 'silver' : (index === 2 ? 'bronze' : 'default'));

            let statusText = 'Active';
            let statusClass = 'active';
            if (user.return_pct > 15) { statusText = 'Pro'; statusClass = 'pro'; }
            else if (user.trades < 3) { statusText = 'Beginner'; statusClass = 'beginner'; }

            row.className = isCurrentUser ? 'current-user-row' : '';
            row.innerHTML = `
                <td>
                    <span class="rank-medal ${rankClass}">${index < 3 ? ['#1','#2','#3'][index] : `#${index+1}`}</span>
                </td>
                <td>
                    <div class="trader-cell">
                        <div class="trader-avatar ${rankClass}">${getInitials(user.full_name || user.username)}</div>
                        <div>
                            <div class="trader-name">${user.full_name || user.username} ${isCurrentUser ? '<span class="trader-you">You</span>' : ''}</div>
                        </div>
                    </div>
                </td>
                <td class="price-cell">$${user.portfolio_value.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                <td>
                    <div style="display:flex;align-items:center;gap:0.5rem;">
                        <div class="return-bar-wrap">
                            <div class="return-bar-fill" style="width:${barPct.toFixed(0)}%;background:${isPos ? 'var(--success)' : 'var(--danger)'};"></div>
                        </div>
                        <span style="font-size:0.8rem;font-weight:700;${isPos ? 'color:var(--success)' : 'color:var(--danger)'}">${isPos ? '+' : ''}${user.return_pct.toFixed(2)}%</span>
                    </div>
                </td>
                <td style="font-weight:600;">${user.trades}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            `;
            body.appendChild(row);
        });
    }

    // 3. User Rank Banner
    if (currentUser && bannerEl) {
        const userIndex = data.findIndex(u => u.user_id === currentUser.user_id);
        if (userIndex >= 0) {
            bannerEl.style.display = '';
            const userRank = userIndex + 1;
            const userData = data[userIndex];
            
            document.getElementById('user-rank-number').textContent = `#${userRank}`;
            document.getElementById('user-rank-context').textContent = `${userRank} of ${data.length} traders`;
            
            const returnEl = document.getElementById('user-rank-return');
            returnEl.textContent = `${userData.return_pct >= 0 ? '+' : ''}${userData.return_pct.toFixed(2)}%`;
            returnEl.className = userData.return_pct >= 0 ? 'green' : 'red';

            const portfolioEl = document.getElementById('user-rank-portfolio');
            portfolioEl.textContent = `$${userData.portfolio_value.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
            portfolioEl.className = userData.return_pct >= 0 ? 'green' : 'red';
        } else {
            bannerEl.style.display = 'none';
        }
    } else if (bannerEl) {
        bannerEl.style.display = 'none';
    }

    document.getElementById('lbd-count').textContent = `${data.length} trader${data.length !== 1 ? 's' : ''}`;

    const showingText = document.getElementById('leaderboard-showing-text');
    if (showingText) {
        showingText.textContent = `1-${Math.min(data.length, 10)} of ${data.length}`;
    }
}

function showError(el, msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
}

function togglePassword(id) {
    const input = document.getElementById(id);
    input.type = input.type === 'password' ? 'text' : 'password';
}

// --- Market News ---
async function fetchMarketNews() {
    showNewsShimmer();
    try {
        const response = await fetch(`${API_BASE}/market-news?category=general`);
        const news = await response.json();
        renderMarketNews(news);
    } catch (e) {
        console.error('Error fetching market news:', e);
        renderMarketNews(null);
    }
}

function showNewsShimmer() {
    const grid = document.getElementById('news-grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (let i = 0; i < 3; i++) {
        const shim = document.createElement('div');
        shim.className = 'news-shimmer';
        shim.innerHTML = `
            <div class="news-shimmer-img"></div>
            <div class="news-shimmer-body">
                <div class="news-shimmer-line" style="width: 30%;"></div>
                <div class="news-shimmer-line"></div>
                <div class="news-shimmer-line"></div>
            </div>
        `;
        grid.appendChild(shim);
    }
}

function renderMarketNews(news) {
    const grid = document.getElementById('news-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!news || news.length === 0) {
        grid.innerHTML = `
            <div class="news-card-placeholder">
                <i data-lucide="newspaper"></i>
                <p>Market news temporarily unavailable</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    news.forEach(article => {
        const ts = article.datetime;
        const date = ts ? new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
        const img = article.image || '';

        const card = document.createElement('div');
        card.className = 'news-card';
        card.innerHTML = `
            <div class="news-card-image-wrap">
                ${img ? `
                    <img class="news-card-image" src="${img}" alt="" loading="lazy">
                    <div class="news-card-image-overlay"></div>
                ` : `
                    <div class="news-card-image-fallback">
                        <i data-lucide="newspaper"></i>
                    </div>
                `}
                <div class="news-card-image-badge">
                    <i data-lucide="clock" style="width: 12px; height: 12px;"></i>
                    ${date}
                </div>
            </div>
            <div class="news-card-body">
                <div class="news-card-meta">
                    <span class="news-card-source">${article.source || 'News'}</span>
                    ${article.category ? `<span style="text-transform:capitalize;">${article.category}</span>` : ''}
                </div>
                <h3>${article.headline || ''}</h3>
                <p>${article.summary || ''}</p>
                <div class="news-card-footer">
                    <span class="news-card-time">${article.related ? `Related: ${article.related}` : ''}</span>
                    <a href="${article.url || '#'}" target="_blank" rel="noopener" class="news-card-link">
                        Read More <i data-lucide="arrow-right"></i>
                    </a>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });

    if (window.lucide) lucide.createIcons();
}

// --- Landing Data (ticker + movers combined) ---
let currentMoverTab = 'gainers';
let _lastLandingData = null;

async function fetchLandingData() {
    try {
        const response = await fetch(`${API_BASE}/landing`);
        const data = await response.json();
        _lastLandingData = data;
        renderTicker(data.stocks);
        renderMovers(data);
    } catch (e) {
        console.error('Landing data fetch error:', e);
    }
}

function renderTicker(stocks) {
    const track = document.getElementById('ticker-track');
    if (!track) return;

    const makeItems = (list) => list.map(s => {
        const isUp = s.change >= 0;
        return `
            <div class="ticker-item">
                <span class="ticker-symbol">${s.symbol}</span>
                <span class="ticker-price">$${s.price.toFixed(2)}</span>
                <span class="ticker-change ${isUp ? 'up' : 'down'}">${isUp ? '+' : ''}${s.change_pct.toFixed(2)}%</span>
            </div>
        `;
    }).join('');

    const items = makeItems(stocks);
    track.innerHTML = items + items;
}

function renderMovers(data) {
    const list = currentMoverTab === 'gainers' ? data.top_gainers : data.top_losers;
    const body = document.getElementById('movers-body');
    if (!body) return;
    body.innerHTML = '';

    if (!list || list.length === 0) {
        body.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--text-secondary)">No movers data available</td></tr>';
        return;
    }

    list.forEach((item, i) => {
        const isUp = item.change >= 0;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="mover-rank">${i + 1}</td>
            <td><span class="mover-name">${item.name}</span><span class="mover-symbol">${item.symbol}</span></td>
            <td class="mover-price">$${item.price.toFixed(2)}</td>
            <td><span class="mover-change ${isUp ? 'up' : 'down'}">${isUp ? '+' : ''}${item.change_pct.toFixed(2)}%</span></td>
        `;
        body.appendChild(row);
    });
}

function switchMoverTab(tab) {
    currentMoverTab = tab;
    document.querySelectorAll('.mover-tab').forEach(t => t.classList.remove('active'));
    const btns = document.querySelectorAll('.mover-tab');
    btns.forEach(btn => {
        if (btn.getAttribute('onclick')?.includes(`'${tab}'`)) {
            btn.classList.add('active');
        }
    });
    if (_lastLandingData) renderMovers(_lastLandingData);
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    // Initial UI Setup
    if (window.lucide) lucide.createIcons();
    
    // Ensure loader is visible on start
    showAppLoader();
    
    // Update navbar synchronously based on cache to avoid flash of guest navbar
    updateNavbar();
    
    // Auth Check
    await checkAuth();
    
    // Landing page data (single combined call, 60s refresh)
    fetchLandingData();
    fetchMarketNews();
    setInterval(fetchLandingData, 60000);
    
    // Wait a bit more for a premium feel on initial load
    setTimeout(hideAppLoader, 800);
    
    document.getElementById('login-form')?.addEventListener('submit', handleLogin);
    document.getElementById('register-form')?.addEventListener('submit', handleRegister);
    document.getElementById('profile-form')?.addEventListener('submit', handleProfileUpdate);
    document.getElementById('password-form')?.addEventListener('submit', handlePasswordUpdate);
    
    // Clear all forms on refresh
    document.querySelectorAll('form').forEach(form => form.reset());
});
