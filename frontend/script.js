const API_BASE = 'http://localhost:5000/api';
let currentUser = null;

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

    // Remove after 3 seconds
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- View Management ---
function showView(viewId) {
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });
    const target = document.getElementById(viewId);
    if (target) {
        target.classList.add('active');
        // If switching to dashboard, fetch data
        if (viewId === 'dashboard-view') {
            fetchStocks();
            if (currentUser) fetchPortfolio();
        }
    }
    // Update navbar state
    updateNavbar();
    window.scrollTo(0, 0);
}

function updateNavbar() {
    const guestNav = document.getElementById('guest-nav');
    const userNav = document.getElementById('user-nav');
    
    if (currentUser) {
        guestNav.classList.add('hidden');
        userNav.classList.remove('hidden');
        document.getElementById('nav-user-balance').textContent = `$${currentUser.balance.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
        document.getElementById('nav-user-initials').textContent = getInitials(currentUser.full_name || currentUser.username);
        
        // Update dashboard welcome name
        const welcomeName = document.getElementById('user-full-name');
        if (welcomeName) welcomeName.textContent = currentUser.full_name || currentUser.username;
    } else {
        guestNav.classList.remove('hidden');
        userNav.classList.add('hidden');
    }
}

function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
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
            showView('auth-login');
            // Show success message or just switch to login
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
            } else {
                localStorage.removeItem('user_id');
            }
        } catch (e) {
            console.error("Auth check failed");
        }
    }
}

// --- Data Fetching ---
async function fetchStocks() {
    try {
        const response = await fetch(`${API_BASE}/stocks`);
        const stocks = await response.json();
        renderStocks(stocks);
    } catch (error) {
        console.error('Error fetching stocks:', error);
    }
}

async function fetchPortfolio() {
    if (!currentUser) return;
    try {
        const response = await fetch(`${API_BASE}/portfolio/${currentUser.user_id}`);
        const portfolio = await response.json();
        renderPortfolio(portfolio);
    } catch (error) {
        console.error('Error fetching portfolio:', error);
    }
}

// --- UI Helpers ---
function renderStocks(stocks) {
    const list = document.getElementById('stock-list');
    list.innerHTML = '';
    stocks.forEach(stock => {
        const item = document.createElement('div');
        item.className = 'stock-item';
        item.innerHTML = `
            <div class="stock-info">
                <h3>${stock.symbol}</h3>
                <p>${stock.name}</p>
            </div>
            <div class="stock-price">
                <p class="price">$${stock.price.toFixed(2)}</p>
                <p class="change up">+1.2%</p>
            </div>
        `;
        list.appendChild(item);
    });
}

function renderPortfolio(portfolio) {
    const list = document.getElementById('portfolio-list');
    list.innerHTML = '';
    if (portfolio.length === 0) {
        list.innerHTML = '<p class="empty-msg">No holdings yet. Start trading!</p>';
        return;
    }
    portfolio.forEach(item => {
        const div = document.createElement('div');
        div.className = 'portfolio-item';
        div.innerHTML = `
            <div class="stock-info">
                <h3>${item.symbol}</h3>
                <p>${item.quantity} Shares</p>
            </div>
            <div class="stock-price">
                <p class="price">$${(item.quantity * item.avg_price).toFixed(2)}</p>
                <p class="change up">Avg: $${item.avg_price.toFixed(2)}</p>
            </div>
        `;
        list.appendChild(div);
    });
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
    
    // Initialize icons
    if (window.lucide) lucide.createIcons();
});
