const API_BASE = 'http://localhost:5000/api';
let currentUser = null;
let performanceChart = null;

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
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });
    const target = document.getElementById(viewId);
    if (target) {
        target.classList.add('active');
        if (viewId === 'dashboard-view') {
            await initDashboard();
        } else if (viewId === 'profile-view') {
            loadProfileData();
        }
    }
    updateNavbar();
    setActiveTab(viewId);
    window.scrollTo(0, 0);
}

function updateNavbar() {
    const guestNav = document.getElementById('guest-nav');
    const userNav = document.getElementById('user-nav');
    const mainTabs = document.getElementById('main-nav-tabs');
    
    if (currentUser) {
        guestNav.classList.add('hidden');
        userNav.classList.remove('hidden');
        mainTabs.classList.remove('hidden');
        
        document.getElementById('nav-user-initials').textContent = getInitials(currentUser.full_name || currentUser.username);
        document.getElementById('nav-user-full-name').textContent = currentUser.full_name || currentUser.username;
        
        const welcomeTitle = document.getElementById('dash-welcome');
        if (welcomeTitle) welcomeTitle.textContent = `Welcome back, ${currentUser.full_name.split(' ')[0]}`;
    } else {
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
    if (!currentUser) return;
    
    // Update date
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    document.getElementById('dash-date').textContent = now.toLocaleDateString('en-US', options);

    try {
        await Promise.all([
            fetchDashboardSummary(),
            fetchRecentTransactions(),
            fetchPortfolioData(),
            fetchMarketOverview()
        ]);
        renderPerformanceChart();
    } catch (error) {
        console.error("Error initializing dashboard:", error);
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
        // Simulated change for visual variety
        const change = (Math.random() * 10 - 5).toFixed(2);
        const changePct = (Math.random() * 4 - 2).toFixed(1);
        const isPositive = change >= 0;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${s.name}</td>
            <td class="symbol-cell">${s.symbol}</td>
            <td class="price-cell">$${s.price.toFixed(2)}</td>
            <td class="${isPositive ? 'green' : 'red'}">${isPositive ? '+' : ''}$${change}</td>
            <td class="${isPositive ? 'green' : 'red'}">${isPositive ? '+' : ''}${changePct}%</td>
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

// --- Authentication ---
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
            showView('auth-login');
            showToast('Registration successful! Please login.');
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
                updateNavbar();
                // If on dashboard view, load fresh data
                if (document.getElementById('dashboard-view').classList.contains('active')) {
                    initDashboard();
                }
            } else {
                localStorage.removeItem('user_id');
            }
        } catch (e) {
            console.error("Auth check failed");
        }
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

function showError(el, msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
}

function togglePassword(id) {
    const input = document.getElementById(id);
    input.type = input.type === 'password' ? 'text' : 'password';
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    
    document.getElementById('login-form')?.addEventListener('submit', handleLogin);
    document.getElementById('register-form')?.addEventListener('submit', handleRegister);
    document.getElementById('profile-form')?.addEventListener('submit', handleProfileUpdate);
    document.getElementById('password-form')?.addEventListener('submit', handlePasswordUpdate);
    
    if (window.lucide) lucide.createIcons();
});
