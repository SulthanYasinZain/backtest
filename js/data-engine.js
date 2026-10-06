/**
 * Candle Data Engine & Multi-Timeframe Resampler
 * Optimized for high-speed replay with windowed slicing and instant resampling.
 */

class DataEngine {
  constructor() {
    this.rawCandles = []; // 5M base candles
    this.currentTimeframe = '5m';
  }

  setCandles(candles) {
    this.rawCandles = candles || [];
  }

  getCount() {
    return this.rawCandles.length;
  }

  getCandle(index) {
    if (index >= 0 && index < this.rawCandles.length) {
      return this.rawCandles[index];
    }
    return null;
  }

  findIndexByTime(timestamp) {
    let low = 0;
    let high = this.rawCandles.length - 1;
    let bestIdx = -1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const midTime = this.rawCandles[mid].time;

      if (midTime === timestamp) {
        return mid;
      } else if (midTime < timestamp) {
        bestIdx = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return bestIdx >= 0 ? bestIdx : 0;
  }

  /**
   * Helper to convert timeframe string to seconds
   */
  getTimeframeSeconds(tf) {
    switch (tf) {
      case '15m': return 15 * 60;
      case '1h':  return 60 * 60;
      case '4h':  return 4 * 60 * 60;
      case '1d':  return 24 * 60 * 60;
      case '5m':
      default:
        return 5 * 60;
    }
  }

  /**
   * Get windowed session candles (warmup + played bars)
   * This is fast (O(100-500 bars)) instead of slicing all 500,000 candles!
   * @param {number} startIndex - Starting index of the session
   * @param {number} currentIndex - Current replay index
   * @param {number} warmupBars - Number of completed bars before start (default 250)
   * @param {string} timeframe - '5m', '15m', '1h', '4h'
   */
  getSessionCandles(startIndex, currentIndex, warmupBars = 250, timeframe = this.currentTimeframe) {
    if (!this.rawCandles.length || currentIndex < 0) return [];

    const tfSec = this.getTimeframeSeconds(timeframe);
    const rawPerBar = tfSec / 300; // e.g. 1 for 5m, 3 for 15m, 12 for 1h, 48 for 4h

    // Calculate required raw starting point
    const rawWarmupCount = Math.ceil(warmupBars * rawPerBar);
    const fromIdx = Math.max(0, startIndex - rawWarmupCount);
    const toIdx = Math.min(this.rawCandles.length, currentIndex + 1);

    if (timeframe === '5m') {
      return this.rawCandles.slice(fromIdx, toIdx);
    }

    // Resample only the windowed slice (typically 300 - 1500 raw candles, ~0.05ms)
    const aggregated = [];
    let currentBucket = null;

    for (let i = fromIdx; i < toIdx; i++) {
      const c = this.rawCandles[i];
      const bucketTime = Math.floor(c.time / tfSec) * tfSec;

      if (!currentBucket || currentBucket.time !== bucketTime) {
        if (currentBucket) {
          aggregated.push(currentBucket);
        }
        currentBucket = {
          time: bucketTime,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume
        };
      } else {
        currentBucket.high = Math.max(currentBucket.high, c.high);
        currentBucket.low = Math.min(currentBucket.low, c.low);
        currentBucket.close = c.close;
        currentBucket.volume += c.volume;
      }
    }

    if (currentBucket) {
      aggregated.push(currentBucket);
    }

    return aggregated;
  }

  /**
   * Convert latest 5m candle into the active higher-timeframe candle
   */
  getLatestResampledCandle(candle, timeframe = this.currentTimeframe) {
    if (!candle) return null;
    if (timeframe === '5m') return candle;

    const tfSec = this.getTimeframeSeconds(timeframe);
    const bucketTime = Math.floor(candle.time / tfSec) * tfSec;

    // Binary search back to the start of this bucket
    const startIdx = this.findIndexByTime(bucketTime);
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    const open = this.rawCandles[startIdx] ? this.rawCandles[startIdx].open : candle.open;

    // Max 48 bars for 4h
    const currentIdx = this.findIndexByTime(candle.time);
    for (let i = startIdx; i <= currentIdx; i++) {
      if (i === currentIdx) {
        if (candle.high > high) high = candle.high;
        if (candle.low < low) low = candle.low;
        volume += candle.volume;
      } else {
        const c = this.rawCandles[i];
        if (c) {
          if (c.high > high) high = c.high;
          if (c.low < low) low = c.low;
          volume += c.volume;
        }
      }
    }

    return {
      time: bucketTime,
      open,
      high: high === -Infinity ? candle.high : high,
      low: low === Infinity ? candle.low : low,
      close: candle.close,
      volume
    };
  }
}

// Global instance
window.dataEngine = new DataEngine();
