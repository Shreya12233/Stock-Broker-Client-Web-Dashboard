const {
  createSession,
  portfolioSnapshot,
  executeTrade,
  setAlert,
  clearAlert,
  checkAlerts,
  placeOrder,
  cancelOrder,
  checkOrders,
  STARTING_CASH,
} = require("../server/trading");

const prices = {
  GOOG: 100,
  TSLA: 200,
  AMZN: 50,
  META: 300,
  NVDA: 10,
};

describe("createSession", () => {
  test("starts with default cash and no holdings", () => {
    const session = createSession();
    expect(session.cash).toBe(STARTING_CASH);
    expect(session.holdings).toEqual({});
    expect(session.history).toEqual([]);
    expect(session.alerts).toEqual({});
  });
});

describe("executeTrade - buy", () => {
  test("successful buy reduces cash and increases holdings", () => {
    const session = createSession();
    const result = executeTrade(session, prices, { ticker: "GOOG", action: "buy", shares: 10 });

    expect(result.ok).toBe(true);
    expect(session.cash).toBe(STARTING_CASH - 1000);
    expect(session.holdings.GOOG).toBe(10);
    expect(session.history[0]).toMatchObject({ ticker: "GOOG", action: "buy", shares: 10, price: 100, total: 1000 });
  });

  test("rejects buy when insufficient cash", () => {
    const session = createSession();
    const result = executeTrade(session, prices, { ticker: "META", action: "buy", shares: 1000 });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Insufficient cash/);
    expect(session.cash).toBe(STARTING_CASH);
    expect(session.holdings.META).toBeUndefined();
  });

  test("rejects unsupported ticker", () => {
    const session = createSession();
    const result = executeTrade(session, prices, { ticker: "FAKE", action: "buy", shares: 1 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unsupported ticker/);
  });

  test("rejects non-positive or non-integer shares", () => {
    const session = createSession();
    expect(executeTrade(session, prices, { ticker: "GOOG", action: "buy", shares: 0 }).ok).toBe(false);
    expect(executeTrade(session, prices, { ticker: "GOOG", action: "buy", shares: -5 }).ok).toBe(false);
    expect(executeTrade(session, prices, { ticker: "GOOG", action: "buy", shares: 1.5 }).ok).toBe(false);
  });
});

describe("executeTrade - sell", () => {
  test("successful sell increases cash and decreases holdings", () => {
    const session = createSession();
    executeTrade(session, prices, { ticker: "GOOG", action: "buy", shares: 10 });
    const result = executeTrade(session, prices, { ticker: "GOOG", action: "sell", shares: 4 });

    expect(result.ok).toBe(true);
    expect(session.holdings.GOOG).toBe(6);
    expect(session.cash).toBe(STARTING_CASH - 1000 + 400);
  });

  test("rejects selling more shares than owned", () => {
    const session = createSession();
    executeTrade(session, prices, { ticker: "GOOG", action: "buy", shares: 5 });
    const result = executeTrade(session, prices, { ticker: "GOOG", action: "sell", shares: 10 });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/only own 5 shares/);
    expect(session.holdings.GOOG).toBe(5); // unchanged
  });

  test("rejects selling stock never owned", () => {
    const session = createSession();
    const result = executeTrade(session, prices, { ticker: "NVDA", action: "sell", shares: 1 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/only own 0 shares/);
  });
});

describe("portfolioSnapshot", () => {
  test("reflects cash, holdings value, total value and P&L", () => {
    const session = createSession();
    executeTrade(session, prices, { ticker: "GOOG", action: "buy", shares: 10 }); // -1000
    executeTrade(session, prices, { ticker: "NVDA", action: "buy", shares: 50 }); // -500

    const snap = portfolioSnapshot(session, prices);

    expect(snap.cash).toBe(STARTING_CASH - 1500);
    expect(snap.holdings.GOOG).toEqual({ shares: 10, value: 1000 });
    expect(snap.holdings.NVDA).toEqual({ shares: 50, value: 500 });
    expect(snap.totalValue).toBe(STARTING_CASH); // no price movement yet
    expect(snap.pnl).toBe(0);
  });

  test("P&L reflects price movement", () => {
    const session = createSession();
    executeTrade(session, prices, { ticker: "GOOG", action: "buy", shares: 10 }); // -1000

    const movedPrices = { ...prices, GOOG: 150 }; // +50 per share
    const snap = portfolioSnapshot(session, movedPrices);

    expect(snap.holdings.GOOG.value).toBe(1500);
    expect(snap.pnl).toBe(500); // gained 500 vs starting cash
  });
});

