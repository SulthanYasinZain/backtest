/**
 * Pro Futures Trading Simulation & Risk Engine
 * Features:
 * - Long & Short contracts with isolated margin and 1x-100x leverage
 * - Accurate Liquidation price calculation & candle High/Low check
 * - Stop Loss & Take Profit automated execution
 * - Pro Risk % Position Sizing (Risk 1%, 2%, 5% of equity)
 * - Breakeven adjustment & Partial close (25%, 50%, 75%, 100%)
 * - Full performance analytics (Win Rate, Profit Factor, Max Drawdown, Equity Curve, Strategy tags)
 */

class FuturesTradingEngine {
  constructor(initialBalance = 10000) {
    this.initialBalance = initialBalance;
    this.balance = initialBalance; // Realized cash balance
    this.position = null; // Single active position (Isolated Futures)
    this.pendingOrders = []; // Limit orders
    this.closedTrades = []; // History of closed trades
    this.equityHistory = [{ time: 0, tradeNum: 0, equity: initialBalance }];
    this.peakEquity = initialBalance;
    this.maxDrawdownPercent = 0;
    this.maintenanceMarginRatio = 0.005; // 0.5% standard MMR

    // Callbacks
    this.onPositionUpdate = null;
    this.onTradeClosed = null;
    this.onNotification = null;
  }

  /**
   * Reset simulation state
   */
  reset(initialBalance = 10000) {
    this.initialBalance = initialBalance;
    this.balance = initialBalance;
    this.position = null;
    this.pendingOrders = [];
    this.closedTrades = [];
    this.equityHistory = [{ time: 0, tradeNum: 0, equity: initialBalance }];
    this.peakEquity = initialBalance;
    this.maxDrawdownPercent = 0;
    this.notifyUpdate();
  }

  /**
   * Get current equity (balance + unrealized PnL)
   */
  getEquity(currentPrice) {
    if (!this.position || !currentPrice) return this.balance;
    const unrealized = this.getUnrealizedPnL(currentPrice);
    return Math.max(0, this.balance + unrealized);
  }

  /**
   * Calculate unrealized PnL in USDT
   */
  getUnrealizedPnL(currentPrice) {
    if (!this.position || !currentPrice) return 0;
    const { side, entryPrice, sizeBtc } = this.position;
    if (side === 'LONG') {
      return (currentPrice - entryPrice) * sizeBtc;
    } else {
      return (entryPrice - currentPrice) * sizeBtc;
    }
  }

  /**
   * Calculate unrealized Return on Equity (ROE %)
   */
  getUnrealizedROE(currentPrice) {
    if (!this.position || !this.position.initialMargin) return 0;
    const pnl = this.getUnrealizedPnL(currentPrice);
    return (pnl / this.position.initialMargin) * 100;
  }

  /**
   * Calculate Liquidation Price
   */
  calculateLiquidationPrice(side, entryPrice, leverage) {
    const mmr = this.maintenanceMarginRatio;
    if (side === 'LONG') {
      // Liq = Entry * (1 - 1/Lev + MMR)
      return entryPrice * (1 - (1 / leverage) + mmr);
    } else {
      // Liq = Entry * (1 + 1/Lev - MMR)
      return entryPrice * (1 + (1 / leverage) - mmr);
    }
  }

  /**
   * Calculate Position Size based on Defined Risk % of Account
   */
  calculateSizeByRisk(riskPercent, entryPrice, stopLossPrice) {
    if (!entryPrice || !stopLossPrice || entryPrice === stopLossPrice) return null;
    const equity = this.getEquity(entryPrice);
    const dollarRisk = (riskPercent / 100) * equity;
    const distancePerBtc = Math.abs(entryPrice - stopLossPrice);

    if (distancePerBtc <= 0) return null;

    const sizeBtc = dollarRisk / distancePerBtc;
    const notionalUsdt = sizeBtc * entryPrice;
    const minLeverage = Math.max(1, Math.ceil(notionalUsdt / equity));

    return {
      dollarRisk: parseFloat(dollarRisk.toFixed(2)),
      sizeBtc: parseFloat(sizeBtc.toFixed(4)),
      notionalUsdt: parseFloat(notionalUsdt.toFixed(2)),
      minLeverage: Math.min(100, minLeverage)
    };
  }

