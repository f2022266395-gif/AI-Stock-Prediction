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
        // View-specific data loading
        if (viewId === 'dashboard-view') {
            fetchStocks();
            if (currentUser) fetchPortfolio();
        } else if (viewId === 'profile-view') {
            loadProfileData();
        }
        
        // Update active tab highlighting
        setActiveTab(viewId);
    }
    // Update navbar state
    updateNavbar();
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
        
        // Update dashboard welcome name
        const welcomeName = document.getElementById('user-full-name');
        if (welcomeName) welcomeName.textContent = currentUser.full_name || currentUser.username;
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
            } else {
                localStorage.removeItem('user_id');
            }
        } catch (e) {
            console.error("Auth check failed");
        }
    }
}

// --- Profile Management ---
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
            currentUser = data; // Update local state
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
    document.getElementById('profile-form')?.addEventListener('submit', handleProfileUpdate);
    document.getElementById('password-form')?.addEventListener('submit', handlePasswordUpdate);
    
    // Initialize icons
    if (window.lucide) lucide.createIcons();
});