describe("price alerts", () => {
  test("setAlert validates ticker, target and direction", () => {
    const session = createSession();
    expect(setAlert(session, { ticker: "GOOG", direction: "above", target: 150 }).ok).toBe(true);
    expect(setAlert(session, { ticker: "FAKE", direction: "above", target: 150 }).ok).toBe(false);
    expect(setAlert(session, { ticker: "GOOG", direction: "sideways", target: 150 }).ok).toBe(false);
    expect(setAlert(session, { ticker: "GOOG", direction: "above", target: -1 }).ok).toBe(false);
  });

  test("checkAlerts triggers when price crosses threshold and clears it (one-shot)", () => {
    const session = createSession();
    setAlert(session, { ticker: "GOOG", direction: "above", target: 105 });

    let triggered = checkAlerts(session, { ...prices, GOOG: 100 });
    expect(triggered).toEqual([]);

    triggered = checkAlerts(session, { ...prices, GOOG: 110 });
    expect(triggered).toEqual([{ ticker: "GOOG", direction: "above", target: 105, price: 110 }]);

    // alert consumed - no longer triggers
    triggered = checkAlerts(session, { ...prices, GOOG: 120 });
    expect(triggered).toEqual([]);
  });

  test("checkAlerts handles 'below' direction", () => {
    const session = createSession();
    setAlert(session, { ticker: "NVDA", direction: "below", target: 8 });

    let triggered = checkAlerts(session, { ...prices, NVDA: 10 });
    expect(triggered).toEqual([]);

    triggered = checkAlerts(session, { ...prices, NVDA: 7 });
    expect(triggered).toEqual([{ ticker: "NVDA", direction: "below", target: 8, price: 7 }]);
  });

  test("clearAlert removes a pending alert", () => {
    const session = createSession();
    setAlert(session, { ticker: "GOOG", direction: "above", target: 105 });
    clearAlert(session, { ticker: "GOOG", direction: "above" });

    const triggered = checkAlerts(session, { ...prices, GOOG: 110 });
    expect(triggered).toEqual([]);
    expect(session.alerts.GOOG).toBeUndefined();
  });
});

describe("limit / stop orders", () => {
  test("placeOrder validates ticker, action, shares, condition and target", () => {
    const session = createSession();
    expect(placeOrder(session, prices, { ticker: "GOOG", action: "buy", shares: 1, condition: "lte", target: 90 }).ok).toBe(true);
    expect(placeOrder(session, prices, { ticker: "FAKE", action: "buy", shares: 1, condition: "lte", target: 90 }).ok).toBe(false);
    expect(placeOrder(session, prices, { ticker: "GOOG", action: "hold", shares: 1, condition: "lte", target: 90 }).ok).toBe(false);
    expect(placeOrder(session, prices, { ticker: "GOOG", action: "buy", shares: 0, condition: "lte", target: 90 }).ok).toBe(false);
    expect(placeOrder(session, prices, { ticker: "GOOG", action: "buy", shares: 1, condition: "sideways", target: 90 }).ok).toBe(false);
    expect(placeOrder(session, prices, { ticker: "GOOG", action: "buy", shares: 1, condition: "lte", target: -5 }).ok).toBe(false);
  });

  test("placeOrder rejects a sell order for shares not owned", () => {
    const session = createSession();
    const result = placeOrder(session, prices, { ticker: "GOOG", action: "sell", shares: 5, condition: "gte", target: 150 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/only own 0 shares/);
  });

  test("placeOrder rejects a buy order that would exceed available cash alongside other pending orders", () => {
    const session = createSession();
    // Reserve almost all cash with one buy limit order
    placeOrder(session, prices, { ticker: "META", action: "buy", shares: 32, condition: "lte", target: 300 }); // 9600
    const result = placeOrder(session, prices, { ticker: "GOOG", action: "buy", shares: 10, condition: "lte", target: 100 }); // would need 1000 more
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Insufficient cash/);
  });

  test("checkOrders fills a buy limit order once price drops to or below target", () => {
    const session = createSession();
    placeOrder(session, prices, { ticker: "GOOG", action: "buy", shares: 5, condition: "lte", target: 95 });

    let result = checkOrders(session, { ...prices, GOOG: 100 });
    expect(result.filled).toEqual([]);
    expect(session.orders).toHaveLength(1);

    result = checkOrders(session, { ...prices, GOOG: 95 });
    expect(result.filled).toHaveLength(1);
    expect(result.filled[0].trade).toMatchObject({ ticker: "GOOG", action: "buy", shares: 5, price: 95 });
    expect(session.orders).toHaveLength(0);
    expect(session.holdings.GOOG).toBe(5);
    expect(session.cash).toBe(STARTING_CASH - 475);
  });

  test("checkOrders fills a take-profit sell order once price rises to or above target", () => {
    const session = createSession();
    executeTrade(session, prices, { ticker: "TSLA", action: "buy", shares: 2 }); // owns 2 @ 200
    placeOrder(session, prices, { ticker: "TSLA", action: "sell", shares: 2, condition: "gte", target: 220 });

    let result = checkOrders(session, { ...prices, TSLA: 210 });
    expect(result.filled).toEqual([]);

    result = checkOrders(session, { ...prices, TSLA: 225 });
    expect(result.filled).toHaveLength(1);
    expect(result.filled[0].trade).toMatchObject({ ticker: "TSLA", action: "sell", shares: 2, price: 225 });
    expect(session.holdings.TSLA).toBe(0);
  });

  test("cancelOrder removes a pending order", () => {
    const session = createSession();
    const { order } = placeOrder(session, prices, { ticker: "GOOG", action: "buy", shares: 1, condition: "lte", target: 90 });
    expect(session.orders).toHaveLength(1);

    const result = cancelOrder(session, order.id);
    expect(result.ok).toBe(true);
    expect(session.orders).toHaveLength(0);

    expect(cancelOrder(session, "missing-id").ok).toBe(false);
  });
});
