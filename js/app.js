/**
 * Main Application Orchestrator
 * Connects UI, Worker, IndexedDB, DataEngine, ReplayEngine, TradingEngine, and ChartManager.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const uploadModal = document.getElementById('upload-modal');
  const uploadDropzone = document.getElementById('upload-dropzone');
  const fileInput = document.getElementById('csv-file-input');
  const uploadProgress = document.getElementById('upload-progress');
  const progressBar = document.getElementById('progress-bar-fill');
  const progressText = document.getElementById('progress-status-text');

  // Chart Containers
  window.chartManager.init('chart-container', 'rsi-chart-container');

  // Toast Notification System
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  window.tradingEngine.onNotification = showToast;

  // Initialize from cache or prompt file upload
  async function checkInitialData() {
    try {
      const cached = await window.simulatorDB.loadCandles();
      if (cached && cached.candles && cached.candles.length > 0) {
        showToast(`Loaded ${cached.candles.length.toLocaleString()} candles from local cache!`, 'success');
        startSessionWithData(cached.candles);
        if (uploadModal) uploadModal.style.display = 'none';
      } else {
        if (uploadModal) uploadModal.style.display = 'flex';
      }
    } catch (e) {
      console.error('Error loading cached data:', e);
      if (uploadModal) uploadModal.style.display = 'flex';
    }
  }

  /**
   * High-speed asynchronous chunked CSV parser.
   * Yields to UI thread periodically to maintain responsive animations and avoid SecurityError under file:// protocol.
   */
  async function parseCsvAsync(file, onProgress) {
    onProgress(5, 'Reading file into memory...');
    const text = await file.text();
    onProgress(15, 'Scanning lines...');

    const lines = text.split(/\r?\n/);
    const totalLines = lines.length;
    if (totalLines < 2) {
      throw new Error('CSV file appears empty or has only a header.');
    }

    const headerLine = lines[0].toLowerCase();
    const headers = headerLine.split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));

    const timeIdx = headers.findIndex(h => h.includes('time') || h.includes('date') || h === 'timestamp');
    const openIdx = headers.findIndex(h => h === 'open');
    const highIdx = headers.findIndex(h => h === 'high');
    const lowIdx = headers.findIndex(h => h === 'low');
    const closeIdx = headers.findIndex(h => h === 'close');
    const volIdx = headers.findIndex(h => h === 'volume' || h.includes('vol'));

    if (timeIdx === -1 || openIdx === -1 || highIdx === -1 || lowIdx === -1 || closeIdx === -1) {
      throw new Error('Could not identify essential columns (time, open, high, low, close). Found: ' + headers.join(', '));
    }

    const candles = [];
    const chunkSize = 25000;
    const maxIdx = Math.max(openIdx, highIdx, lowIdx, closeIdx);

    for (let i = 1; i < totalLines; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(',');
      if (cols.length <= maxIdx) continue;

      const rawTime = cols[timeIdx].trim();
      let timeInSeconds = 0;

      if (!isNaN(rawTime) && rawTime.length >= 10) {
        const num = Number(rawTime);
        timeInSeconds = num > 1e11 ? Math.floor(num / 1000) : Math.floor(num);
      } else {
        const dateStr = rawTime.replace(' ', 'T');
        const parsedMs = Date.parse(dateStr);
        if (!isNaN(parsedMs)) {
          timeInSeconds = Math.floor(parsedMs / 1000);
        } else {
          continue;
        }
      }

      const open = parseFloat(cols[openIdx]);
      const high = parseFloat(cols[highIdx]);
      const low = parseFloat(cols[lowIdx]);
      const close = parseFloat(cols[closeIdx]);
      const volume = volIdx !== -1 && cols[volIdx] ? parseFloat(cols[volIdx]) : 0;

      if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close) || timeInSeconds <= 0) {
        continue;
      }

      candles.push({
        time: timeInSeconds,
        open,
        high,
        low,
        close,
        volume: isNaN(volume) ? 0 : volume
      });

      if (i % chunkSize === 0) {
        const pct = Math.floor(15 + (i / totalLines) * 75);
        onProgress(pct, `Parsed ${candles.length.toLocaleString()} candles...`);
        // Yield to browser UI thread
        await new Promise(r => setTimeout(r, 0));
      }
    }

    onProgress(92, 'Sorting and validating dataset...');
    await new Promise(r => setTimeout(r, 0));

    candles.sort((a, b) => a.time - b.time);

    const deduped = [];
    for (let i = 0; i < candles.length; i++) {
      if (i === 0 || candles[i].time > deduped[deduped.length - 1].time) {
        deduped.push(candles[i]);
      }
    }

    onProgress(100, 'Ready!');
    return {
      candles: deduped,
      metadata: {
        fileName: file.name,
        fileSize: file.size,
        count: deduped.length,
        startTime: deduped.length > 0 ? deduped[0].time : 0,
        endTime: deduped.length > 0 ? deduped[deduped.length - 1].time : 0
      }
    };
  }

  // Handle CSV file processing (works directly under file:/// or http://)
  async function handleFile(file) {
    if (!file) return;
    if (uploadProgress) uploadProgress.style.display = 'block';

    const onProgress = (percent, message) => {
      if (progressBar) progressBar.style.width = `${percent}%`;
      if (progressText) progressText.innerText = `${message} (${percent}%)`;
    };

    try {
      const result = await parseCsvAsync(file, onProgress);
      if (progressBar) progressBar.style.width = '100%';
      if (progressText) progressText.innerText = 'Caching into local database for instant future reloads...';

      try {
        await window.simulatorDB.saveCandles(result.candles, result.metadata);
        showToast(`Successfully parsed and cached ${result.candles.length.toLocaleString()} candles!`, 'success');
      } catch (dbErr) {
        console.warn('DB caching bypassed:', dbErr);
        showToast(`Parsed ${result.candles.length.toLocaleString()} candles!`, 'success');
      }

      setTimeout(() => {
        if (uploadModal) uploadModal.style.display = 'none';
        startSessionWithData(result.candles);
      }, 400);
    } catch (err) {
      console.error('Parser error:', err);
      showToast(`Parser error: ${err.message}`, 'error');
      if (progressText) progressText.innerText = `Error: ${err.message}`;
    }
  }

  // Drag and drop setup
  if (uploadDropzone) {
    uploadDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadDropzone.classList.add('dragover');
    });
    uploadDropzone.addEventListener('dragleave', () => {
      uploadDropzone.classList.remove('dragover');
    });
    uploadDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadDropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
      }
    });
  }

  // Start / Spawn session
  function startSessionWithData(candles) {
    window.dataEngine.setCandles(candles);
    window.replayEngine.startRandomSession();
    updateUIHeader();
  }

  // Replay tick handler - O(1) execution (<0.05ms, buttery-smooth 60fps)
  window.replayEngine.onTick = (candle, currentIndex) => {
    // 1. Process Trading Engine tick (liquidation, SL, TP)
    window.tradingEngine.processCandleTick(candle);

    // 2. Incremental append candle to chart (smooth +1 length increment)
    const currentTf = window.dataEngine.currentTimeframe;
    const activeCandle = window.dataEngine.getLatestResampledCandle(candle, currentTf);
    window.chartManager.appendCandle(activeCandle);

    // 3. Update HUD header & price info
    updatePriceHUD(candle);

    // 4. Update Analytics HUD in real-time (Net PnL, live Equity)
    updateAnalyticsHUD();
  };

  // Replay state change handler
  window.replayEngine.onStateChange = (state) => {
    const playBtn = document.getElementById('btn-play-pause');
    if (playBtn) {
      playBtn.innerHTML = state.isPlaying 
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Play';
      playBtn.classList.toggle('active', state.isPlaying);
    }

    const sessionBarBadge = document.getElementById('session-bar-counter');
    if (sessionBarBadge) {
      sessionBarBadge.innerText = `Session ${state.sessionNumber}`;
    }

    const clockBadge = document.getElementById('inhouse-clock-badge');
    if (clockBadge && state.clockStr) {
      clockBadge.innerText = state.clockStr;
    }
  };

  // Update Price HUD at top and Floating Chart Legend
  function updatePriceHUD(candle) {
    if (!candle) return;
    const priceEl = document.getElementById('hud-current-price');
    const legOpen = document.getElementById('legend-open');
    const legHigh = document.getElementById('legend-high');
    const legLow = document.getElementById('legend-low');
    const legClose = document.getElementById('legend-close');
    const legVol = document.getElementById('legend-vol');

    if (priceEl) {
      priceEl.innerText = `$${candle.close.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      priceEl.className = candle.close >= candle.open ? 'price-up' : 'price-down';
    }

    // TradingView-style Floating Chart Legend
    if (legOpen) legOpen.innerText = `O: ${candle.open.toFixed(2)}`;
    if (legHigh) legHigh.innerText = `H: ${candle.high.toFixed(2)}`;
    if (legLow) legLow.innerText = `L: ${candle.low.toFixed(2)}`;
    if (legClose) {
      legClose.innerText = `C: ${candle.close.toFixed(2)}`;
      legClose.style.color = candle.close >= candle.open ? 'var(--color-green)' : 'var(--color-red)';
    }
    if (legVol) legVol.innerText = `Vol: ${candle.volume.toFixed(2)}`;

    // Update estimated R:R or size preview in order panel
    updateOrderCalculations();
  }

  function updateUIHeader() {
    const totalCount = window.dataEngine.getCount();
    const countBadge = document.getElementById('total-candles-count');
    if (countBadge) {
      countBadge.innerText = `${totalCount.toLocaleString()} bars`;
    }
    refreshChartData();
  }

  function refreshChartData() {
    const currentTf = window.dataEngine.currentTimeframe;
    const candles = window.dataEngine.getSessionCandles(
      window.replayEngine.startIndex,
      window.replayEngine.currentIndex,
      250,
      currentTf
    );
    window.chartManager.setData(candles);
  }
  window.refreshChartData = refreshChartData;

  // Setup Timeframe selector buttons
  const tfButtons = document.querySelectorAll('.tf-btn');
  tfButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tfButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tf = btn.getAttribute('data-tf');
      window.dataEngine.currentTimeframe = tf;
      refreshChartData();
      showToast(`Switched chart timeframe to ${tf.toUpperCase()}`, 'info');
    });
  });

  // Setup Indicator toggle buttons (Instant GPU toggle, zero freeze)
  const indButtons = document.querySelectorAll('.ind-btn');
  indButtons.forEach(btn => {
    const ind = btn.getAttribute('data-indicator');
    if (window.chartManager.activeIndicators[ind]) {
      btn.classList.add('active');
    }
    btn.addEventListener('click', () => {
      const active = window.chartManager.toggleIndicator(ind);
      btn.classList.toggle('active', active);
    });
  });

  // Replay Controls
  const btnPlay = document.getElementById('btn-play-pause');
  if (btnPlay) {
    btnPlay.addEventListener('click', () => window.replayEngine.togglePlay());
  }

  const btnStep = document.getElementById('btn-step-next');
  if (btnStep) {
    btnStep.addEventListener('click', () => window.replayEngine.step(1));
  }

  const btnStep5 = document.getElementById('btn-step-5');
  if (btnStep5) {
    btnStep5.addEventListener('click', () => window.replayEngine.step(5));
  }

  const speedPills = document.querySelectorAll('.speed-pill');
  speedPills.forEach(pill => {
    pill.addEventListener('click', () => {
      speedPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const speed = parseFloat(pill.getAttribute('data-speed'));
      window.replayEngine.setSpeed(speed);
    });
  });

  const btnRandomSession = document.getElementById('btn-random-session');
  if (btnRandomSession) {
    btnRandomSession.addEventListener('click', () => {
      if (confirm('Start a new blind random practice session? Current active trade will be cleared.')) {
        window.replayEngine.pause();
        window.chartManager.clearMarkers();
        window.chartManager.clearFibonacci();
        window.tradingEngine.position = null;
        window.tradingEngine.notifyUpdate();
        window.chartManager.updatePositionLines(null);
        window.replayEngine.startRandomSession();
        refreshChartData();
        showToast('Spawned into a new blind historical market regime!', 'info');
      }
    });
  }

  // Reveal Market Era Feature
  const btnRevealEra = document.getElementById('btn-reveal-era');
  const eraModal = document.getElementById('era-modal');
  const eraModalClose = document.getElementById('era-modal-close');
  if (btnRevealEra) {
    btnRevealEra.addEventListener('click', () => {
      const eraInfo = window.replayEngine.revealHistoricalEra();
      if (!eraInfo) return;

      const titleEl = document.getElementById('era-modal-title');
      const datesEl = document.getElementById('era-modal-dates');
      const descEl = document.getElementById('era-modal-description');
      const perfEl = document.getElementById('era-modal-performance');

      if (titleEl) titleEl.innerText = eraInfo.contextNote;
      if (datesEl) datesEl.innerText = `${eraInfo.startDateStr} → ${eraInfo.currentDateStr} (${eraInfo.durationBars} bars played)`;

      const candle = window.replayEngine.getCurrentCandle();
      const metrics = window.tradingEngine.getMetrics(candle ? candle.close : null);
      if (perfEl) {
        perfEl.innerHTML = `
          <div class="era-stat-grid">
            <div class="era-stat"><span>Net PnL</span><strong class="${metrics.netProfit >= 0 ? 'text-green' : 'text-red'}">${metrics.netProfit >= 0 ? '+' : ''}$${metrics.netProfit}</strong></div>
            <div class="era-stat"><span>Win Rate</span><strong>${metrics.winRate}%</strong></div>
            <div class="era-stat"><span>Trades</span><strong>${metrics.totalTrades}</strong></div>
            <div class="era-stat"><span>Profit Factor</span><strong>${metrics.profitFactor}</strong></div>
          </div>
        `;
      }

      if (eraModal) eraModal.style.display = 'flex';
      refreshChartData();
    });
  }

  if (eraModalClose) {
    eraModalClose.addEventListener('click', () => {
      if (eraModal) eraModal.style.display = 'none';
    });
  }

  // Trading & Order Form Logic
  let selectedSide = 'LONG';
  let riskPercent = 1; // 1% default

  const tabLong = document.getElementById('tab-side-long');
  const tabShort = document.getElementById('tab-side-short');
  const btnSubmitOrder = document.getElementById('btn-submit-order');

  if (tabLong && tabShort) {
    tabLong.addEventListener('click', () => {
      selectedSide = 'LONG';
      tabLong.classList.add('active');
      tabShort.classList.remove('active');
      if (btnSubmitOrder) {
        btnSubmitOrder.innerText = 'Buy / Long BTC';
        btnSubmitOrder.className = 'btn-order-submit btn-buy';
      }
      updateOrderCalculations();
    });

    tabShort.addEventListener('click', () => {
      selectedSide = 'SHORT';
      tabShort.classList.add('active');
      tabLong.classList.remove('active');
      if (btnSubmitOrder) {
        btnSubmitOrder.innerText = 'Sell / Short BTC';
        btnSubmitOrder.className = 'btn-order-submit btn-sell';
      }
      updateOrderCalculations();
    });
  }

  // Risk % Pills
  const riskPills = document.querySelectorAll('.risk-pill');
  riskPills.forEach(pill => {
    pill.addEventListener('click', () => {
      riskPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      riskPercent = parseFloat(pill.getAttribute('data-risk'));
      updateOrderCalculations();
    });
  });

  // Leverage Slider & Presets
  const leverageSlider = document.getElementById('leverage-slider');
  const leverageValueBadge = document.getElementById('leverage-value-badge');
  const levPresets = document.querySelectorAll('.lev-preset');

  if (leverageSlider && leverageValueBadge) {
    leverageSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      leverageValueBadge.innerText = `${val}x`;
      levPresets.forEach(p => p.classList.toggle('active', parseInt(p.innerText) === val));
      updateOrderCalculations();
    });
  }

  levPresets.forEach(preset => {
    preset.addEventListener('click', () => {
      const val = parseInt(preset.getAttribute('data-lev'));
      if (leverageSlider) leverageSlider.value = val;
      if (leverageValueBadge) leverageValueBadge.innerText = `${val}x`;
      levPresets.forEach(p => p.classList.remove('active'));
      preset.classList.add('active');
      updateOrderCalculations();
    });
  });

  const inputSL = document.getElementById('input-stop-loss');
  const inputTP = document.getElementById('input-take-profit');
  const inputSizeUsdt = document.getElementById('input-size-usdt');

  [inputSL, inputTP, inputSizeUsdt].forEach(inp => {
    if (inp) inp.addEventListener('input', updateOrderCalculations);
  });

  // Calculate position sizing and preview
  function updateOrderCalculations() {
    const candle = window.replayEngine.getCurrentCandle();
    if (!candle) return;
    const entryPrice = candle.close;
    const slVal = parseFloat(inputSL ? inputSL.value : 0) || null;
    const tpVal = parseFloat(inputTP ? inputTP.value : 0) || null;
    const leverage = parseInt(leverageSlider ? leverageSlider.value : 10);

    const calcRiskSize = document.getElementById('calc-risk-size');
    const calcRRPreview = document.getElementById('calc-rr-preview');
    const calcLiqPreview = document.getElementById('calc-liq-preview');

    // Risk sizing calculation
    if (slVal && slVal !== entryPrice) {
      const riskCalc = window.tradingEngine.calculateSizeByRisk(riskPercent, entryPrice, slVal);
      if (riskCalc && calcRiskSize) {
        calcRiskSize.innerText = `${riskCalc.sizeBtc} BTC ($${riskCalc.notionalUsdt.toLocaleString()}) [Risk: $${riskCalc.dollarRisk}]`;
        if (inputSizeUsdt && document.activeElement !== inputSizeUsdt) {
          inputSizeUsdt.value = riskCalc.notionalUsdt;
        }
      }

      // Risk : Reward ratio
      if (tpVal && calcRRPreview) {
        const riskDist = Math.abs(entryPrice - slVal);
        const rewardDist = Math.abs(tpVal - entryPrice);
        const rr = (rewardDist / riskDist).toFixed(2);
        calcRRPreview.innerText = `1 : ${rr}`;
        calcRRPreview.className = rr >= 2 ? 'text-green font-bold' : (rr >= 1 ? 'text-yellow' : 'text-red');
      }
    } else {
      if (calcRiskSize) calcRiskSize.innerText = '--';
      if (calcRRPreview) calcRRPreview.innerText = '--';
    }

    // Liquidation price preview
    if (calcLiqPreview) {
      const estLiq = window.tradingEngine.calculateLiquidationPrice(selectedSide, entryPrice, leverage);
      calcLiqPreview.innerText = `$${estLiq.toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
    }
  }

  // Submit Order Execution
  if (btnSubmitOrder) {
    btnSubmitOrder.addEventListener('click', () => {
      const candle = window.replayEngine.getCurrentCandle();
      if (!candle) return;

      const entryPrice = candle.close;
      const leverage = parseInt(leverageSlider ? leverageSlider.value : 10);
      const slVal = parseFloat(inputSL ? inputSL.value : 0) || null;
      const tpVal = parseFloat(inputTP ? inputTP.value : 0) || null;
      const tagSelect = document.getElementById('select-strategy-tag');
      const tag = tagSelect ? tagSelect.value : 'Discretionary';

      let sizeBtc = 0;
      const notionalUsdt = parseFloat(inputSizeUsdt ? inputSizeUsdt.value : 0);
      if (notionalUsdt > 0) {
        sizeBtc = notionalUsdt / entryPrice;
      } else if (slVal) {
        const riskCalc = window.tradingEngine.calculateSizeByRisk(riskPercent, entryPrice, slVal);
        if (riskCalc) sizeBtc = riskCalc.sizeBtc;
      }

      if (sizeBtc <= 0) {
        showToast('Please specify a position size or enter a Stop Loss for % Risk sizing.', 'error');
        return;
      }

      const success = window.tradingEngine.openMarketPosition({
        side: selectedSide,
        entryPrice,
        sizeBtc,
        leverage,
        stopLoss: slVal,
        takeProfit: tpVal,
        tag,
        time: candle.time
      });

      if (success) {
        window.chartManager.addTradeMarker(candle.time, selectedSide, true);
        window.chartManager.updatePositionLines(window.tradingEngine.position);
      }
    });
  }

  // Position Update Handler
  window.tradingEngine.onPositionUpdate = (state) => {
    window.chartManager.updatePositionLines(state.position);
    updatePositionHUD(state);
    updateAnalyticsHUD();
  };

  // Trade Closed Handler
  window.tradingEngine.onTradeClosed = (trade) => {
    const candle = window.replayEngine.getCurrentCandle();
    if (candle) {
      window.chartManager.addTradeMarker(candle.time, trade.side, false);
    }
    renderTradeHistoryTable();
    updateAnalyticsHUD();
  };

  // Active Position HUD updates
  function updatePositionHUD(state) {
    const pos = state.position;
    const hud = document.getElementById('active-position-card');
    if (!hud) return;

    if (!pos) {
      hud.style.display = 'none';
      return;
    }

    hud.style.display = 'block';
    const sideBadge = document.getElementById('pos-side-badge');
    const sizeEl = document.getElementById('pos-size-val');
    const entryEl = document.getElementById('pos-entry-val');
    const markEl = document.getElementById('pos-mark-val');
    const liqEl = document.getElementById('pos-liq-val');
    const pnlEl = document.getElementById('pos-pnl-val');
    const roeEl = document.getElementById('pos-roe-val');

    if (sideBadge) {
      sideBadge.innerText = `${pos.side} ${pos.leverage}x`;
      sideBadge.className = `badge badge-${pos.side.toLowerCase()}`;
    }
    if (sizeEl) sizeEl.innerText = `${pos.sizeBtc.toFixed(4)} BTC ($${pos.sizeUsdt.toFixed(0)})`;
    if (entryEl) entryEl.innerText = `$${pos.entryPrice.toLocaleString()}`;
    if (markEl) markEl.innerText = `$${pos.currentPrice.toLocaleString()}`;
    if (liqEl) liqEl.innerText = `$${pos.liquidationPrice.toFixed(1)}`;

    const pnl = state.unrealizedPnl;
    const roe = state.unrealizedRoe;

    if (pnlEl) {
      pnlEl.innerText = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
      pnlEl.className = pnl >= 0 ? 'text-green font-bold' : 'text-red font-bold';
    }
    if (roeEl) {
      roeEl.innerText = `(${roe >= 0 ? '+' : ''}${roe.toFixed(2)}%)`;
      roeEl.className = roe >= 0 ? 'text-green' : 'text-red';
    }
  }

  // Position Actions (Breakeven, Partial Closes)
  const btnBreakeven = document.getElementById('btn-pos-breakeven');
  if (btnBreakeven) {
    btnBreakeven.addEventListener('click', () => window.tradingEngine.moveToBreakeven());
  }

  const btnClose25 = document.getElementById('btn-close-25');
  const btnClose50 = document.getElementById('btn-close-50');
  const btnClose100 = document.getElementById('btn-close-100');

  function handleClose(pct) {
    const candle = window.replayEngine.getCurrentCandle();
    if (!candle) return;
    window.tradingEngine.closePartial(pct, candle.close, 'MANUAL', candle.time);
  }

  if (btnClose25) btnClose25.addEventListener('click', () => handleClose(25));
  if (btnClose50) btnClose50.addEventListener('click', () => handleClose(50));
  if (btnClose100) btnClose100.addEventListener('click', () => handleClose(100));

  // Analytics & Metrics HUD
  function updateAnalyticsHUD() {
    const candle = window.replayEngine.getLiveCandle() || window.replayEngine.getCurrentCandle();
    const metrics = window.tradingEngine.getMetrics(candle ? candle.close : null);

    const equityEl = document.getElementById('metric-equity');
    const balanceEl = document.getElementById('metric-balance');
    const winRateEl = document.getElementById('metric-winrate');
    const profitFactorEl = document.getElementById('metric-profit-factor');
    const drawdownEl = document.getElementById('metric-drawdown');
    const netPnlEl = document.getElementById('metric-net-pnl');

    if (equityEl) equityEl.innerText = `$${metrics.equity.toLocaleString()}`;
    if (balanceEl) balanceEl.innerText = `$${metrics.currentBalance.toLocaleString()}`;
    if (winRateEl) winRateEl.innerText = `${metrics.winRate}% (${metrics.winCount}W / ${metrics.lossCount}L)`;
    if (profitFactorEl) profitFactorEl.innerText = metrics.profitFactor;
    if (drawdownEl) drawdownEl.innerText = `${metrics.maxDrawdownPercent}%`;
    if (netPnlEl) {
      netPnlEl.innerText = `${metrics.netProfit >= 0 ? '+' : ''}$${metrics.netProfit.toLocaleString()} (${metrics.totalReturnPercent}%)`;
      netPnlEl.className = metrics.netProfit >= 0 ? 'text-green font-bold' : 'text-red font-bold';
    }
  }

  // Render Closed Trades Table
  function renderTradeHistoryTable() {
    const tbody = document.getElementById('trade-history-tbody');
    if (!tbody) return;
    const trades = window.tradingEngine.closedTrades;

    if (trades.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No closed trades yet. Open a position to start backtesting.</td></tr>';
      return;
    }

    tbody.innerHTML = trades.slice().reverse().map(t => {
      const pnlClass = t.pnlUsdt >= 0 ? 'text-green' : 'text-red';
      const sideClass = t.side === 'LONG' ? 'badge-long' : 'badge-short';
      return `
        <tr>
          <td>#${t.id}</td>
          <td><span class="badge ${sideClass}">${t.side} ${t.leverage}x</span></td>
          <td><span class="badge badge-tag">${t.tag || 'Discretionary'}</span></td>
          <td>$${t.entryPrice.toLocaleString()}</td>
          <td>$${t.exitPrice.toLocaleString()}</td>
          <td>${t.sizeBtc.toFixed(4)} BTC</td>
          <td class="${pnlClass} font-bold">${t.pnlUsdt >= 0 ? '+' : ''}$${t.pnlUsdt} (${t.pnlPercent}%)</td>
          <td><span class="badge badge-reason">${t.exitReason}</span></td>
        </tr>
      `;
    }).join('');
  }

  // Render Equity Curve on HTML5 Canvas
  function renderEquityCurve() {
    const canvas = document.getElementById('equity-curve-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const history = window.tradingEngine.equityHistory;

    // Handle high DPI
    const width = canvas.parentElement.clientWidth || 400;
    const height = 160;
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    ctx.clearRect(0, 0, width, height);

    if (history.length < 2) {
      ctx.fillStyle = '#787b86';
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Execute trades to plot your Equity Curve', width / 2, height / 2);
      return;
    }

    const equities = history.map(h => h.equity);
    const minEq = Math.min(...equities) * 0.98;
    const maxEq = Math.max(...equities) * 1.02;
    const range = maxEq - minEq || 1;

    // Gradient background
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, 'rgba(8, 153, 129, 0.3)');
    grad.addColorStop(1, 'rgba(8, 153, 129, 0.0)');

    ctx.beginPath();
    history.forEach((pt, idx) => {
      const x = (idx / (history.length - 1)) * (width - 40) + 20;
      const y = height - 20 - ((pt.equity - minEq) / range) * (height - 40);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    // Stroke line
    ctx.strokeStyle = '#089981';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Fill area below
    ctx.lineTo(width - 20, height - 10);
    ctx.lineTo(20, height - 10);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Draw baseline
    const initialEq = window.tradingEngine.initialBalance;
    const baseY = height - 20 - ((initialEq - minEq) / range) * (height - 40);
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.moveTo(20, baseY);
    ctx.lineTo(width - 20, baseY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Export Trade Journal to CSV
  const btnExportCsv = document.getElementById('btn-export-journal');
  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', () => {
      const trades = window.tradingEngine.closedTrades;
      if (trades.length === 0) {
        showToast('No trades to export.', 'info');
        return;
      }

      const headers = ['ID', 'Side', 'Leverage', 'Strategy_Tag', 'Entry_Price', 'Exit_Price', 'Size_BTC', 'PnL_USDT', 'ROE_Percent', 'Exit_Reason'];
      const rows = trades.map(t => [
        t.id, t.side, `${t.leverage}x`, t.tag, t.entryPrice, t.exitPrice, t.sizeBtc, t.pnlUsdt, t.pnlPercent, t.exitReason
      ]);

      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `btc_backtest_journal_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast('Exported trade journal to CSV!', 'success');
    });
  }

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    // Avoid shortcuts if typing in input box
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;

    if (e.code === 'Space') {
      e.preventDefault();
      window.replayEngine.togglePlay();
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      e.preventDefault();
      if (e.shiftKey) {
        window.replayEngine.step(5);
      } else {
        window.replayEngine.step(1);
      }
    } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      e.preventDefault();
      if (e.shiftKey) {
        window.replayEngine.stepBack(5);
      } else {
        window.replayEngine.stepBack(1);
      }
    } else if (e.code === 'KeyB') {
      if (tabLong) tabLong.click();
    } else if (e.code === 'KeyS' && !e.shiftKey) {
      if (tabShort) tabShort.click();
    } else if (e.code === 'KeyC') {
      handleClose(100);
    } else if (e.code === 'KeyX') {
      window.tradingEngine.moveToBreakeven();
    } else if (e.code === 'Digit1') {
      const btn = document.querySelector('.tf-btn[data-tf="5m"]');
      if (btn) btn.click();
    } else if (e.code === 'Digit2') {
      const btn = document.querySelector('.tf-btn[data-tf="15m"]');
      if (btn) btn.click();
    } else if (e.code === 'Digit3') {
      const btn = document.querySelector('.tf-btn[data-tf="1h"]');
      if (btn) btn.click();
    } else if (e.code === 'Digit4') {
      const btn = document.querySelector('.tf-btn[data-tf="4h"]');
      if (btn) btn.click();
    }
  });

  // Re-render canvas on window resize
  window.addEventListener('resize', renderEquityCurve);

  // Check cache on load
  checkInitialData();
});
