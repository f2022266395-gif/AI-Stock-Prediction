const API_BASE = 'http://localhost:5000/api';
let currentUser = null;
let performanceChart = null;
let detailChart = null;
let allocationChart = null;
let portPerfChart = null;
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
let currentView = 'home-view';

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
        await fetchDashboardSummary();
        await fetchRecentTransactions();
        await fetchPortfolioData();
        await fetchMarketOverview();
        
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
    const isPostive = data.total_return >= 0;
    
    returnEl.textContent = `${isPostive ? '+' : '-'}$${Math.abs(data.total_return).toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    returnEl.className = isPostive ? 'green' : 'red';
    returnPctEl.textContent = `${isPostive ? '+' : ''}${data.total_return_pct.toFixed(1)}%`;
    returnPctEl.className = `sub-label ${isPostive ? 'green' : 'red'}`;
    
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

    trades.forEach(trade => {
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
    const body = document.getElementById('holdings-table-body');
    body.innerHTML = '';

    if (holdings.length === 0) {
        body.innerHTML = '<tr><td colspan="5" class="centered" style="padding: 2rem; color: var(--text-secondary);">No active holdings.</td></tr>';
        return;
    }

    holdings.forEach(h => {
        const totalValue = h.quantity * h.current_price;
        const profit = (h.current_price - h.avg_price) * h.quantity;
        const profitPct = ((h.current_price - h.avg_price) / h.avg_price) * 100;
        const isPositive = profit >= 0;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="symbol-cell">${h.symbol}</td>
            <td>${h.quantity}</td>
            <td>$${h.avg_price.toFixed(2)}</td>
            <td class="price-cell">$${h.current_price.toFixed(2)}</td>
            <td class="gain-cell ${isPositive ? 'green' : 'red'}">
                ${isPositive ? '+' : ''}$${profit.toFixed(2)} (${isPositive ? '+' : ''}${profitPct.toFixed(1)}%)
            </td>
        `;
        body.appendChild(row);
    });
}

async function fetchMarketOverview() {
    const response = await fetch(`${API_BASE}/stocks`);
    const stocks = await response.json();
    const body = document.getElementById('market-overview-body');
    body.innerHTML = '';

    stocks.forEach(s => {
        const isPositive = s.change > 0;
        const isNegative = s.change < 0;
        const colorClass = isPositive ? 'green' : (isNegative ? 'red' : '');
        const sign = isPositive ? '+' : '';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${s.name}</td>
            <td class="symbol-cell">${s.symbol}</td>
            <td class="price-cell">$${s.price.toFixed(2)}</td>
            <td class="${colorClass}">${sign}$${s.change.toFixed(2)}</td>
            <td class="${colorClass}">${sign}${s.change_pct}%</td>
        `;
        body.appendChild(row);
    });
}

function renderPerformanceChart() {
    const ctx = document.getElementById('performanceChart').getContext('2d');
    
    if (performanceChart) performanceChart.destroy();

    // Simulated historical data since we don't have historical tracking yet
    const labels = ['Jan 15', 'Jan 22', 'Jan 29', 'Feb 5', 'Feb 12', 'Feb 19', 'Feb 26', 'Mar 4', 'Mar 11', 'Mar 18', 'Mar 25'];
    const dataPoints = [10000, 10200, 10150, 10400, 10800, 11200, 11000, 11500, 11800, 12200, 12450];

    performanceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Portfolio Value',
                data: dataPoints,
                borderColor: '#3b82f6',
                borderWidth: 3,
                pointRadius: 0,
                pointHoverRadius: 6,
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
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
                    backgroundColor: '#141a29',
                    titleColor: '#8b949e',
                    bodyColor: '#fff',
                    borderColor: 'rgba(255,255,255,0.1)',
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
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                    ticks: {
                        color: '#8b949e',
                        callback: value => '$' + (value / 1000) + 'k'
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#8b949e' }
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
        renderMarketsTable();
    } catch (error) {
        console.error("Error loading markets:", error);
    }
}

function renderMarketsTable() {
    const body = document.getElementById('markets-table-body');
    const countEl = document.getElementById('market-results-count');
    body.innerHTML = '';
    
    const stocks = currentFilteredStocks;
    countEl.textContent = `${stocks.length} Stocks Found`;

    // Pagination logic
    const startIndex = (marketCurrentPage - 1) * marketItemsPerPage;
    const endIndex = Math.min(startIndex + marketItemsPerPage, stocks.length);
    const paginatedStocks = stocks.slice(startIndex, endIndex);

    paginatedStocks.forEach((s, i) => {
        const actualIndex = startIndex + i + 1;
        const isPositive = s.change > 0;
        const isNegative = s.change < 0;
        const colorClass = isPositive ? 'green' : (isNegative ? 'red' : '');
        const sign = isPositive ? '+' : '';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${actualIndex}</td>
            <td class="symbol-cell">${s.name}</td>
            <td><span class="trade-type-badge buy">${s.symbol}</span></td>
            <td>${s.sector}</td>
            <td class="price-cell">$${s.price.toFixed(2)}</td>
            <td class="${colorClass}">${sign}$${s.change.toFixed(2)}</td>
            <td class="${colorClass}">${sign}${s.change_pct}%</td>
            <td>${s.volume}</td>
            <td>
                <button class="btn btn-outline small" onclick="viewStockDetail('${s.symbol}')">View</button>
            </td>
        `;
        body.appendChild(row);
    });

    renderPagination(stocks.length);
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
            renderMarketsTable();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    nextBtn.onclick = () => {
        if (marketCurrentPage < totalPages) {
            marketCurrentPage++;
            renderMarketsTable();
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
            renderMarketsTable();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };
        pageNumbersContainer.appendChild(pageNum);
    }
}

