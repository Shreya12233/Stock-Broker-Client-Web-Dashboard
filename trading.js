// Pure(ish) trading logic, separated for unit testing.

const SUPPORTED_STOCKS = ["GOOG", "TSLA", "AMZN", "META", "NVDA"];
const STARTING_CASH = 10000;

function createSession() {
  return {
    email: null,
    subscriptions: new Set(),
    cash: STARTING_CASH,
    holdings: {}, // ticker -> shares
    history: [],  // [{ ticker, action, shares, price, total, time }]
    alerts: {},   // ticker -> { above?: number, below?: number }
    orders: [],   // [{ id, ticker, action, shares, condition, target, createdAt }]
  };
}

function portfolioSnapshot(session, prices) {
  let holdingsValue = 0;
  const holdings = {};
  for (const [ticker, shares] of Object.entries(session.holdings)) {
    if (shares > 0) {
      holdings[ticker] = { shares, value: shares * prices[ticker] };
      holdingsValue += shares * prices[ticker];
    }
  }
  return {
    cash: session.cash,
    holdings,
    totalValue: session.cash + holdingsValue,
    pnl: session.cash + holdingsValue - STARTING_CASH,
  };
}

/**
 * Executes a trade against a session.
 * Returns { ok: true, trade } on success, or { ok: false, error } on failure.
 * Mutates session in place on success.
 */
function executeTrade(session, prices, { ticker, action, shares }) {
  if (!SUPPORTED_STOCKS.includes(ticker)) {
    return { ok: false, error: `Unsupported ticker: ${ticker}` };
  }
  shares = Number(shares);
  if (!Number.isFinite(shares) || shares <= 0 || Math.floor(shares) !== shares) {
    return { ok: false, error: "Shares must be a positive whole number." };
  }

  const price = prices[ticker];
  const total = price * shares;

  if (action === "buy") {
    if (total > session.cash) {
      return { ok: false, error: `Insufficient cash to buy ${shares} ${ticker}.` };
    }
    session.cash -= total;
    session.holdings[ticker] = (session.holdings[ticker] || 0) + shares;
  } else if (action === "sell") {
    const owned = session.holdings[ticker] || 0;
    if (shares > owned) {
      return { ok: false, error: `You only own ${owned} shares of ${ticker}.` };
    }
    session.cash += total;
    session.holdings[ticker] -= shares;
  } else {
    return { ok: false, error: `Unknown action: ${action}` };
  }

  const trade = { ticker, action, shares, price, total, time: Date.now() };
  session.history.unshift(trade);
  if (session.history.length > 50) session.history.pop();

  return { ok: true, trade };
}

/**
 * Sets a price alert for a ticker.
 * direction: "above" | "below"
 */
function setAlert(session, { ticker, direction, target }) {
  if (!SUPPORTED_STOCKS.includes(ticker)) {
    return { ok: false, error: `Unsupported ticker: ${ticker}` };
  }
  target = Number(target);
  if (!Number.isFinite(target) || target <= 0) {
    return { ok: false, error: "Target price must be a positive number." };
  }
  if (direction !== "above" && direction !== "below") {
    return { ok: false, error: "Direction must be 'above' or 'below'." };
  }
  if (!session.alerts[ticker]) session.alerts[ticker] = {};
  session.alerts[ticker][direction] = target;
  return { ok: true };
}

function clearAlert(session, { ticker, direction }) {
  if (session.alerts[ticker]) {
    delete session.alerts[ticker][direction];
    if (Object.keys(session.alerts[ticker]).length === 0) {
      delete session.alerts[ticker];
    }
  }
}

/**
 * Checks all alerts for a session against current prices.
 * Returns a list of triggered alerts and removes them (one-shot alerts).
 */
