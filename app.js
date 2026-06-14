// ===== State =====
let currentEmail = null;
let startingCash = 10000;
const lastPrices = {};
const priceHistories = {};
const subscribedTickers = new Set();
let portfolio = { cash: 0, holdings: {}, totalValue: 0, pnl: 0 };
let activeTradeTicker = null;
const HISTORY_MAX = 60;

// ===== DOM refs =====
const loginScreen    = document.getElementById("login-screen");
const dashScreen     = document.getElementById("dashboard-screen");
const emailInput     = document.getElementById("email-input");
const loginBtn       = document.getElementById("login-btn");
const connStatus     = document.getElementById("conn-status");
const connStatusDash = document.getElementById("conn-status-dash");
const userEmailEl    = document.getElementById("user-email");
const logoutBtn      = document.getElementById("logout-btn");
const themeToggle    = document.getElementById("theme-toggle");
const tickerSelect   = document.getElementById("ticker-select");
const subscribeBtn   = document.getElementById("subscribe-btn");
const tickerGrid     = document.getElementById("ticker-grid");
const emptyState     = document.getElementById("empty-state");
const statCash       = document.getElementById("stat-cash");
const statTotal      = document.getElementById("stat-total");
const statPnl        = document.getElementById("stat-pnl");
const tradeModal     = document.getElementById("trade-modal");
const tradeModalTitle= document.getElementById("trade-modal-title");
const tradeModalClose= document.getElementById("trade-modal-close");
const tradePriceEl   = document.getElementById("trade-price");
const tradeOwnedEl   = document.getElementById("trade-owned");
const tradeShares    = document.getElementById("trade-shares");
const tradeCostPrev  = document.getElementById("trade-cost-preview");
const tradeError     = document.getElementById("trade-error");
const tradeBuyBtn    = document.getElementById("trade-buy-btn");
const tradeSellBtn   = document.getElementById("trade-sell-btn");
const historyTable   = document.getElementById("history-table");
const historyBody    = document.getElementById("history-body");
const historyEmpty   = document.getElementById("history-empty");
const alertTicker    = document.getElementById("alert-ticker");
const alertDirection = document.getElementById("alert-direction");
const alertTarget    = document.getElementById("alert-target");
const alertAddBtn    = document.getElementById("alert-add-btn");
const alertsEmpty    = document.getElementById("alerts-empty");
const alertsList     = document.getElementById("alerts-list");
const toastContainer = document.getElementById("toast-container");
const tapeTrack      = document.getElementById("tape-track");
const allocationCanvas = document.getElementById("allocation-chart");
const allocationLegend = document.getElementById("allocation-legend");
const orderTicker    = document.getElementById("order-ticker");
const orderAction    = document.getElementById("order-action");
const orderShares    = document.getElementById("order-shares");
const orderCondition = document.getElementById("order-condition");
const orderTarget    = document.getElementById("order-target");
const orderAddBtn    = document.getElementById("order-add-btn");
const orderError     = document.getElementById("order-error");
const ordersEmpty    = document.getElementById("orders-empty");
const ordersList     = document.getElementById("orders-list");
const leaderboardEmpty = document.getElementById("leaderboard-empty");
const leaderboardTable = document.getElementById("leaderboard-table");
const leaderboardBody  = document.getElementById("leaderboard-body");
const lastTapePrices = {};

// ===== Theme toggle =====
let isDark = true;
themeToggle.addEventListener("click", () => {
  isDark = !isDark;
  document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
  themeToggle.textContent = isDark ? "🌙" : "☀️";
});

// ===== Tabs =====
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
  });
});

// ===== Socket =====
const socket = io();

socket.on("connect", () => {
  connStatus.textContent = "● Connected";
  connStatus.className = "status status-live";
  connStatusDash.textContent = "● Live";
  connStatusDash.className = "status status-live";
});
socket.on("disconnect", () => {
  connStatus.textContent = "● Disconnected";
  connStatus.className = "status status-error";
  connStatusDash.textContent = "● Disconnected";
  connStatusDash.className = "status status-error";
});

socket.on("login_success", ({ email, supported, startingCash: sc }) => {
  currentEmail = email;
  startingCash = sc;
  userEmailEl.textContent = email;
  populateTickerSelect(supported);
  populateAlertTicker(supported);
  populateOrderTicker(supported);
  buildTape(supported);
  showScreen("dashboard");
});