  /**
   * Open Market Position
   */
  openMarketPosition({ side, entryPrice, sizeBtc, leverage, stopLoss = null, takeProfit = null, tag = 'Discretionary', time = 0 }) {
    if (this.position) {
      this.sendNotification('You already have an open position. Close it first or adjust size.', 'error');
      return false;
    }

    const notionalUsdt = sizeBtc * entryPrice;
    const requiredMargin = notionalUsdt / leverage;

    if (requiredMargin > this.balance) {
      this.sendNotification(`Insufficient balance. Margin needed: $${requiredMargin.toFixed(2)}, Available: $${this.balance.toFixed(2)}`, 'error');
      return false;
    }

    const liquidationPrice = this.calculateLiquidationPrice(side, entryPrice, leverage);

    this.position = {
      side,
      entryPrice,
      sizeBtc,
      sizeUsdt: notionalUsdt,
      leverage,
      initialMargin: requiredMargin,
      stopLoss: stopLoss ? parseFloat(stopLoss) : null,
      takeProfit: takeProfit ? parseFloat(takeProfit) : null,
      liquidationPrice,
      tag: tag || 'Discretionary',
      entryTime: time,
      currentPrice: entryPrice
    };

    // Deduct margin from available cash
    this.balance -= requiredMargin;

    this.sendNotification(`Opened ${leverage}x ${side} @ $${entryPrice.toLocaleString()} (Size: ${sizeBtc.toFixed(4)} BTC)`, 'success');
    this.notifyUpdate();
    return true;
  }

  /**
   * Adjust Stop Loss to Breakeven
   */
  moveToBreakeven() {
    if (!this.position) return;
    this.position.stopLoss = this.position.entryPrice;
    this.sendNotification(`Stop Loss moved to Breakeven @ $${this.position.entryPrice.toLocaleString()}`, 'info');
    this.notifyUpdate();
  }

  /**
   * Update SL / TP prices
   */
  updateSLTP(stopLoss, takeProfit) {
    if (!this.position) return;
    if (stopLoss !== undefined) this.position.stopLoss = stopLoss ? parseFloat(stopLoss) : null;
    if (takeProfit !== undefined) this.position.takeProfit = takeProfit ? parseFloat(takeProfit) : null;
    this.sendNotification('Updated Stop Loss / Take Profit targets.', 'info');
    this.notifyUpdate();
  }

  /**
   * Close percentage of current position (25%, 50%, 75%, 100%)
   */
  closePartial(percent, currentPrice, exitReason = 'MANUAL', time = 0) {
    if (!this.position) return;
    const pct = Math.max(1, Math.min(100, percent)) / 100;
    const closingBtc = this.position.sizeBtc * pct;
    const closingMargin = this.position.initialMargin * pct;

    // Calculate PnL on closed portion
    let pnl = 0;
    if (this.position.side === 'LONG') {
      pnl = (currentPrice - this.position.entryPrice) * closingBtc;
    } else {
      pnl = (this.position.entryPrice - currentPrice) * closingBtc;
    }

    const roe = (pnl / closingMargin) * 100;

    // Return margin + PnL to balance
    this.balance += Math.max(0, closingMargin + pnl);

    // Record trade log
    const tradeRecord = {
      id: this.closedTrades.length + 1,
      side: this.position.side,
      leverage: this.position.leverage,
      entryPrice: this.position.entryPrice,
      exitPrice: currentPrice,
      sizeBtc: closingBtc,
      initialMargin: closingMargin,
      pnlUsdt: parseFloat(pnl.toFixed(2)),
      pnlPercent: parseFloat(roe.toFixed(2)),
      entryTime: this.position.entryTime,
      exitTime: time,
      exitReason,
      tag: this.position.tag
    };

    this.closedTrades.push(tradeRecord);
    this.recordEquitySnapshot(currentPrice, time);

    if (pct >= 0.999) {
      // Fully closed
      this.position = null;
      this.sendNotification(`Closed position @ $${currentPrice.toLocaleString()} | PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${roe.toFixed(1)}%)`, pnl >= 0 ? 'success' : 'warn');
    } else {
      // Partial remaining
      this.position.sizeBtc -= closingBtc;
      this.position.sizeUsdt = this.position.sizeBtc * this.position.entryPrice;
      this.position.initialMargin -= closingMargin;
      this.sendNotification(`Closed ${(pct * 100).toFixed(0)}% @ $${currentPrice.toLocaleString()} | Partial PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`, 'info');
    }

    if (this.onTradeClosed) {
      this.onTradeClosed(tradeRecord);
    }
    this.notifyUpdate();
  }

