/**
 * Real-Time Simulation Replay Engine with In-House Clock
 * 1x = Exactly 1:1 Real-Time (5 minutes per 5M bar, 1 real second = 1 market second).
 * Multipliers:
 * - 1x: Real-time (5 minutes / bar)
 * - 5x: 1 minute / bar
 * - 10x: 30 seconds / bar
 * - 30x: 10 seconds / bar
 * - 60x: 5 seconds / bar
 * - 300x: 1 second / bar
 */

class ReplayEngine {
  constructor() {
    this.startIndex = 0;
    this.currentIndex = 0;
    this.intraSeconds = 0; // 0 to 300 seconds within current 5m candle
    this.isPlaying = false;
    this.playTimer = null;
    this.speed = 1; // 1x = 1 real second per 1 market second (5m per bar)
    this.tickIntervalMs = 200; // UI update tick every 200ms
    this.blindMode = true;
    this.sessionNumber = 1;

    // Callbacks
    this.onTick = null;
    this.onStateChange = null;
  }

  startRandomSession() {
    this.pause();
    const total = window.dataEngine.getCount();
    if (total < 500) {
      console.warn('Not enough candles for random session');
      return;
    }

    const minStart = 250;
    const maxStart = Math.max(minStart + 1, total - 1500);
    const randomIdx = Math.floor(Math.random() * (maxStart - minStart)) + minStart;

    this.startIndex = randomIdx;
    this.currentIndex = randomIdx;
    this.intraSeconds = 300;
    this.sessionNumber++;
    this.blindMode = true;

    this.notifyState();
    this.emitCurrentTick();
  }

  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  play() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.notifyState();

