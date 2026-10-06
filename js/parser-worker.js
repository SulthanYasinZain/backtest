/**
 * Web Worker for high-speed streaming CSV parsing of large historical candlestick datasets.
 */

self.onmessage = async function(e) {
  const { file } = e.data;
  if (!file) {
    self.postMessage({ type: 'error', error: 'No file provided.' });
    return;
  }

  try {
    self.postMessage({ type: 'progress', percent: 5, message: 'Reading file into memory...' });
    const text = await file.text();
    const totalBytes = text.length;
    self.postMessage({ type: 'progress', percent: 15, message: 'Parsing candles...' });

    const lines = text.split(/\r?\n/);
    const totalLines = lines.length;
    if (totalLines < 2) {
      throw new Error('CSV file appears empty or has only a header.');
    }

    // Determine header mapping
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
    const reportInterval = Math.max(10000, Math.floor(totalLines / 20));
    let lastReport = 0;

    for (let i = 1; i < totalLines; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(',');
      if (cols.length <= Math.max(openIdx, highIdx, lowIdx, closeIdx)) continue;

      // Parse timestamp
      const rawTime = cols[timeIdx].trim();
      let timeInSeconds = 0;

      if (!isNaN(rawTime) && rawTime.length >= 10) {
        // Timestamp in ms or s
        const num = Number(rawTime);
        timeInSeconds = num > 1e11 ? Math.floor(num / 1000) : Math.floor(num);
      } else {
        // ISO or standard date string e.g. "2020-01-01 00:00:00"
        // Replace space with 'T' for safer Date parsing
        const dateStr = rawTime.replace(' ', 'T');
        const parsedMs = Date.parse(dateStr);
        if (!isNaN(parsedMs)) {
          timeInSeconds = Math.floor(parsedMs / 1000);
        } else {
          continue; // skip invalid date
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

      if (i - lastReport >= reportInterval) {
        lastReport = i;
        const pct = Math.floor(15 + (i / totalLines) * 75);
        self.postMessage({
          type: 'progress',
          percent: pct,
          message: `Parsed ${candles.length.toLocaleString()} candles...`
        });
      }
    }

    self.postMessage({ type: 'progress', percent: 92, message: 'Sorting and validating dataset...' });

    // Ensure sorted chronologically and deduplicate identical timestamps
    candles.sort((a, b) => a.time - b.time);

    const deduped = [];
    for (let i = 0; i < candles.length; i++) {
      if (i === 0 || candles[i].time > deduped[deduped.length - 1].time) {
        deduped.push(candles[i]);
      }
    }

    self.postMessage({ type: 'progress', percent: 100, message: 'Ready!' });
    self.postMessage({
      type: 'complete',
      candles: deduped,
      metadata: {
        fileName: file.name,
        fileSize: file.size,
        count: deduped.length,
        startTime: deduped.length > 0 ? deduped[0].time : 0,
        endTime: deduped.length > 0 ? deduped[deduped.length - 1].time : 0
      }
    });

  } catch (err) {
    self.postMessage({ type: 'error', error: err.message || 'Error parsing CSV' });
  }
};
