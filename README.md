# ⚡ BTC Futures Trading Simulator (Pro Blind Backtester)

A professional, high-performance web-based trading simulator built for mastering Bitcoin trading through realistic historical replay.

Designed to effortlessly handle **80MB+ CSV files (~500,000+ 5-minute candles)** directly in your browser using **Web Workers** and **IndexedDB** — **100% client-side, zero Python, zero backend needed**.

---

## 🚀 Quick Start

1. Double-click **`start.bat`** (or open `index.html` directly in any browser like Chrome, Edge, Brave, or Firefox).
2. **Drag & Drop** your `BTCUSDT-5m-merged-all-months.csv` file into the upload zone.
3. The background Web Worker will parse all 500,000+ candles in ~1–2 seconds and cache them into your browser's local **IndexedDB**.
4. **Instant reloads**: On subsequent visits, your data loads in `<100ms` without needing to re-upload!

---

## 🎯 Key Features

### 1. 🎲 Blind / Random Pro Training Mode (No Hindsight Bias)
- Spawns you into a completely randomized point in market history (2020–2026).
- **Masked Dates**: Actual calendar dates and years are disguised (`Session #1 | Bar #42`) so you can't guess if you're in the 2021 bull run, 2022 bear market, or 2024 halving. You trade strictly based on price action, volume, and indicators.
- **🔍 Reveal Era**: Once you finish your session, click **Reveal Era** to reveal the actual historical dates, what real-world event was taking place (e.g., *May 2021 China Mining Ban*, *Nov 2022 FTX Capitulation*), and your session scorecard!

### 2. 📈 Toggleable Indicators (1-Click on Top Bar)
- **EMA 9** (Cyan): Fast short-term momentum trend.
- **MA 20** (Yellow): Standard short-term trend & dynamic support/resistance.
- **MA 50** (Blue): Medium-term trend.
- **MA 200** (Purple): Macro trend / Golden Cross / Death Cross.
- **Bollinger Bands**: 20-period volatility channel (Upper, Middle, Lower).
- **Fibonacci Retracement**: Auto-detects recent swing high/low and plots the key retracement levels including the **0.618 Golden Pocket** and **0.500 Equilibrium**.
- **RSI (14)**: Momentum oscillator sub-pane with 70 (Overbought) and 30 (Oversold) bands.
- **Volume**: Color-coded volume histogram.

### 3. ⏱ Multi-Timeframe Resampling (MTF Sync)
- Switch instantly between **5M, 15M, 1H, and 4H** timeframes on the fly.
- Re-samples raw 5-minute ticks into higher timeframe bars seamlessly without losing your replay position.

### 4. 💼 Pro Futures Trading Engine
- **Long & Short** positions with **1x to 100x leverage**.
- **Isolated Margin & Real-Time Liquidation**: Automatically calculates your liquidation price and monitors candle High/Low.
- **Pro Risk % Sizing**: Select **1%, 2%, 5%, or 10% Risk** of account and enter your Stop Loss — the simulator automatically calculates the exact position size and leverage so you risk only that dollar amount!
- **Interactive Risk:Reward**: Shows real-time R:R ratio (e.g. `1 : 2.5`) before entering.
- **Move to Breakeven (`[BE]` / `X`)**: 1-click button to adjust Stop Loss to entry price once in profit.
- **Partial Closes**: Take off **25%**, **50%**, or **100%** (`C`) of your position to lock in gains.

### 5. 📊 Analytics, Metrics & Trade Journal
- Plain-English beginner tooltips `(?)` explaining:
  - **Win Rate (%)**
  - **Profit Factor** (>1.5 is profitable, >2.0 is elite)
  - **Max Drawdown (%)**
  - **Risk:Reward Achieved**
- **Interactive Canvas Equity Curve**: Visualizes your account growth over time.
- **Trade Journal Table**: Logs every trade with side, leverage, strategy tag, entry/exit price, PnL ($ and %), and exit reason.
- **Export to CSV**: Download your trade journal for record-keeping.

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
| :--- | :--- |
| **`Space`** | Play / Pause Replay |
| **`D`** or **`Right Arrow`** | Advance 1 Bar (+1 candle) |
| **`B`** | Switch to Long (Buy) |
| **`S`** | Switch to Short (Sell) |
| **`X`** | Move Stop Loss to Breakeven |
| **`C`** | Close 100% of Open Position at Market |
| **`1`, `2`, `3`, `4`** | Switch Timeframe (5M, 15M, 1H, 4H) |

---

## 📁 File Structure

```
C:\Users\sulth\documents\backtest\
├── index.html            # Main trading terminal UI
├── css/
│   └── styles.css        # Binance/TradingView dark theme styling
├── js/
│   ├── app.js            # Main controller & keyboard shortcuts
│   ├── chart-manager.js  # TradingView Lightweight Charts integration
│   ├── data-engine.js    # Timeframe resampler (5m, 15m, 1h, 4h)
│   ├── db.js             # IndexedDB cache manager
│   ├── indicators.js     # EMA, MA, Bollinger, RSI, Fibonacci engine
│   ├── parser-worker.js  # Web Worker streaming 80MB CSV parser
│   ├── replay-engine.js  # Blind random replay & era revelation
│   └── trading-engine.js # Futures engine (Long/Short, SL/TP, Risk %)
├── test/
│   └── test-runner.html  # Automated unit test suite
├── start.bat             # 1-click Windows launcher
└── README.md             # Documentation
```
