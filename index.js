const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const {
  SUPPORTED_STOCKS,
  STARTING_CASH,
  createSession,
  portfolioSnapshot,
  executeTrade,
  setAlert,
  clearAlert,
  checkAlerts,
  placeOrder,
  cancelOrder,
  checkOrders,
} = require("./trading");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ---- Seed prices ----
const prices = {
  GOOG: 175.0,
  TSLA: 245.0,
  AMZN: 198.0,
  META: 512.0,
  NVDA: 135.0,
};

const HISTORY_LENGTH = 60; // seconds of price history kept server-side

// rolling price history per ticker: array of {t, p}
const priceHistory = {};
SUPPORTED_STOCKS.forEach((t) => (priceHistory[t] = [{ t: Date.now(), p: prices[t] }]));

// ---- Trading state, keyed by email — persists across reconnects/tabs ----
const portfolios = new Map(); // email -> trading state (see trading.createSession)

// ---- Ephemeral per-connection state ----
const connections = new Map(); // socket.id -> { email, subscriptions: Set<string> }

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/stocks", (req, res) => {
  res.json({ supported: SUPPORTED_STOCKS });
});

function onlineEmails() {
  const online = new Set();
  for (const conn of connections.values()) {
    if (conn.email) online.add(conn.email);
  }
  return online;
}

function buildLeaderboard() {
  const online = onlineEmails();
  return Array.from(portfolios.entries())
    .map(([email, state]) => {
      const snap = portfolioSnapshot(state, prices);
      return {
        email,
        totalValue: snap.totalValue,
        pnl: snap.pnl,
        online: online.has(email),
      };
    })
    .sort((a, b) => b.totalValue - a.totalValue);
}

function broadcastLeaderboard() {
  io.emit("leaderboard_update", buildLeaderboard());
}

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on("login", (email) => {
    const clean = (email && email.trim().toLowerCase()) || `guest-${socket.id.slice(0, 5)}`;

    let state = portfolios.get(clean);
    if (!state) {
      state = createSession();
      portfolios.set(clean, state);
    }

    connections.set(socket.id, { email: clean, subscriptions: new Set() });

    console.log(`User logged in: ${clean} (${socket.id})`);
    socket.emit("login_success", {
      email: clean,
      supported: SUPPORTED_STOCKS,
      startingCash: STARTING_CASH,
    });
    socket.emit("market_tape", prices);
    socket.emit("portfolio_update", portfolioSnapshot(state, prices));
    socket.emit("trade_history", state.history);
    socket.emit("alerts_update", state.alerts);
    socket.emit("orders_update", state.orders);
    broadcastLeaderboard();
  });

  socket.on("subscribe", (ticker) => {
    const conn = connections.get(socket.id);
    if (!conn || !SUPPORTED_STOCKS.includes(ticker)) return;
    conn.subscriptions.add(ticker);
    socket.emit("price_update", { [ticker]: prices[ticker] });
    socket.emit("price_history", { ticker, history: priceHistory[ticker] });
    socket.emit("subscriptions", Array.from(conn.subscriptions));
  });

  socket.on("unsubscribe", (ticker) => {
    const conn = connections.get(socket.id);
    if (!conn) return;
    conn.subscriptions.delete(ticker);
    socket.emit("subscriptions", Array.from(conn.subscriptions));
  });

  // ---- Buy / Sell (executes immediately at the current price) ----
  socket.on("trade", ({ ticker, action, shares }) => {
    const conn = connections.get(socket.id);
    if (!conn) return;
    const state = portfolios.get(conn.email);
    const result = executeTrade(state, prices, { ticker, action, shares });
    if (!result.ok) {
      socket.emit("trade_error", { message: result.error });
      return;
    }
    socket.emit("portfolio_update", portfolioSnapshot(state, prices));
    socket.emit("trade_history", state.history);
    socket.emit("trade_success", result.trade);
    broadcastLeaderboard();
  });

  // ---- Limit / stop orders ----
  socket.on("place_order", ({ ticker, action, shares, condition, target }) => {
    const conn = connections.get(socket.id);
    if (!conn) return;
    const state = portfolios.get(conn.email);
    const result = placeOrder(state, prices, { ticker, action, shares, condition, target });
    if (!result.ok) {
      socket.emit("order_error", { message: result.error });
      return;
    }
    socket.emit("orders_update", state.orders);
  });

  socket.on("cancel_order", ({ orderId }) => {
    const conn = connections.get(socket.id);
    if (!conn) return;
    const state = portfolios.get(conn.email);
    cancelOrder(state, orderId);
    socket.emit("orders_update", state.orders);
  });

  // ---- Price alerts ----
  socket.on("set_alert", ({ ticker, direction, target }) => {
    const conn = connections.get(socket.id);
    if (!conn) return;
    const state = portfolios.get(conn.email);
    const result = setAlert(state, { ticker, direction, target });
    if (!result.ok) {
      socket.emit("alert_error", { message: result.error });
      return;
    }
    socket.emit("alerts_update", state.alerts);
  });

  socket.on("clear_alert", ({ ticker, direction }) => {
    const conn = connections.get(socket.id);
    if (!conn) return;
    const state = portfolios.get(conn.email);
    clearAlert(state, { ticker, direction });
    socket.emit("alerts_update", state.alerts);
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    connections.delete(socket.id);
    broadcastLeaderboard();
  });
});

// ---- Price generator: runs every second ----
setInterval(() => {
  const now = Date.now();

  SUPPORTED_STOCKS.forEach((ticker) => {
    const delta = (Math.random() - 0.5) * (prices[ticker] * 0.01);
    prices[ticker] = Math.max(0.01, prices[ticker] + delta);

    const hist = priceHistory[ticker];
    hist.push({ t: now, p: prices[ticker] });
    if (hist.length > HISTORY_LENGTH) hist.shift();
  });

  // Market tape: every connected client gets every ticker, every tick —
  // regardless of subscriptions, so the top banner is always live.
  io.emit("market_tape", prices);

  let leaderboardDirty = false;

  for (const [socketId, conn] of connections.entries()) {
    const state = portfolios.get(conn.email);

    if (conn.subscriptions.size > 0) {
      const payload = {};
      conn.subscriptions.forEach((ticker) => {
        payload[ticker] = prices[ticker];
      });
      io.to(socketId).emit("price_update", payload);
    }

    // ---- Limit / stop orders fire before alerts so portfolio reflects fills ----
    const orderResults = checkOrders(state, prices);
    if (orderResults.filled.length > 0 || orderResults.cancelled.length > 0) {
      io.to(socketId).emit("orders_update", state.orders);
      io.to(socketId).emit("orders_executed", orderResults);
      io.to(socketId).emit("trade_history", state.history);
      leaderboardDirty = true;
    }

    if (Object.keys(state.holdings).length > 0) {
      io.to(socketId).emit("portfolio_update", portfolioSnapshot(state, prices));
    }

    if (Object.keys(state.alerts).length > 0) {
      const triggered = checkAlerts(state, prices);
      if (triggered.length > 0) {
        io.to(socketId).emit("alerts_triggered", triggered);
        io.to(socketId).emit("alerts_update", state.alerts);
      }
    }
  }

  if (leaderboardDirty || connections.size > 0) {
    broadcastLeaderboard();
  }
}, 1000);

server.listen(PORT, () => {
  console.log(`Stock Broker Dashboard server running on http://localhost:${PORT}`);
});