socket.on("market_tape", (payload) => updateTape(payload));

socket.on("orders_update", (orders) => renderOrders(orders));
socket.on("order_error", ({ message }) => { orderError.textContent = message; });
socket.on("orders_executed", ({ filled, cancelled }) => {
  filled.forEach(({ order, trade }) => {
    showToast(
      `✅ Order filled: ${trade.action.toUpperCase()} ${trade.shares} ${order.ticker} @ $${trade.price.toFixed(2)}`,
      "success"
    );
  });
  cancelled.forEach(({ order, reason }) => {
    showToast(`⚠️ Order for ${order.ticker} cancelled: ${reason}`, "error");
  });
});

socket.on("leaderboard_update", (rows) => renderLeaderboard(rows));

socket.on("price_update", (payload) => {
  Object.entries(payload).forEach(([ticker, price]) => {
    pushHistory(ticker, price);
    updateTickerCard(ticker, price);
    if (activeTradeTicker === ticker) updateTradeModalPrice(price);
  });
});

socket.on("price_history", ({ ticker, history }) => {
  priceHistories[ticker] = history.map((h) => h.p).slice(-HISTORY_MAX);
  drawSparkline(ticker);
});

socket.on("subscriptions", (subs) => {
  subscribedTickers.clear();
  subs.forEach((s) => subscribedTickers.add(s));
  syncGridWithSubscriptions();
  refreshTickerSelectOptions();
});

socket.on("portfolio_update", (p) => {
  portfolio = p;
  renderPortfolio();
  refreshHoldingLabels();
  drawAllocationChart();
});

socket.on("trade_history", (history) => renderHistory(history));

socket.on("trade_error", ({ message }) => { tradeError.textContent = message; });
socket.on("trade_success", () => { tradeError.textContent = ""; closeTradeModal(); });

socket.on("alerts_update", (alerts) => renderAlerts(alerts));

socket.on("alerts_triggered", (triggered) => {
  triggered.forEach(({ ticker, direction, target, price }) => {
    showToast(
      `🔔 Alert: ${ticker} ${direction === "above" ? "▲" : "▼"} $${target.toFixed(2)} — now $${price.toFixed(2)}`,
      "alert"
    );
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(`${ticker} price alert`, {
        body: `${ticker} is now $${price.toFixed(2)} (${direction} your $${target.toFixed(2)} target)`,
      });
    }
  });
});

// ===== Screen =====
function showScreen(name) {
  loginScreen.classList.toggle("active", name === "login");
  dashScreen.classList.toggle("active", name === "dashboard");
}

// ===== Login =====
function doLogin() {
  const email = emailInput.value.trim() || "guest";
  socket.emit("login", email);
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}
loginBtn.addEventListener("click", doLogin);
emailInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });

logoutBtn.addEventListener("click", () => {
  subscribedTickers.clear();
  tickerGrid.innerHTML = "";
  historyBody.innerHTML = "";
  historyTable.style.display = "none";
  historyEmpty.style.display = "block";
  alertsList.innerHTML = "";
  ordersList.innerHTML = "";
  ordersEmpty.style.display = "block";
  emptyState.style.display = "block";
  emailInput.value = "";
  showScreen("login");
});

// ===== Ticker select =====
function populateTickerSelect(supported) {
  tickerSelect.innerHTML = "";
  supported.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t; opt.textContent = t;
    tickerSelect.appendChild(opt);
  });
}
function populateAlertTicker(supported) {
  alertTicker.innerHTML = `<option value="">Ticker…</option>`;
  supported.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t; opt.textContent = t;
    alertTicker.appendChild(opt);
  });
}
function populateOrderTicker(supported) {
  orderTicker.innerHTML = "";
  supported.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t; opt.textContent = t;
    orderTicker.appendChild(opt);
  });
}
function refreshTickerSelectOptions() {
  Array.from(tickerSelect.options).forEach((opt) => {
    opt.disabled = subscribedTickers.has(opt.value);
  });
  const first = Array.from(tickerSelect.options).find((o) => !o.disabled);
  if (first) tickerSelect.value = first.value;
}

// ===== Subscribe / unsubscribe =====
subscribeBtn.addEventListener("click", () => {
  const ticker = tickerSelect.value;
  if (!ticker || subscribedTickers.has(ticker)) return;
  socket.emit("subscribe", ticker);
});
function unsubscribe(ticker) {
  socket.emit("unsubscribe", ticker);
  document.getElementById(`ticker-${ticker}`)?.remove();
  delete lastPrices[ticker];
  delete priceHistories[ticker];
  toggleEmptyState();
}