function filterMarkets() {
    const query = document.getElementById('market-search').value.toLowerCase();
    const sector = document.getElementById('filter-sector').value;
    const sortBy = document.getElementById('sort-by').value;

    let filtered = allStocks.filter(s => {
        const matchesQuery = s.name.toLowerCase().includes(query) || s.symbol.toLowerCase().includes(query);
        const matchesSector = sector === 'All' || s.sector === sector;
        return matchesQuery && matchesSector;
    });

    // Sorting
    filtered.sort((a, b) => {
        if (sortBy === 'name') return a.name.localeCompare(b.name);
        if (sortBy === 'price') return b.price - a.price;
        if (sortBy === 'change') return b.change_pct - a.change_pct;
        if (sortBy === 'volume') return parseFloat(b.volume) - parseFloat(a.volume);
        return 0;
    });

    currentFilteredStocks = filtered;
    marketCurrentPage = 1;
    renderMarketsTable();
}

async function viewStockDetail(ticker) {
    currentViewedTicker = ticker;
    showView('stock-detail-view');
    await fetchStockDetailData(ticker);
}

async function fetchStockDetailData(ticker) {
    try {
        const response = await fetch(`${API_BASE}/stocks/${ticker}`);
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
        changePctTxt.textContent = `(${isPositive ? '+' : ''}${data.change_pct}%)`;
        changeTxt.className = isPositive ? 'green' : 'red';
        changePctTxt.className = isPositive ? 'green' : 'red';

        // Signal
        const banner = document.getElementById('detail-signal-banner');
        if (data.change_pct > 0.5) {
            banner.className = 'signal-banner buy';
            document.getElementById('detail-signal-text').textContent = "BUY SIGNAL — Consistent uptrend detected.";
        } else {
            banner.className = 'signal-banner sell';
            document.getElementById('detail-signal-text').textContent = "NEUTRAL SIGNAL — Market consolidation period.";
        }

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
        renderDetailChart(data.history);
        lucide.createIcons();
    } catch (error) {
        console.error("Error loading stock detail:", error);
    }
}

function renderDetailChart(history) {
    const ctx = document.getElementById('detail-history-chart').getContext('2d');
    if (detailChart) detailChart.destroy();

    detailChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: history.map(h => h.date),
            datasets: [{
                label: 'Price',
                data: history.map(h => h.price),
                borderColor: '#3b82f6',
                borderWidth: 3,
                pointRadius: 2,
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#8b949e' } },
                x: { grid: { display: false }, ticks: { color: '#8b949e' } }
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
        const [summRes, portRes] = await Promise.all([
            fetch(`${API_BASE}/dashboard-summary/${currentUser.user_id}`),
            fetch(`${API_BASE}/portfolio/${currentUser.user_id}`)
        ]);
        
        const summary = await summRes.json();
        const holdings = await portRes.json();
        
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
        renderPortfolioPerformance(); // Line chart
        renderPortfolioTable(holdings);
    } catch (e) {
        console.error("Portfolio load error:", e);
    }
}

function renderAllocationChart(holdings) {
    const ctx = document.getElementById('allocationChart').getContext('2d');
    if (allocationChart) allocationChart.destroy();
    
    if (holdings.length === 0) {
        // Draw empty state handled by Chart.js or just show text
    }

    const data = {
        labels: holdings.map(h => h.symbol),
        datasets: [{
            data: holdings.map(h => h.quantity * h.current_price),
            backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'],
            borderWidth: 0,
            hoverOffset: 10
        }]
    };

    allocationChart = new Chart(ctx, {
        type: 'doughnut',
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: { position: 'bottom', labels: { color: '#8b949e', usePointStyle: true, padding: 20 } }
            }
        }
    });
}