function checkAlerts(session, prices) {
  const triggered = [];
  for (const [ticker, dirs] of Object.entries(session.alerts)) {
    const price = prices[ticker];
    if (dirs.above !== undefined && price >= dirs.above) {
      triggered.push({ ticker, direction: "above", target: dirs.above, price });
      delete dirs.above;
    }
    if (dirs.below !== undefined && price <= dirs.below) {
      triggered.push({ ticker, direction: "below", target: dirs.below, price });
      delete dirs.below;
    }
    if (Object.keys(dirs).length === 0) delete session.alerts[ticker];
  }
  return triggered;
}

/**
 * Places a conditional (limit/stop) order. It sits pending until the price
 * crosses `target` in the direction given by `condition`:
 *  - condition "lte" fires when price <= target (e.g. "buy the dip" or "stop-loss sell")
 *  - condition "gte" fires when price >= target (e.g. "take-profit sell" or "breakout buy")
 * Returns { ok: true, order } on success, or { ok: false, error } on failure.
 */
function placeOrder(session, prices, { ticker, action, shares, condition, target }) {
  if (!SUPPORTED_STOCKS.includes(ticker)) {
    return { ok: false, error: `Unsupported ticker: ${ticker}` };
  }
  if (action !== "buy" && action !== "sell") {
    return { ok: false, error: "Action must be 'buy' or 'sell'." };
  }
  shares = Number(shares);
  if (!Number.isFinite(shares) || shares <= 0 || Math.floor(shares) !== shares) {
    return { ok: false, error: "Shares must be a positive whole number." };
  }
  target = Number(target);
  if (!Number.isFinite(target) || target <= 0) {
    return { ok: false, error: "Target price must be a positive number." };
  }
  if (condition !== "lte" && condition !== "gte") {
    return { ok: false, error: "Condition must be 'lte' or 'gte'." };
  }
  if (action === "sell") {
    const owned = session.holdings[ticker] || 0;
    const pendingSell = session.orders
      .filter((o) => o.ticker === ticker && o.action === "sell")
      .reduce((sum, o) => sum + o.shares, 0);
    if (shares + pendingSell > owned) {
      return { ok: false, error: `You only own ${owned} shares of ${ticker} (${pendingSell} already reserved by pending orders).` };
    }
  } else {
    const cost = target * shares;
    const pendingBuyCost = session.orders
      .filter((o) => o.action === "buy")
      .reduce((sum, o) => sum + o.target * o.shares, 0);
    if (cost + pendingBuyCost > session.cash) {
      return { ok: false, error: "Insufficient cash to reserve for this order alongside your other pending orders." };
    }
  }

  const order = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ticker,
    action,
    shares,
    condition,
    target,
    createdAt: Date.now(),
  };
  session.orders.push(order);
  return { ok: true, order };
}

/**
 * Cancels a pending order by id.
 */
function cancelOrder(session, orderId) {
  const idx = session.orders.findIndex((o) => o.id === orderId);
  if (idx === -1) {
    return { ok: false, error: "Order not found." };
  }
  session.orders.splice(idx, 1);
  return { ok: true };
}

/**
 * Checks all pending orders against current prices. Any order whose
 * condition is met is executed as a trade (filled) or, if it can no longer
 * be carried out (e.g. shares sold elsewhere), cancelled with a reason.
 * Mutates session in place. Returns { filled: [...], cancelled: [...] }.
 */
function checkOrders(session, prices) {
  const filled = [];
  const cancelled = [];
  const remaining = [];

  for (const order of session.orders) {
    const price = prices[order.ticker];
    const met = order.condition === "lte" ? price <= order.target : price >= order.target;
    if (!met) {
      remaining.push(order);
      continue;
    }
    const result = executeTrade(session, prices, {
      ticker: order.ticker,
      action: order.action,
      shares: order.shares,
    });
    if (result.ok) {
      filled.push({ order, trade: result.trade });
    } else {
      cancelled.push({ order, reason: result.error });
    }
  }

  session.orders = remaining;
  return { filled, cancelled };
}

module.exports = {
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
};
