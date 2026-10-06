/**
 * Pro Chart Drawing Engine (Pencil & Eraser)
 * Anchors drawings to chart coordinates (Logical bar index & Price)
 * Keeps freehand drawings locked to candles during pan, zoom, and time updates.
 */

class DrawingManager {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.container = null;
    this.chartManager = null;

    // Active Tool: 'cursor', 'pencil', 'eraser'
    this.activeTool = 'cursor';

    // Style options
    this.color = '#ffd700'; // Default TradingView Gold
    this.width = 2.5; // Default medium stroke
    this.eraserRadius = 14;

    // Storage
    this.strokes = []; // Array of { id, color, width, points: [{ logical, price, time, x, y }] }
    this.undoStack = [];
    this.redoStack = [];

    // Interaction state
    this.isDrawing = false;
    this.currentStroke = null;
    this.mousePos = { x: 0, y: 0 };
    this.isPanningChart = false;
    this.panFrameId = null;

    // Bound listeners for clean lifecycle
    this._onPointerDown = this.onPointerDown.bind(this);
    this._onPointerMove = this.onPointerMove.bind(this);
    this._onPointerUp = this.onPointerUp.bind(this);
  }

  /**
   * Initialize drawing overlay over chart container
   */
  init(chartManager, containerId = 'chart-container') {
    this.chartManager = chartManager;
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    // Create Canvas element
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'chart-drawing-canvas';
    this.canvas.className = 'chart-drawing-canvas';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    // Size canvas to container
    this.resizeCanvas();

    // Resize observer
    const ro = new ResizeObserver(() => {
      this.resizeCanvas();
      this.renderAll();
    });
    ro.observe(this.container);

    // Event Listeners for drawing
    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);

    // Sync with Lightweight Charts pan & zoom
    if (this.chartManager && this.chartManager.chart) {
      this.chartManager.chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
        this.renderAll();
      });
    }

    // When chart container receives wheel or mouse interactions in cursor mode, keep drawings synced
    this.container.addEventListener('wheel', () => {
      requestAnimationFrame(() => this.renderAll());
    }, { passive: true });

    // Track when user is dragging chart in cursor mode
    this.container.addEventListener('mousedown', (e) => {
      if (this.activeTool === 'cursor' && e.button === 0) {
        this.isPanningChart = true;
        const renderLoop = () => {
          if (this.isPanningChart) {
            this.renderAll();
            this.panFrameId = requestAnimationFrame(renderLoop);
          }
        };
        this.panFrameId = requestAnimationFrame(renderLoop);
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isPanningChart) {
        this.isPanningChart = false;
        if (this.panFrameId) {
          cancelAnimationFrame(this.panFrameId);
          this.panFrameId = null;
        }
        this.renderAll();
      }
    });

    // Default to cursor tool
    this.setTool('cursor');
  }

  /**
   * Resize canvas matching container resolution with DPR support
   */
  resizeCanvas() {
    if (!this.canvas || !this.container) return;
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
  }

  /**
   * Set active tool ('cursor', 'pencil', 'eraser')
   */
  setTool(tool) {
    this.activeTool = tool;
    if (!this.canvas) return;

    if (tool === 'pencil') {
      this.canvas.style.pointerEvents = 'auto';
      this.canvas.className = 'chart-drawing-canvas tool-pencil';
      if (this.chartManager && this.chartManager.chart) {
        this.chartManager.chart.applyOptions({
          handleScroll: false,
          handleScale: false
        });
      }
    } else if (tool === 'eraser') {
      this.canvas.style.pointerEvents = 'auto';
      this.canvas.className = 'chart-drawing-canvas tool-eraser';
      if (this.chartManager && this.chartManager.chart) {
        this.chartManager.chart.applyOptions({
          handleScroll: false,
          handleScale: false
        });
      }
    } else {
      // Cursor / Pan mode
      this.activeTool = 'cursor';
      this.canvas.style.pointerEvents = 'none';
      this.canvas.className = 'chart-drawing-canvas tool-cursor';
      if (this.chartManager && this.chartManager.chart) {
        this.chartManager.chart.applyOptions({
          handleScroll: true,
          handleScale: true
        });
      }
    }

    this.renderAll();
  }

  /**
   * Set drawing color
   */
  setColor(color) {
    this.color = color;
  }

  /**
   * Set line width
   */
  setWidth(width) {
    this.width = Math.max(1, width);
  }

  /**
   * Pointer Down handler
   */
  onPointerDown(e) {
    if (e.button !== 0) return; // Left click only
    if (this.activeTool === 'cursor') return;

    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    this.isDrawing = true;
    this.mousePos = { x, y };

    if (this.activeTool === 'pencil') {
      const coord = this.screenToChart(x, y);
      this.currentStroke = {
        id: Date.now() + Math.random(),
        color: this.color,
        width: this.width,
        points: [coord]
      };
      this.renderAll();
    } else if (this.activeTool === 'eraser') {
      this.eraseAt(x, y);
    }
  }

  /**
   * Pointer Move handler
   */
  onPointerMove(e) {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    this.mousePos = { x, y };

    if (this.isDrawing) {
      if (this.activeTool === 'pencil' && this.currentStroke) {
        const pts = this.currentStroke.points;
        const last = pts[pts.length - 1];
        // Throttle points to minimum 2px movement
        const dist = Math.hypot(x - last.x, y - last.y);
        if (dist >= 2) {
          const coord = this.screenToChart(x, y);
          pts.push(coord);
          this.renderAll();
        }
      } else if (this.activeTool === 'eraser') {
        this.eraseAt(x, y);
      }
    } else if (this.activeTool === 'eraser') {
      // Re-render to show hover eraser circle
      this.renderAll();
    }
  }

  /**
   * Pointer Up handler
   */
  onPointerUp() {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    if (this.activeTool === 'pencil' && this.currentStroke) {
      if (this.currentStroke.points.length > 0) {
        this.strokes.push(this.currentStroke);
        this.undoStack.push({
          type: 'add',
          stroke: this.currentStroke
        });
        this.redoStack = [];
      }
      this.currentStroke = null;
    }

    this.renderAll();
  }

  /**
   * Erase stroke(s) at given screen coordinate
   */
  eraseAt(screenX, screenY) {
    let erasedAny = false;

    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const stroke = this.strokes[i];
      const screenPts = this.strokeToScreenPoints(stroke);
      if (this.isNearStroke(screenPts, screenX, screenY, this.eraserRadius + stroke.width / 2)) {
        const removed = this.strokes.splice(i, 1)[0];
        this.undoStack.push({
          type: 'erase',
          stroke: removed,
          index: i
        });
        this.redoStack = [];
        erasedAny = true;
      }
    }

    if (erasedAny) {
      this.renderAll();
    }
  }

  /**
   * Check if a point is within threshold distance of any segment of a stroke
   */
  isNearStroke(points, px, py, threshold) {
    if (!points || points.length === 0) return false;
    const threshSq = threshold * threshold;

    if (points.length === 1) {
      const d2 = (points[0].x - px) ** 2 + (points[0].y - py) ** 2;
      return d2 <= threshSq;
    }

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const d2 = this.distToSegmentSquared(px, py, p1.x, p1.y, p2.x, p2.y);
      if (d2 <= threshSq) return true;
    }
    return false;
  }

  /**
   * Squared distance from point (px, py) to line segment (x1, y1)-(x2, y2)
   */
  distToSegmentSquared(px, py, x1, y1, x2, y2) {
    const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    if (l2 === 0) return (px - x1) ** 2 + (py - y1) ** 2;
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * (x2 - x1);
    const projY = y1 + t * (y2 - y1);
    return (px - projX) ** 2 + (py - projY) ** 2;
  }

  /**
   * Convert screen (x, y) into chart coordinates (logical bar index & price)
   */
  screenToChart(x, y) {
    let logical = null;
    let price = null;
    let time = null;

    if (this.chartManager && this.chartManager.chart && this.chartManager.candleSeries) {
      try {
        logical = this.chartManager.chart.timeScale().coordinateToLogical(x);
        time = this.chartManager.chart.timeScale().coordinateToTime(x);
        price = this.chartManager.candleSeries.coordinateToPrice(y);
      } catch (err) {
        // Safe fallback
      }
    }

    return { logical, price, time, x, y };
  }

  /**
   * Convert chart coordinates of a stroke into current screen points
   */
  strokeToScreenPoints(stroke) {
    const screenPts = [];
    const timeScale = this.chartManager?.chart?.timeScale();
    const candleSeries = this.chartManager?.candleSeries;

    for (const pt of stroke.points) {
      let sx = null;
      let sy = null;

      if (timeScale && pt.logical !== null && pt.logical !== undefined) {
        sx = timeScale.logicalToCoordinate(pt.logical);
      } else if (timeScale && pt.time) {
        sx = timeScale.timeToCoordinate(pt.time);
      }

      if (candleSeries && pt.price !== null && pt.price !== undefined) {
        sy = candleSeries.priceToCoordinate(pt.price);
      }

      // Fallback if chart coordinates could not be resolved
      if (sx === null && pt.x !== undefined) sx = pt.x;
      if (sy === null && pt.y !== undefined) sy = pt.y;

      if (sx !== null && sy !== null) {
        screenPts.push({ x: sx, y: sy });
      }
    }

    return screenPts;
  }

  /**
   * Render all strokes onto canvas with smooth curves
   */
  renderAll() {
    if (!this.ctx || !this.canvas) return;
    const rect = this.container.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);

    // Render committed strokes
    for (const stroke of this.strokes) {
      this.drawStroke(stroke);
    }

    // Render currently active stroke (while drawing)
    if (this.currentStroke) {
      this.drawStroke(this.currentStroke);
    }

    // Render eraser cursor circle preview if hovering in eraser mode
    if (this.activeTool === 'eraser' && this.mousePos) {
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.arc(this.mousePos.x, this.mousePos.y, this.eraserRadius, 0, Math.PI * 2);
      this.ctx.fillStyle = 'rgba(242, 54, 69, 0.15)';
      this.ctx.fill();
      this.ctx.lineWidth = 1.5;
      this.ctx.strokeStyle = 'rgba(242, 54, 69, 0.8)';
      this.ctx.stroke();
      this.ctx.restore();
    }
  }

  /**
   * Draw a single stroke with smooth quadratic bezier curves
   */
  drawStroke(stroke) {
    const pts = this.strokeToScreenPoints(stroke);
    if (!pts || pts.length === 0) return;

    this.ctx.save();
    this.ctx.strokeStyle = stroke.color;
    this.ctx.fillStyle = stroke.color;
    this.ctx.lineWidth = stroke.width;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    if (pts.length === 1) {
      // Single dot
      this.ctx.beginPath();
      this.ctx.arc(pts[0].x, pts[0].y, stroke.width / 2, 0, Math.PI * 2);
      this.ctx.fill();
    } else if (pts.length === 2) {
      // Simple line segment
      this.ctx.beginPath();
      this.ctx.moveTo(pts[0].x, pts[0].y);
      this.ctx.lineTo(pts[1].x, pts[1].y);
      this.ctx.stroke();
    } else {
      // Smooth Quadratic Bezier curve through midpoints
      this.ctx.beginPath();
      this.ctx.moveTo(pts[0].x, pts[0].y);

      for (let i = 1; i < pts.length - 1; i++) {
        const xc = (pts[i].x + pts[i + 1].x) / 2;
        const yc = (pts[i].y + pts[i + 1].y) / 2;
        this.ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
      }

      const last = pts[pts.length - 1];
      this.ctx.lineTo(last.x, last.y);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  /**
   * Undo last drawing or erase action
   */
  undo() {
    if (this.undoStack.length === 0) return;
    const action = this.undoStack.pop();

    if (action.type === 'add') {
      const idx = this.strokes.indexOf(action.stroke);
      if (idx !== -1) {
        this.strokes.splice(idx, 1);
      }
      this.redoStack.push(action);
    } else if (action.type === 'erase') {
      const insertIdx = Math.min(action.index, this.strokes.length);
      this.strokes.splice(insertIdx, 0, action.stroke);
      this.redoStack.push(action);
    } else if (action.type === 'clear') {
      this.strokes = action.strokes.slice();
      this.redoStack.push(action);
    }

    this.renderAll();
  }

  /**
   * Redo action
   */
  redo() {
    if (this.redoStack.length === 0) return;
    const action = this.redoStack.pop();

    if (action.type === 'add') {
      this.strokes.push(action.stroke);
      this.undoStack.push(action);
    } else if (action.type === 'erase') {
      const idx = this.strokes.indexOf(action.stroke);
      if (idx !== -1) {
        this.strokes.splice(idx, 1);
      }
      this.undoStack.push(action);
    } else if (action.type === 'clear') {
      this.strokes = [];
      this.undoStack.push(action);
    }

    this.renderAll();
  }

  /**
   * Clear all drawings
   */
  clear() {
    if (this.strokes.length === 0) return;
    this.undoStack.push({
      type: 'clear',
      strokes: this.strokes.slice()
    });
    this.redoStack = [];
    this.strokes = [];
    this.renderAll();
  }
}

// Global instance
window.drawingManager = new DrawingManager();