// ===== Grid =====
function syncGridWithSubscriptions() {
  Array.from(tickerGrid.children).forEach((card) => {
    if (!subscribedTickers.has(card.dataset.ticker)) card.remove();
  });
  subscribedTickers.forEach((ticker) => {
    if (!document.getElementById(`ticker-${ticker}`)) {
      tickerGrid.appendChild(createTickerCard(ticker));
    }
  });
  toggleEmptyState();
}
function toggleEmptyState() {
  emptyState.style.display = subscribedTickers.size === 0 ? "block" : "none";
}
function createTickerCard(ticker) {
  const card = document.createElement("div");
  card.className = "ticker-card";
  card.id = `ticker-${ticker}`;
  card.dataset.ticker = ticker;
  card.innerHTML = `
    <div class="ticker-left">
      <span class="ticker-symbol">${ticker}</span>
      <span class="ticker-delta" id="delta-${ticker}"></span>
    </div>
    <canvas class="ticker-sparkline" id="spark-${ticker}" width="220" height="36"></canvas>
    <div class="ticker-right">
      <div class="ticker-price-block">
        <span class="ticker-price" id="price-${ticker}">—</span>
        <span class="ticker-holding" id="holding-${ticker}"></span>
      </div>
      <button class="btn-trade" data-ticker="${ticker}">Trade</button>
      <button class="ticker-remove" aria-label="Unsubscribe">✕</button>
    </div>`;
  card.querySelector(".ticker-remove").addEventListener("click", () => unsubscribe(ticker));
  card.querySelector(".btn-trade").addEventListener("click", () => openTradeModal(ticker));
  return card;
}
function updateTickerCard(ticker, price) {
  const priceEl = document.getElementById(`price-${ticker}`);
  const deltaEl = document.getElementById(`delta-${ticker}`);
  if (!priceEl) return;
  const prev = lastPrices[ticker];
  priceEl.textContent = `$${price.toFixed(2)}`;
  if (prev !== undefined) {
    const diff = price - prev;
    const up = diff >= 0;
    deltaEl.textContent = `${up ? "▲" : "▼"} ${up ? "+" : ""}${diff.toFixed(2)}`;
    deltaEl.className = `ticker-delta ${up ? "up" : "down"}`;
    priceEl.className = `ticker-price ${up ? "flash-up" : "flash-down"}`;
    setTimeout(() => { priceEl.className = "ticker-price"; }, 400);
  }
  lastPrices[ticker] = price;
  drawSparkline(ticker);
}

