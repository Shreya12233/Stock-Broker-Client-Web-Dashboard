# Ledger Terminal - Stock Broker Dashboard

A small real-time stock broker dashboard I built with Node.js, Express and Socket.IO. You log in with your email, get $10,000 in fake cash, subscribe to a few tickers, and watch the prices move every second. You can buy/sell, set price alerts, place limit/stop orders, and there's a leaderboard if more than one person is using it at the same time.

Prices aren't real - they're just a random walk generated on the server every second. The point was to get the real-time, multi-user, no-refresh part working properly.

## What it can do

- Log in with any email (no password, this is just a demo)
- Subscribe to GOOG, TSLA, AMZN, META, NVDA and watch prices update live over WebSockets
- A ticker tape at the top always shows all 5 stocks, even ones you're not subscribed to
- Buy/sell shares from a trade modal, with a running portfolio value and P&L
- A little donut chart showing how your cash is split across your holdings
- Trade history log
- Price alerts (notify me when X goes above/below a price)
- Limit and stop orders - e.g. "buy GOOG if it drops to $170" or "sell TSLA if it hits $260" - these fill automatically once the price crosses your target
- A leaderboard showing everyone who's logged in, their portfolio value and P&L, ranked live, with online/offline status
- Dark/light theme toggle
- Jest tests for the trading logic (buys, sells, alerts, orders)

Your portfolio is saved on the server against your email, so if you refresh or close the tab and come back, your cash/holdings/orders are still there.

## Running it

```bash
dir
cd stock-dashboard
npm install
npm start
```

Then open http://localhost:3000

If you want to see the multi-user stuff (leaderboard, independent watchlists, etc.), open the site in two tabs (or two browsers) and log in with two different emails. Subscribe to different stocks in each one - both update independently, and both show up on the leaderboard.

## Tests

```bash
npm test
```

Covers buy/sell validation (insufficient funds, overselling, etc.), portfolio P&L math, price alerts, and the limit/stop order logic (placing, filling, cancelling).

## Project layout

```
stock-dashboard/
├── server/
│   ├── index.js        # Express + Socket.IO server, price loop, leaderboard
│   └── trading.js       # All the trading logic - buys/sells/alerts/orders, kept separate so it's testable
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js           # client side socket handling, charts, modals, etc.
├── test/
│   └── trading.test.js
└── package.json
```


- **Email login** - `socket.emit("login", email)`, server keeps a portfolio per email
- **Subscribe by ticker** - dropdown of the 5 supported tickers, `socket.emit("subscribe", ticker)`
- **5 supported stocks** - `["GOOG","TSLA","AMZN","META","NVDA"]` in trading.js
- **Live price updates without refresh** - server runs a `setInterval` every second that randomly walks the prices and pushes them out over Socket.IO
- **Multiple users, independent dashboards** - each socket has its own subscriptions, and the server loops through every connection on each tick



- Limit/stop orders that auto-execute when price hits your target
- Portfolios persist by email (not just per session/socket)
- Live leaderboard across all logged in users
- The market tape banner
- Portfolio allocation donut chart

## Deploying (Render/Railway etc.)

1. Push to GitHub
2. New Web Service on Render or Railway
3. Build command: `npm install`
4. Start command: `npm start`
5. Port: `3000`
