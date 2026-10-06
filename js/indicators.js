/**
 * Financial technical indicator calculation engine:
 * - SMA (Simple Moving Average)
 * - EMA (Exponential Moving Average)
 * - Bollinger Bands (Upper, Middle, Lower)
 * - RSI (Relative Strength Index - 14)
 * - Volume SMA
 * - Fibonacci Retracement Levels
 */

class IndicatorsEngine {
  /**
   * Calculate Simple Moving Average
   * @param {Array} candles - Array of candle objects [{time, close, ...}]
   * @param {number} period - Number of periods (e.g. 20, 50, 200)
   * @returns {Array} [{time, value}]
   */
  static calculateSMA(candles, period) {
    if (!candles || candles.length < period) return [];
    const result = [];
    let sum = 0;

    for (let i = 0; i < candles.length; i++) {
      sum += candles[i].close;
      if (i >= period) {
        sum -= candles[i - period].close;
      }
      if (i >= period - 1) {
        result.push({
          time: candles[i].time,
          value: parseFloat((sum / period).toFixed(2))
        });
      }
    }
    return result;
  }

  /**
   * Calculate Exponential Moving Average
   * @param {Array} candles - Array of candle objects [{time, close, ...}]
   * @param {number} period - Number of periods (e.g. 9)
   * @returns {Array} [{time, value}]
   */
  static calculateEMA(candles, period) {
    if (!candles || candles.length < period) return [];
    const result = [];
    const k = 2 / (period + 1);

    // Initial SMA for first period
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += candles[i].close;
    }
    let ema = sum / period;
    result.push({
      time: candles[period - 1].time,
      value: parseFloat(ema.toFixed(2))
    });

    for (let i = period; i < candles.length; i++) {
      ema = (candles[i].close - ema) * k + ema;
      result.push({
        time: candles[i].time,
        value: parseFloat(ema.toFixed(2))
      });
    }
    return result;
  }

  /**
   * Calculate Bollinger Bands (20, 2)
   * @param {Array} candles
   * @param {number} period (default 20)
   * @param {number} stdDevMult (default 2)
   * @returns {Object} { upper: [], middle: [], lower: [] }
   */
  static calculateBollingerBands(candles, period = 20, stdDevMult = 2) {
    if (!candles || candles.length < period) {
      return { upper: [], middle: [], lower: [] };
    }

    const upper = [];
    const middle = [];
    const lower = [];

    for (let i = period - 1; i < candles.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += candles[j].close;
      }
      const sma = sum / period;

      let varianceSum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        varianceSum += Math.pow(candles[j].close - sma, 2);
      }
      const stdDev = Math.sqrt(varianceSum / period);

      const time = candles[i].time;
      const uVal = sma + stdDev * stdDevMult;
      const lVal = sma - stdDev * stdDevMult;

      middle.push({ time, value: parseFloat(sma.toFixed(2)) });
      upper.push({ time, value: parseFloat(uVal.toFixed(2)) });
      lower.push({ time, value: parseFloat(lVal.toFixed(2)) });
    }

    return { upper, middle, lower };
  }

  /**
   * Calculate RSI (Wilder's Smoothing)
   * @param {Array} candles
   * @param {number} period (default 14)
   * @returns {Array} [{time, value}]
   */
  static calculateRSI(candles, period = 14) {
    if (!candles || candles.length <= period) return [];
    const result = [];

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const diff = candles[i].close - candles[i - 1].close;
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    let rsi = 100 - (100 / (1 + rs));

    result.push({
      time: candles[period].time,
      value: parseFloat(rsi.toFixed(2))
    });

    for (let i = period + 1; i < candles.length; i++) {
      const diff = candles[i].close - candles[i - 1].close;
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? Math.abs(diff) : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi = 100 - (100 / (1 + rs));

      result.push({
        time: candles[i].time,
        value: parseFloat(rsi.toFixed(2))
      });
    }

    return result;
  }

  /**
   * Calculate Volume Moving Average (SMA 20 on volume)
   */
  static calculateVolumeSMA(candles, period = 20) {
    if (!candles || candles.length < period) return [];
    const result = [];
    let sum = 0;

    for (let i = 0; i < candles.length; i++) {
      sum += candles[i].volume;
      if (i >= period) {
        sum -= candles[i - period].volume;
      }
      if (i >= period - 1) {
        result.push({
          time: candles[i].time,
          value: parseFloat((sum / period).toFixed(2))
        });
      }
    }
    return result;
  }

  /**
   * Find recent swing high and swing low in visible or lookback range
   * @param {Array} candles
   * @param {number} lookback (default 60 bars)
   * @returns {Object} { high, low, highTime, lowTime, isUptrend }
   */
  static findSwingHighLow(candles, lookback = 60) {
    if (!candles || candles.length < 5) return null;
    const slice = candles.slice(-Math.min(lookback, candles.length));

    let maxHigh = -Infinity;
    let minLow = Infinity;
    let maxHighIdx = -1;
    let minLowIdx = -1;

    for (let i = 0; i < slice.length; i++) {
      if (slice[i].high > maxHigh) {
        maxHigh = slice[i].high;
        maxHighIdx = i;
      }
      if (slice[i].low < minLow) {
        minLow = slice[i].low;
        minLowIdx = i;
      }
    }

    const isUptrend = minLowIdx < maxHighIdx;

    return {
      high: maxHigh,
      low: minLow,
      highTime: slice[maxHighIdx].time,
      lowTime: slice[minLowIdx].time,
      isUptrend
    };
  }

  /**
   * Calculate standard Fibonacci Retracement levels
   * @param {number} high - Swing High Price
   * @param {number} low - Swing Low Price
   * @param {boolean} isUptrend - True if swing is Low -> High, False if High -> Low
   * @returns {Array} Array of levels with price, percentage label, and display color
   */
  static calculateFibonacciLevels(high, low, isUptrend = true) {
    if (high <= low) return [];
    const diff = high - low;

    // Standard Fibonacci ratios
    const ratios = [
      { ratio: 0.0, label: '0.0 (Swing Low)', color: '#787b86', isKey: false },
      { ratio: 0.236, label: '0.236', color: '#e5405e', isKey: false },
      { ratio: 0.382, label: '0.382', color: '#ff9800', isKey: false },
      { ratio: 0.500, label: '0.500 (Equilibrium)', color: '#2962ff', isKey: true },
      { ratio: 0.618, label: '0.618 (Golden Pocket)', color: '#ffd700', isKey: true },
      { ratio: 0.786, label: '0.786', color: '#9c27b0', isKey: false },
      { ratio: 1.000, label: '1.000 (Swing High)', color: '#787b86', isKey: false }
    ];

    return ratios.map(item => {
      // In uptrend pullback: 0 is at low, 1 is at high; retracements pull down from high
      const price = isUptrend 
        ? high - (diff * item.ratio)
        : low + (diff * item.ratio);

      return {
        ratio: item.ratio,
        label: item.label,
        price: parseFloat(price.toFixed(2)),
        color: item.color,
        isKey: item.isKey
      };
    });
  }
}

// Global export
window.IndicatorsEngine = IndicatorsEngine;