// ===== Sparkline =====
function pushHistory(ticker, price) {
  if (!priceHistories[ticker]) priceHistories[ticker] = [];
  priceHistories[ticker].push(price);
  if (priceHistories[ticker].length > HISTORY_MAX) priceHistories[ticker].shift();
}
function drawSparkline(ticker) {
  const canvas = document.getElementById(`spark-${ticker}`);
  if (!canvas) return;
  const history = priceHistories[ticker];
  if (!history || history.length < 2) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const min = Math.min(...history), max = Math.max(...history);
  const range = max - min || 1;
  const up = history[history.length - 1] >= history[0];
  ctx.strokeStyle = up ? "#5fd4a0" : "#f17a6b";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  history.forEach((p, i) => {
    const x = (i / (history.length - 1)) * w;
    const y = h - ((p - min) / range) * (h - 4) - 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ===== Portfolio =====
function renderPortfolio() {
  statCash.textContent = `$${portfolio.cash.toFixed(2)}`;
  statTotal.textContent = `$${portfolio.totalValue.toFixed(2)}`;
  const pnl = portfolio.pnl;
  statPnl.textContent = `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`;
  statPnl.className = `stat-value ${pnl >= 0 ? "up" : "down"}`;
}
function refreshHoldingLabels() {
  Object.keys(lastPrices).forEach((ticker) => {
    const el = document.getElementById(`holding-${ticker}`);
    if (!el) return;
    const h = portfolio.holdings[ticker];
    el.textContent = h ? `${h.shares} sh · $${h.value.toFixed(2)}` : "";
  });
}

// ===== Trade history =====
function renderHistory(history) {
  if (!history || history.length === 0) {
    historyTable.style.display = "none";
    historyEmpty.style.display = "block";
    return;
  }
  historyEmpty.style.display = "none";
  historyTable.style.display = "table";
  historyBody.innerHTML = history.map((t) => {
    const d = new Date(t.time);
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return `<tr>
      <td>${time}</td>
      <td>${t.ticker}</td>
      <td class="badge-${t.action}">${t.action.toUpperCase()}</td>
      <td>${t.shares}</td>
      <td>$${t.price.toFixed(2)}</td>
      <td>$${t.total.toFixed(2)}</td>
    </tr>`;
  }).join("");
}

// ===== Trade modal =====
function updateTradeModalPrice(price) {
  tradePriceEl.textContent = `$${price.toFixed(2)}`;
  updateCostPreview(price);
}
function updateCostPreview(price) {
  const shares = Number(tradeShares.value);
  if (shares > 0 && price > 0) {
    tradeCostPrev.textContent = `Estimated cost: $${(price * shares).toFixed(2)}`;
  } else {
    tradeCostPrev.textContent = "";
  }
}
function openTradeModal(ticker) {
  activeTradeTicker = ticker;
  tradeModalTitle.textContent = `Trade ${ticker}`;
  const price = lastPrices[ticker] || 0;
  updateTradeModalPrice(price);
  const h = portfolio.holdings[ticker];
  tradeOwnedEl.textContent = `${h ? h.shares : 0} shares`;
  tradeShares.value = 1;
  tradeError.textContent = "";
  tradeModal.classList.add("active");
}
function closeTradeModal() {
  tradeModal.classList.remove("active");
  activeTradeTicker = null;
}
tradeShares.addEventListener("input", () => {
  if (activeTradeTicker) updateCostPreview(lastPrices[activeTradeTicker] || 0);
});
tradeModalClose.addEventListener("click", closeTradeModal);
tradeModal.addEventListener("click", (e) => { if (e.target === tradeModal) closeTradeModal(); });
tradeBuyBtn.addEventListener("click", () => {
  if (!activeTradeTicker) return;
  socket.emit("trade", { ticker: activeTradeTicker, action: "buy", shares: Number(tradeShares.value) });
});
tradeSellBtn.addEventListener("click", () => {
  if (!activeTradeTicker) return;
  socket.emit("trade", { ticker: activeTradeTicker, action: "sell", shares: Number(tradeShares.value) });
});

// ===== Price alerts =====
alertAddBtn.addEventListener("click", () => {
  const ticker = alertTicker.value;
  const direction = alertDirection.value;
  const target = parseFloat(alertTarget.value);
  if (!ticker || !target || target <= 0) return;
  socket.emit("set_alert", { ticker, direction, target });
  alertTarget.value = "";
});
function renderAlerts(alerts) {
  const entries = [];
  Object.entries(alerts).forEach(([ticker, dirs]) => {
    Object.entries(dirs).forEach(([dir, target]) => {
      entries.push({ ticker, dir, target });
    });
  });
  if (entries.length === 0) {
    alertsEmpty.style.display = "block";
    alertsList.innerHTML = "";
    return;
  }
  alertsEmpty.style.display = "none";
  alertsList.innerHTML = entries.map(({ ticker, dir, target }) => `
    <div class="alert-item">
      <div class="alert-item-left">
        <span class="ticker-symbol">${ticker}</span>
        <span class="alert-badge-${dir}">${dir === "above" ? "▲" : "▼"} ${dir}</span>
        <span>$${Number(target).toFixed(2)}</span>
      </div>
      <button class="ticker-remove" onclick="clearAlert('${ticker}','${dir}')">✕</button>
    </div>`).join("");
}
window.clearAlert = (ticker, direction) => {
  socket.emit("clear_alert", { ticker, direction });
};

// ===== Toast =====
function showToast(message, type = "success") {
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = message;
  toastContainer.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ===== Market tape =====
function buildTape(supported) {
  tapeTrack.innerHTML = supported.map((t) => `
    <span class="tape-item" id="tape-${t}">
      <span class="tape-symbol">${t}</span>
      <span class="tape-price" id="tape-price-${t}">—</span>
    </span>`).join("");
}
function updateTape(payload) {
  Object.entries(payload).forEach(([ticker, price]) => {
    const priceEl = document.getElementById(`tape-price-${ticker}`);
    if (!priceEl) return;
    const prev = lastTapePrices[ticker];
    priceEl.textContent = `$${price.toFixed(2)}`;
    if (prev !== undefined && prev !== price) {
      const up = price >= prev;
      priceEl.className = `tape-price ${up ? "up" : "down"}`;
    }
    lastTapePrices[ticker] = price;
  });
}

// ===== Portfolio allocation donut chart =====
const ALLOCATION_COLORS = ["#caa46f", "#5fd4a0", "#f17a6b", "#7c93d4", "#c47fd0", "#7fd0c4"];
function drawAllocationChart() {
  if (!allocationCanvas) return;
  const ctx = allocationCanvas.getContext("2d");
  const w = allocationCanvas.width, h = allocationCanvas.height;
  ctx.clearRect(0, 0, w, h);

  const slices = [{ label: "Cash", value: portfolio.cash || 0, color: "#3a3f52" }];
  Object.entries(portfolio.holdings || {}).forEach(([ticker, h], i) => {
    slices.push({ label: ticker, value: h.value, color: ALLOCATION_COLORS[i % ALLOCATION_COLORS.length] });
  });
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 2;
  if (total <= 0) {
    ctx.strokeStyle = "#44485a";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 3, 0, Math.PI * 2);
    ctx.stroke();
    allocationLegend.innerHTML = "";
    return;
  }

  let start = -Math.PI / 2;
  slices.forEach((s) => {
    if (s.value <= 0) return;
    const angle = (s.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
    start += angle;
  });
  // donut hole
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  allocationLegend.innerHTML = slices
    .filter((s) => s.value > 0)
    .map((s) => {
      const pct = ((s.value / total) * 100).toFixed(0);
      return `<span class="legend-item"><span class="legend-dot" style="background:${s.color}"></span>${s.label} ${pct}%</span>`;
    })
    .join("");
}

// ===== Limit / stop orders =====
orderAddBtn.addEventListener("click", () => {
  const ticker = orderTicker.value;
  const action = orderAction.value;
  const condition = orderCondition.value;
  const shares = Number(orderShares.value);
  const target = parseFloat(orderTarget.value);
  orderError.textContent = "";
  if (!ticker || !shares || shares <= 0 || !target || target <= 0) {
    orderError.textContent = "Enter a valid number of shares and target price.";
    return;
  }
  socket.emit("place_order", { ticker, action, shares, condition, target });
  orderTarget.value = "";
});
function renderOrders(orders) {
  if (!orders || orders.length === 0) {
    ordersEmpty.style.display = "block";
    ordersList.innerHTML = "";
    return;
  }
  ordersEmpty.style.display = "none";
  ordersList.innerHTML = orders.map((o) => {
    const verb = o.condition === "lte" ? "drops to/below" : "rises to/above";
    return `<div class="alert-item">
      <div class="alert-item-left">
        <span class="ticker-symbol">${o.ticker}</span>
        <span class="badge-${o.action}">${o.action.toUpperCase()}</span>
        <span>${o.shares} sh when price ${verb} $${Number(o.target).toFixed(2)}</span>
      </div>
      <button class="ticker-remove" onclick="cancelOrder('${o.id}')">✕</button>
    </div>`;
  }).join("");
}
window.cancelOrder = (orderId) => {
  socket.emit("cancel_order", { orderId });
};

// ===== Leaderboard =====
function renderLeaderboard(rows) {
  if (!rows || rows.length === 0) {
    leaderboardEmpty.style.display = "block";
    leaderboardTable.style.display = "none";
    return;
  }
  leaderboardEmpty.style.display = "none";
  leaderboardTable.style.display = "table";
  leaderboardBody.innerHTML = rows.map((r, i) => {
    const pnlClass = r.pnl >= 0 ? "up" : "down";
    const youTag = r.email === currentEmail ? ' <span class="you-tag">you</span>' : "";
    return `<tr>
      <td>#${i + 1}</td>
      <td>${escapeHtml(r.email)}${youTag}</td>
      <td>$${r.totalValue.toFixed(2)}</td>
      <td class="${pnlClass}">${r.pnl >= 0 ? "+" : ""}$${r.pnl.toFixed(2)}</td>
      <td>${r.online ? '<span class="status status-live">● Online</span>' : '<span class="status status-pending">○ Offline</span>'}</td>
    </tr>`;
  }).join("");
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