function renderPortfolioPerformance() {
    const ctx = document.getElementById('portPerformanceChart').getContext('2d');
    if (portPerfChart) portPerfChart.destroy();

    const labels = ['Jan 15', 'Jan 22', 'Jan 29', 'Feb 5', 'Feb 12', 'Feb 19', 'Feb 26', 'Mar 4', 'Mar 11', 'Mar 18', 'Mar 25'];
    const dataPoints = [10000, 10200, 10150, 10400, 10800, 11200, 11000, 11500, 11800, 12200, 12450];

    portPerfChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Total Value',
                data: dataPoints,
                borderColor: '#10b981',
                borderWidth: 3,
                pointRadius: 3,
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#8b949e' } },
                x: { grid: { display: false }, ticks: { color: '#8b949e' } }
            }
        }
    });
}

function renderPortfolioTable(holdings) {
    const body = document.getElementById('port-holdings-body');
    body.innerHTML = '';
    
    let totalVal = 0;
    let totalPnL = 0;

    holdings.forEach(h => {
        const val = h.quantity * h.current_price;
        const pnl = (h.current_price - h.avg_price) * h.quantity;
        const pnlPct = ((h.current_price - h.avg_price) / h.avg_price) * 100;
        const isPos = pnl >= 0;
        
        totalVal += val;
        totalPnL += pnl;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>Stock Name</td>
            <td class="symbol-cell">${h.symbol}</td>
            <td>${h.quantity}</td>
            <td>$${h.avg_price.toFixed(2)}</td>
            <td class="price-cell">$${h.current_price.toFixed(2)}</td>
            <td>$${val.toLocaleString()}</td>
            <td class="${isPos ? 'green' : 'red'}">${isPos ? '+' : ''}$${pnl.toFixed(2)}</td>
            <td class="${isPos ? 'green' : 'red'}">${isPos ? '+' : ''}${pnlPct.toFixed(1)}%</td>
            <td><button class="btn btn-outline small danger-btn" onclick="viewStockDetail('${h.symbol}')">Sell</button></td>
        `;
        body.appendChild(row);
    });

    document.getElementById('port-total-holdings-value').textContent = `$${totalVal.toLocaleString()}`;
    const totalPos = totalPnL >= 0;
    const totalGainEl = document.getElementById('port-total-gain');
    const totalGainPctEl = document.getElementById('port-total-gain-pct');
    
    totalGainEl.textContent = `${totalPos ? '+' : ''}$${totalPnL.toLocaleString()}`;
    totalGainEl.className = totalPos ? 'green' : 'red';
    
    const overallPct = totalVal > 0 ? (totalPnL / (totalVal - totalPnL)) * 100 : 0;
    totalGainPctEl.textContent = `${totalPos ? '+' : ''}${overallPct.toFixed(2)}%`;
    totalGainPctEl.className = totalPos ? 'green' : 'red';
}

// --- History Logic ---
async function initHistory() {
    if (!currentUser) return;
    try {
        const response = await fetch(`${API_BASE}/transactions/${currentUser.user_id}`);
        allTransactions = await response.json();
        
        // Populate Stock Filter
        const stockFilter = document.getElementById('history-stock-filter');
        const uniqueStocks = [...new Set(allTransactions.map(t => t.symbol))];
        stockFilter.innerHTML = '<option value="All">All Stocks</option>';
        uniqueStocks.forEach(s => {
            stockFilter.innerHTML += `<option value="${s}">${s}</option>`;
        });

        currentFilteredTransactions = [...allTransactions];
        historyCurrentPage = 1;
        applyHistoryFilters();
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
}

function renderHistory() {
    const body = document.getElementById('history-table-body');
    const data = currentFilteredTransactions;
    body.innerHTML = '';
    
    let totalBought = 0;
    let totalSold = 0;

    // Calculate totals on full filtered set
    data.forEach(t => {
        if (t.type === 'BUY') totalBought += t.total;
        else totalSold += t.total;
    });

    // Pagination logic
    const startIndex = (historyCurrentPage - 1) * historyItemsPerPage;
    const endIndex = Math.min(startIndex + historyItemsPerPage, data.length);
    const paginatedData = data.slice(startIndex, endIndex);

    paginatedData.forEach((t, i) => {
        const actualIndex = startIndex + i + 1;
        const row = document.createElement('tr');
        const isGain = t.gain_loss > 0;
        row.innerHTML = `
            <td>${actualIndex}</td>
            <td>${t.timestamp}</td>
            <td>${t.company || 'Company Name'}</td>
            <td><span class="trade-type-badge buy">${t.symbol}</span></td>
            <td><span class="trade-type-badge ${t.type.toLowerCase()}">${t.type}</span></td>
            <td>${t.quantity}</td>
            <td>$${t.price.toFixed(2)}</td>
            <td>$${t.total.toLocaleString()}</td>
            <td class="${t.type === 'SELL' ? (isGain ? 'green' : 'red') : 'grey'}">
                ${t.type === 'SELL' ? (isGain ? '+' : '') + '$' + t.gain_loss.toFixed(2) : '--'}
            </td>
        `;
        body.appendChild(row);
    });

    document.getElementById('hist-total-trades').textContent = data.length;
    document.getElementById('hist-total-bought').textContent = `$${totalBought.toLocaleString()}`;
    document.getElementById('hist-total-sold').textContent = `$${totalSold.toLocaleString()}`;
    document.getElementById('hist-count').textContent = `${data.length} Transactions`;

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
            localStorage.setItem('user_id', data.user_id);
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
            localStorage.setItem('user_id', data.user_id);
            showToast('Login successful! Welcome back.');
            showView('dashboard-view');
        } else {
            showError(errorEl, data.error || "Login failed");
        }
    } catch (error) {
        showError(errorEl, "Connection error. Is the server running?");
    }
}

function logout() {
    currentUser = null;
    localStorage.removeItem('user_id');
    showView('home-view');
}

async function checkAuth() {
    const userId = localStorage.getItem('user_id');
    if (userId) {
        try {
            const response = await fetch(`${API_BASE}/me/${userId}`);
            if (response.ok) {
                currentUser = await response.json();
                
                // If we are currently on the home view, redirect to dashboard
                const homeView = document.getElementById('home-view');
                if (homeView && homeView.classList.contains('active')) {
                    showView('dashboard-view');
                } else {
                    updateNavbar();
                }
            } else {
                localStorage.removeItem('user_id');
                currentUser = null;
                updateNavbar();
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
function loadProfileData() {
    if (!currentUser) return;
    document.getElementById('profile-fullname').value = currentUser.full_name || '';
    document.getElementById('profile-username').value = currentUser.username || '';
    document.getElementById('profile-email').value = currentUser.email || '';
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
    // 1. Render Podium (Top 3)
    const podiumData = data.slice(0, 3);
    
    // Fill placeholders if less than 3 users
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
            returnEl.textContent = `${user.return_pct >= 0 ? '+' : ''}${user.return_pct.toFixed(2)}%`;
            returnEl.className = `return ${user.return_pct >= 0 ? 'green' : 'red'}`;
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
        data.forEach((user, index) => {
            const row = document.createElement('tr');
            const isCurrentUser = currentUser && user.user_id === currentUser.user_id;
            const isPos = user.return_pct >= 0;
            
            row.className = isCurrentUser ? 'current-user-row' : '';
            row.innerHTML = `
                <td><span class="rank-badge ${index < 3 ? 'rank-' + (index + 1) : ''}">#${index + 1}</span></td>
                <td>
                    <div class="user-info">
                        <div class="avatar-small">${getInitials(user.full_name || user.username)}</div>
                        <span>${user.full_name || user.username} ${isCurrentUser ? '(You)' : ''}</span>
                    </div>
                </td>
                <td class="font-mono">$${user.portfolio_value.toLocaleString()}</td>
                <td class="${isPos ? 'green' : 'red'} font-bold">${isPos ? '+' : ''}${user.return_pct.toFixed(2)}%</td>
                <td>${user.trades}</td>
                <td><span class="badge ${user.return_pct > 10 ? 'success' : 'neutral'}">${user.return_pct > 10 ? 'Pro' : 'Active'}</span></td>
            `;
            body.appendChild(row);
        });
    }

    // 3. User Rank Banner
    if (currentUser) {
        const userIndex = data.findIndex(u => u.user_id === currentUser.user_id);
        const userRank = userIndex + 1;
        const userData = data[userIndex];
        
        if (userData) {
            document.getElementById('user-rank-number').textContent = `#${userRank}`;
            document.getElementById('user-rank-context').textContent = `#${userRank} out of ${data.length} users`;
            
            const returnEl = document.getElementById('user-rank-return');
            returnEl.textContent = `${userData.return_pct >= 0 ? '+' : ''}${userData.return_pct.toFixed(2)}%`;
            returnEl.className = userData.return_pct >= 0 ? 'green' : 'red';
        }
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

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    // Initial UI Setup
    if (window.lucide) lucide.createIcons();
    
    // Ensure loader is visible on start
    showAppLoader();
    
    // Auth Check
    await checkAuth();
    
    // Wait a bit more for a premium feel on initial load
    setTimeout(hideAppLoader, 800);
    
    document.getElementById('login-form')?.addEventListener('submit', handleLogin);
    document.getElementById('register-form')?.addEventListener('submit', handleRegister);
    document.getElementById('profile-form')?.addEventListener('submit', handleProfileUpdate);
    document.getElementById('password-form')?.addEventListener('submit', handlePasswordUpdate);
    
    // Clear all forms on refresh
    document.querySelectorAll('form').forEach(form => form.reset());
});
