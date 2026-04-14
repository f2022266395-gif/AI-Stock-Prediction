const API_BASE = 'http://localhost:5000/api';
const DEFAULT_USER_ID = 1; // Simulation default user

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
    try {
        const response = await fetch(`${API_BASE}/portfolio/${DEFAULT_USER_ID}`);
        const portfolio = await response.json();
        renderPortfolio(portfolio);
    } catch (error) {
        console.error('Error fetching portfolio:', error);
    }
}

async function fetchUser() {
    try {
        const response = await fetch(`${API_BASE}/user/${DEFAULT_USER_ID}`);
        const user = await response.json();
        document.getElementById('user-balance').textContent = `$${user.balance.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    } catch (error) {
        console.error('Error fetching user:', error);
    }
}

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
    if (portfolio.length === 0) return;
    
    list.innerHTML = '';
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
                <p class="change ${item.avg_price > 0 ? 'up' : 'down'}">Avg: $${item.avg_price.toFixed(2)}</p>
            </div>
        `;
        list.appendChild(div);
    });
}

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
    fetchStocks();
    fetchPortfolio();
    fetchUser();
});