  /**
   * Check tick for SL, TP, and Liquidation against Candle High/Low
   */
  processCandleTick(candle) {
    if (!candle) return;

    // Process Pending Limit Orders
    for (let i = this.pendingOrders.length - 1; i >= 0; i--) {
      const order = this.pendingOrders[i];
      let filled = false;
      if (order.side === 'LONG' && candle.low <= order.price) {
        filled = true;
      } else if (order.side === 'SHORT' && candle.high >= order.price) {
        filled = true;
      }

      if (filled) {
        this.pendingOrders.splice(i, 1);
        this.openMarketPosition({
          side: order.side,
          entryPrice: order.price,
          sizeBtc: order.sizeBtc,
          leverage: order.leverage,
          stopLoss: order.stopLoss,
          takeProfit: order.takeProfit,
          tag: order.tag,
          time: candle.time
        });
      }
    }

    if (!this.position) return;
    this.position.currentPrice = candle.close;

    const { side, liquidationPrice, stopLoss, takeProfit } = this.position;

    // 1. Check Liquidation (Highest priority risk check)
    if (side === 'LONG' && candle.low <= liquidationPrice) {
      this.closePartial(100, liquidationPrice, 'LIQUIDATION', candle.time);
      this.sendNotification(`LIQUIDATED! Price hit $${liquidationPrice.toFixed(2)}`, 'error');
      return;
    } else if (side === 'SHORT' && candle.high >= liquidationPrice) {
      this.closePartial(100, liquidationPrice, 'LIQUIDATION', candle.time);
      this.sendNotification(`LIQUIDATED! Price hit $${liquidationPrice.toFixed(2)}`, 'error');
      return;
    }

    // 2. Check Stop Loss
    if (stopLoss !== null) {
      if (side === 'LONG' && candle.low <= stopLoss) {
        const exit = Math.min(candle.open, stopLoss);
        this.closePartial(100, exit, 'STOP_LOSS', candle.time);
        return;
      } else if (side === 'SHORT' && candle.high >= stopLoss) {
        const exit = Math.max(candle.open, stopLoss);
        this.closePartial(100, exit, 'STOP_LOSS', candle.time);
        return;
      }
    }

    // 3. Check Take Profit
    if (takeProfit !== null) {
      if (side === 'LONG' && candle.high >= takeProfit) {
        this.closePartial(100, takeProfit, 'TAKE_PROFIT', candle.time);
        return;
      } else if (side === 'SHORT' && candle.low <= takeProfit) {
        this.closePartial(100, takeProfit, 'TAKE_PROFIT', candle.time);
        return;
      }
    }

    this.notifyUpdate();
  }

  /**
   * Record Equity snapshot for Equity Curve chart
   */
  recordEquitySnapshot(currentPrice, time) {
    const currentEquity = this.getEquity(currentPrice);
    if (currentEquity > this.peakEquity) {
      this.peakEquity = currentEquity;
    } else {
      const dd = ((this.peakEquity - currentEquity) / this.peakEquity) * 100;
      if (dd > this.maxDrawdownPercent) {
        this.maxDrawdownPercent = parseFloat(dd.toFixed(2));
      }
    }

    this.equityHistory.push({
      tradeNum: this.closedTrades.length,
      time: time || Date.now() / 1000,
      equity: parseFloat(currentEquity.toFixed(2))
    });
  }

  /**
   * Calculate summary metrics
   */
  getMetrics(currentPrice) {
    const totalTrades = this.closedTrades.length;
    const wins = this.closedTrades.filter(t => t.pnlUsdt > 0);
    const losses = this.closedTrades.filter(t => t.pnlUsdt < 0);

    const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
    const grossProfit = wins.reduce((sum, t) => sum + t.pnlUsdt, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnlUsdt, 0));
    const realizedProfit = grossProfit - grossLoss;
    const unrealized = currentPrice ? this.getUnrealizedPnL(currentPrice) : 0;
    const netProfit = realizedProfit + unrealized;

    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99.9 : 0;
    const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
    const riskRewardAchieved = avgLoss > 0 ? avgWin / avgLoss : 0;

    const currentEquity = this.getEquity(currentPrice);
    const totalReturnPercent = ((currentEquity - this.initialBalance) / this.initialBalance) * 100;

    return {
      initialBalance: this.initialBalance,
      currentBalance: parseFloat(this.balance.toFixed(2)),
      equity: parseFloat(currentEquity.toFixed(2)),
      totalReturnPercent: parseFloat(totalReturnPercent.toFixed(2)),
      netProfit: parseFloat(netProfit.toFixed(2)),
      totalTrades,
      winCount: wins.length,
      lossCount: losses.length,
      winRate: parseFloat(winRate.toFixed(1)),
      profitFactor: parseFloat(profitFactor.toFixed(2)),
      riskRewardAchieved: parseFloat(riskRewardAchieved.toFixed(2)),
      maxDrawdownPercent: this.maxDrawdownPercent,
      avgWin: parseFloat(avgWin.toFixed(2)),
      avgLoss: parseFloat(avgLoss.toFixed(2))
    };
  }

  sendNotification(msg, type = 'info') {
    if (this.onNotification) {
      this.onNotification(msg, type);
    }
  }

  notifyUpdate() {
    if (this.onPositionUpdate) {
      this.onPositionUpdate({
        position: this.position,
        balance: this.balance,
        equity: this.position ? this.getEquity(this.position.currentPrice) : this.balance,
        unrealizedPnl: this.position ? this.getUnrealizedPnL(this.position.currentPrice) : 0,
        unrealizedRoe: this.position ? this.getUnrealizedROE(this.position.currentPrice) : 0
      });
    }
  }
}

// Global instance
window.tradingEngine = new FuturesTradingEngine(10000);
