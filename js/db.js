/**
 * IndexedDB storage manager for high-performance candle caching and session history.
 */
const DB_NAME = 'BTC_TradingSimulator_DB';
const DB_VERSION = 1;
const STORE_CANDLES = 'candles_cache';
const STORE_SESSIONS = 'sessions_history';

class SimulatorDB {
  constructor() {
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_CANDLES)) {
          db.createObjectStore(STORE_CANDLES, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
          db.createObjectStore(STORE_SESSIONS, { keyPath: 'id', autoIncrement: true });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Save parsed 5M candle dataset
   * @param {Array} candles - Array of candle objects [{time, open, high, low, close, volume}]
   * @param {Object} metadata - File metadata (fileName, count, startTime, endTime)
   */
  async saveCandles(candles, metadata = {}) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_CANDLES], 'readwrite');
      const store = tx.objectStore(STORE_CANDLES);

      const record = {
        id: 'primary_btc_5m',
        candles: candles,
        metadata: {
          ...metadata,
          count: candles.length,
          startTime: candles.length > 0 ? candles[0].time : null,
          endTime: candles.length > 0 ? candles[candles.length - 1].time : null,
          savedAt: Date.now()
        }
      };

      const req = store.put(record);
      req.onsuccess = () => resolve(record.metadata);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Load cached candles
   */
  async loadCandles() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_CANDLES], 'readonly');
      const store = tx.objectStore(STORE_CANDLES);
      const req = store.get('primary_btc_5m');

      req.onsuccess = () => {
        if (req.result && req.result.candles) {
          resolve({
            candles: req.result.candles,
            metadata: req.result.metadata
          });
        } else {
          resolve(null);
        }
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Check if cache exists without loading entire array
   */
  async hasCandles() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_CANDLES], 'readonly');
      const store = tx.objectStore(STORE_CANDLES);
      const req = store.count('primary_btc_5m');
      req.onsuccess = () => resolve(req.result > 0);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Clear candle cache
   */
  async clearCandles() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_CANDLES], 'readwrite');
      const store = tx.objectStore(STORE_CANDLES);
      const req = store.delete('primary_btc_5m');
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Save finished session trade log
   */
  async saveSessionLog(sessionData) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_SESSIONS], 'readwrite');
      const store = tx.objectStore(STORE_SESSIONS);
      const req = store.add({ ...sessionData, timestamp: Date.now() });
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }
}

// Global instance
window.simulatorDB = new SimulatorDB();