    this.playTimer = setInterval(() => {
      this.advanceTime();
    }, this.tickIntervalMs);
  }

  pause() {
    if (!this.isPlaying && !this.playTimer) return;
    this.isPlaying = false;
    if (this.playTimer) {
      clearInterval(this.playTimer);
      this.playTimer = null;
    }
    this.notifyState();
  }

  /**
   * Continuous simulated market time advance
   */
  advanceTime() {
    const total = window.dataEngine.getCount();
    if (this.currentIndex >= total - 1) {
      this.pause();
      return;
    }

    // Advance market seconds based on real tick interval * speed
    const secondsToAdvance = (this.tickIntervalMs / 1000) * this.speed;
    this.intraSeconds += secondsToAdvance;

    if (this.intraSeconds >= 300) {
      const barsToAdvance = Math.floor(this.intraSeconds / 300);
      this.intraSeconds = this.intraSeconds % 300;

      const oldIndex = this.currentIndex;
      const targetIndex = Math.min(total - 1, oldIndex + barsToAdvance);

      // Finalize all bars completed during this tick
      for (let idx = oldIndex; idx < targetIndex; idx++) {
        const c = window.dataEngine.getCandle(idx);
        if (c && this.onTick) {
          this.onTick(c, idx, 300);
        }
      }

      this.currentIndex = targetIndex;

      if (this.currentIndex >= total - 1) {
        this.currentIndex = total - 1;
        this.intraSeconds = 300;
        const c = window.dataEngine.getCandle(this.currentIndex);
        if (c && this.onTick) this.onTick(c, this.currentIndex, 300);
        this.pause();
        this.notifyState();
        return;
      }
    }

    this.emitCurrentTick();
    this.notifyState();
  }

  /**
   * Manual Step forward by N whole bars
   */
  step(numBars = 1) {
    const total = window.dataEngine.getCount();
    if (this.currentIndex >= total - 1) return;

    this.pause();

    const oldIndex = this.currentIndex;
    const targetIndex = Math.min(total - 1, oldIndex + numBars);
    if (targetIndex <= oldIndex) return;

    // 1. If currently mid-bar, finalize the current bar first
    if (this.intraSeconds > 0 && this.intraSeconds < 300) {
      const curCandle = window.dataEngine.getCandle(oldIndex);
      if (curCandle && this.onTick) {
        this.onTick(curCandle, oldIndex, 300);
      }
    }

    // 2. Step through each new bar sequentially, emitting each as a completed full candle
    for (let idx = oldIndex + 1; idx <= targetIndex; idx++) {
      this.currentIndex = idx;
      this.intraSeconds = 300;
      const candle = window.dataEngine.getCandle(idx);
      if (candle && this.onTick) {
        this.onTick(candle, idx, 300);
      }
    }

    this.currentIndex = targetIndex;
    this.intraSeconds = 300;
    this.notifyState();
  }

  stepBack(numBars = 1) {
    this.pause();
    this.currentIndex = Math.max(this.startIndex, this.currentIndex - numBars);
    this.intraSeconds = 300;
    if (window.refreshChartData) {
      window.refreshChartData();
    }
    this.emitCurrentTick();
    this.notifyState();
  }

  setSpeed(multiplier) {
    this.speed = Math.max(0.1, multiplier);
    if (this.isPlaying) {
      this.pause();
      this.play();
    }
  }

  jumpToIndex(idx) {
    this.pause();
    const total = window.dataEngine.getCount();
    this.currentIndex = Math.max(0, Math.min(idx, total - 1));
    this.startIndex = Math.max(0, this.currentIndex - 200);
    this.intraSeconds = 300;
    if (window.refreshChartData) {
      window.refreshChartData();
    }
    this.emitCurrentTick();
    this.notifyState();
  }

  getCurrentCandle() {
    return window.dataEngine.getCandle(this.currentIndex);
  }

  /**
   * Compute live fluctuating price across the 300 seconds of the 5-minute candle
   */
  getLiveCandle() {
    const candle = this.getCurrentCandle();
    if (!candle) return null;

    if (this.intraSeconds >= 300) {
      return {
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        isFinal: true
      };
    }

    const s = Math.min(300, Math.max(0, this.intraSeconds));
    const { open, high, low, close, volume, time } = candle;
    const isBull = close >= open;

    let microPrice = open;
    let runningHigh = open;
    let runningLow = open;

    // Piecewise smooth trajectory across the 300 seconds (5 minutes)
    if (isBull) {
      if (s < 60) {
        // 0 to 1 min: initial dip from Open towards Low
        const p = s / 60;
        microPrice = open - (open - low) * 0.6 * p;
        runningHigh = open;
        runningLow = microPrice;
      } else if (s < 120) {
        // 1 to 2 min: sets bottom Low wick and recovers to open
        const p = (s - 60) / 60;
        microPrice = (open - (open - low) * 0.6) + ((open - (open - (open - low) * 0.6)) * p);
        runningHigh = open;
        runningLow = low;
      } else if (s < 200) {
        // 2 to 3.3 min: breaks through open into green, rallying up
        const p = (s - 120) / 80;
        microPrice = open + (high - open) * 0.7 * p;
        runningHigh = microPrice;
        runningLow = low;
      } else if (s < 260) {
        // 3.3 to 4.3 min: reaches full High wick
        const p = (s - 200) / 60;
        microPrice = (open + (high - open) * 0.7) + ((high - (open + (high - open) * 0.7)) * p);
        runningHigh = high;
        runningLow = low;
      } else {
        // 4.3 to 5.0 min: slight pullback from high to close
        const p = (s - 260) / 40;
        microPrice = high - (high - close) * p;
        runningHigh = high;
        runningLow = low;
      }
    } else {
      if (s < 60) {
        // 0 to 1 min: initial bounce from Open towards High
        const p = s / 60;
        microPrice = open + (high - open) * 0.6 * p;
        runningHigh = microPrice;
        runningLow = open;
      } else if (s < 120) {
        // 1 to 2 min: sets top High wick and pulls back to open
        const p = (s - 60) / 60;
        microPrice = (open + (high - open) * 0.6) - ((open + (high - open) * 0.6 - open) * p);
        runningHigh = high;
        runningLow = open;
      } else if (s < 200) {
        // 2 to 3.3 min: drops below open into red, dumping down
        const p = (s - 120) / 80;
        microPrice = open - (open - low) * 0.7 * p;
        runningHigh = high;
        runningLow = microPrice;
      } else if (s < 260) {
        // 3.3 to 4.3 min: reaches full Low wick
        const p = (s - 200) / 60;
        microPrice = (open - (open - low) * 0.7) - (((open - (open - low) * 0.7) - low) * p);
        runningHigh = high;
        runningLow = low;
      } else {
        // 4.3 to 5.0 min: slight bounce from low to close
        const p = (s - 260) / 40;
        microPrice = low + (close - low) * p;
        runningHigh = high;
        runningLow = low;
      }
    }

    const volRatio = Math.min(1, Math.max(0.05, (s / 300)));

    return {
      time,
      open,
      high: parseFloat(Math.max(runningHigh, microPrice).toFixed(2)),
      low: parseFloat(Math.min(runningLow, microPrice).toFixed(2)),
      close: parseFloat(microPrice.toFixed(2)),
      volume: parseFloat((volume * volRatio).toFixed(2)),
      isFinal: s >= 299
    };
  }

  getSessionBarCount() {
    return Math.max(0, this.currentIndex - this.startIndex);
  }

  getInHouseClockInfo() {
    const candle = this.getCurrentCandle();
    if (!candle) return { clockStr: '--:--:--', countdownStr: '--:--', sessionBar: '--' };

    const elapsedSeconds = Math.min(300, Math.floor(this.intraSeconds));
    const simulatedUnixTime = candle.time + elapsedSeconds;
    const remainingSeconds = Math.max(0, 300 - elapsedSeconds);

    const remMins = Math.floor(remainingSeconds / 60);
    const remSecs = remainingSeconds % 60;
    const countdownStr = `${String(remMins).padStart(2, '0')}:${String(remSecs).padStart(2, '0')}`;

    let clockStr = '';
    if (this.blindMode) {
      const completedBars = this.getSessionBarCount();
      const totalSessionSeconds = (completedBars * 300) + (this.intraSeconds >= 300 ? 0 : elapsedSeconds);
      const hours = Math.floor((totalSessionSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSessionSeconds % 3600) / 60);
      const seconds = totalSessionSeconds % 60;
      clockStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    } else {
      const d = new Date(simulatedUnixTime * 1000);
      const h = String(d.getUTCHours()).padStart(2, '0');
      const m = String(d.getUTCMinutes()).padStart(2, '0');
      const s = String(d.getUTCSeconds()).padStart(2, '0');
      clockStr = `${h}:${m}:${s}`;
    }

    return {
      clockStr,
      countdownStr,
      sessionBar: `Session #${this.sessionNumber} | Bar #${this.getSessionBarCount()}`
    };
  }

  revealHistoricalEra() {
    this.blindMode = false;
    const currentCandle = this.getCurrentCandle();
    const startCandle = window.dataEngine.getCandle(this.startIndex);

    if (!currentCandle || !startCandle) return null;

    const startDate = new Date(startCandle.time * 1000);
    const currentDate = new Date(currentCandle.time * 1000);

    const year = startDate.getUTCFullYear();
    const month = startDate.getUTCMonth() + 1;

    let contextNote = 'Bitcoin Market Volatility Period';
    if (year === 2020 && month <= 3) {
      contextNote = 'Early 2020 / COVID Liquidity Shock & Rebound';
    } else if (year === 2020 && month >= 10) {
      contextNote = 'Late 2020 Breakout toward previous ATH ($20,000)';
    } else if (year === 2021 && month <= 4) {
      contextNote = 'Spring 2021 Historic Bull Run ($64k peak)';
    } else if (year === 2021 && month >= 5 && month <= 7) {
      contextNote = 'May 2021 China Mining Ban & 50% Flash Crash';
    } else if (year === 2021 && month >= 10) {
      contextNote = 'Nov 2021 Cycle Peak ($69k ATH) & Distribution';
    } else if (year === 2022 && month === 5) {
      contextNote = 'May 2022 Terra/LUNA Depeg & Macro Selloff';
    } else if (year === 2022 && month === 11) {
      contextNote = 'November 2022 FTX Collapse Capitulation ($15.5k Bottom)';
    } else if (year === 2023) {
      contextNote = '2023 Accumulation & Pre-Halving Recovery';
    } else if (year >= 2024) {
      contextNote = '2024 Spot ETF Inflows & Post-Halving Regime';
    }

    this.notifyState();
    return {
      revealed: true,
      startDateStr: startDate.toUTCString(),
      currentDateStr: currentDate.toUTCString(),
      durationBars: this.getSessionBarCount(),
      contextNote
    };
  }

  emitCurrentTick() {
    const liveCandle = this.getLiveCandle();
    if (!liveCandle) return;

    if (this.onTick) {
      this.onTick(liveCandle, this.currentIndex, Math.floor(this.intraSeconds));
    }
  }

  notifyState() {
    if (this.onStateChange) {
      const clockInfo = this.getInHouseClockInfo();
      this.onStateChange({
        isPlaying: this.isPlaying,
        speed: this.speed,
        blindMode: this.blindMode,
        sessionNumber: this.sessionNumber,
        barNumber: this.getSessionBarCount(),
        intraSeconds: Math.floor(this.intraSeconds),
        clockStr: clockInfo.clockStr,
        countdownStr: clockInfo.countdownStr,
        currentCandle: this.getLiveCandle()
      });
    }
  }
}

// Global instance
window.replayEngine = new ReplayEngine();
