// ============================================================
// canvas-engine.js — LabelStudio v4
// Fixes: real scannable barcodes via JsBarcode, visibility
//        toggle per element, JSON template import, sharp canvas
// ============================================================

const MM_TO_PX    = 3.7795275591;
const RENDER_SCALE = 4;

class CanvasEngine {
  constructor(canvasEl, overlayEl) {
    this.canvas  = canvasEl;
    this.overlay = overlayEl;
    this.ctx     = canvasEl.getContext('2d');
    this.elements     = [];
    this.selected     = null;
    this.history      = [];
    this.historyIndex = -1;
    this.dragging     = false;
    this.resizing     = false;
    this.dragOffset   = { x: 0, y: 0 };
    this.resizeHandle = null;
    this.labelConfig  = {
      widthMm: 100, heightMm: 62,
      orientation: 'landscape',
      bgColor: '#ffffff', showBorder: true
    };
    this.zoom      = 1;
    this._qrCache  = {};
    this._bcCache  = {};   // barcode image cache  key→HTMLCanvasElement
    this.listeners = {};

    this._bindEvents();
    this._applyLabelConfig();
    this.saveHistory();
  }

  // ── Unit helpers ─────────────────────────────────────────
  mmToPx(mm) { return mm * MM_TO_PX; }
  pxToMm(px) { return +(px / MM_TO_PX).toFixed(2); }
  get labelWidthPx()  { return this.mmToPx(this.labelConfig.widthMm);  }
  get labelHeightPx() { return this.mmToPx(this.labelConfig.heightMm); }
  get canvasW() { return Math.round(this.labelWidthPx  * RENDER_SCALE); }
  get canvasH() { return Math.round(this.labelHeightPx * RENDER_SCALE); }

  on(event, cb)  { (this.listeners[event] = this.listeners[event] || []).push(cb); }
  emit(event, d) { (this.listeners[event] || []).forEach(cb => cb(d)); }

  // ── Config / sizing ───────────────────────────────────────
  _applyLabelConfig() {
    this.canvas.width  = this.canvasW;
    this.canvas.height = this.canvasH;
    this.canvas.style.width  = this.labelWidthPx  + 'px';
    this.canvas.style.height = this.labelHeightPx + 'px';
    this.overlay.style.width  = this.labelWidthPx  + 'px';
    this.overlay.style.height = this.labelHeightPx + 'px';
    this._bcCache = {};
    this._updateZoom();
    this.render();
    this.emit('configChanged', this.labelConfig);
  }

  setLabelMm(wMm, hMm) {
    this.labelConfig.widthMm  = Math.max(10, Math.min(wMm, 500));
    this.labelConfig.heightMm = Math.max(10, Math.min(hMm, 500));
    this._applyLabelConfig();
  }

  setOrientation(mode) {
    const { widthMm, heightMm } = this.labelConfig;
    if (mode === 'portrait'  && widthMm  > heightMm) { this.labelConfig.widthMm = heightMm; this.labelConfig.heightMm = widthMm; }
    if (mode === 'landscape' && heightMm > widthMm)  { this.labelConfig.widthMm = heightMm; this.labelConfig.heightMm = widthMm; }
    this.labelConfig.orientation = mode;
    this._applyLabelConfig();
  }

  setBackground(color) { this.labelConfig.bgColor = color; this.render(); }

  // ── Zoom ──────────────────────────────────────────────────
  _updateZoom() {
    const area = document.getElementById('canvas-area-inner');
    if (!area) return;
    const pad    = 40;
    const availW = Math.max(area.clientWidth  - pad, 50);
    const availH = Math.max(area.clientHeight - pad, 50);
    this.zoom = Math.min(availW / this.labelWidthPx, availH / this.labelHeightPx, 2);
    this._applyZoomCSS();
  }

  _applyZoomCSS() {
    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;
    wrapper.style.width           = this.labelWidthPx  + 'px';
    wrapper.style.height          = this.labelHeightPx + 'px';
    wrapper.style.transform       = `scale(${this.zoom})`;
    wrapper.style.transformOrigin = 'center center';
    this.emit('zoomChanged', this.zoom);
  }

  setZoom(z) {
    this.zoom = Math.max(0.05, Math.min(z, 8));
    this._applyZoomCSS();
  }

  recalcZoom() { this._updateZoom(); }

  // ── Element factories ─────────────────────────────────────
  _id() { return 'el_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6); }

  addText(o = {}) {
    const el = {
      id: this._id(), type: 'text', visible: true,
      x: o.x ?? 10, y: o.y ?? 10, width: o.width ?? 120, height: o.height ?? 35,
      text: o.text ?? 'Label Text', fontSize: o.fontSize ?? 18,
      fontFamily: o.fontFamily ?? 'Arial', fontWeight: o.fontWeight ?? 'normal',
      fontStyle: o.fontStyle ?? 'normal', textDecoration: o.textDecoration ?? 'none',
      color: o.color ?? '#000000', align: o.align ?? 'left', rotation: o.rotation ?? 0,
    };
    this.elements.push(el); this.select(el.id); this.saveHistory(); return el;
  }

  addBarcode(o = {}) {
    const el = {
      id: this._id(), type: 'barcode', visible: true,
      x: o.x ?? 20, y: o.y ?? 60, width: o.width ?? 160, height: o.height ?? 55,
      value: o.value ?? '123456789012', format: o.format ?? 'CODE128',
      showText: o.showText ?? true, rotation: o.rotation ?? 0,
      color: o.color ?? '#000000', bgColor: o.bgColor ?? '#ffffff',
    };
    this.elements.push(el); this.select(el.id); this.saveHistory(); return el;
  }

  addQRCode(o = {}) {
    const el = {
      id: this._id(), type: 'qrcode', visible: true,
      x: o.x ?? 20, y: o.y ?? 50, width: o.width ?? 90, height: o.height ?? 90,
      value: o.value ?? 'https://example.com', qrType: o.qrType ?? 0,
      rotation: o.rotation ?? 0, color: o.color ?? '#000000', bgColor: o.bgColor ?? '#ffffff',
    };
    this.elements.push(el); this.select(el.id); this.saveHistory(); return el;
  }

  addShape(o = {}) {
    const el = {
      id: this._id(), type: 'shape', visible: true,
      x: o.x ?? 10, y: o.y ?? 10, width: o.width ?? 100, height: o.height ?? 40,
      shape: o.shape ?? 'rect', strokeColor: o.strokeColor ?? '#000000',
      fillColor: o.fillColor ?? 'transparent', lineWidth: o.lineWidth ?? 2,
      rotation: o.rotation ?? 0, radius: o.radius ?? 8,
    };
    this.elements.push(el); this.select(el.id); this.saveHistory(); return el;
  }

  addImage(o = {}) {
    const el = {
      id: this._id(), type: 'image', visible: true,
      x: o.x ?? 10, y: o.y ?? 10, width: o.width ?? 90, height: o.height ?? 90,
      src: o.src ?? '', colorMode: o.colorMode ?? 'original',
      rotation: o.rotation ?? 0, _img: null,
    };
    if (el.src) {
      const img = new Image();
      img.crossOrigin = 'Anonymous'; // Enable CORS for canvas export
      img.onload = () => { el._img = img; this.render(); };
      img.onerror = () => { console.warn('Failed to load image:', el.src); };
      img.src = el.src;
    }
    this.elements.push(el); this.select(el.id); this.saveHistory(); return el;
  }

  // ── Selection ─────────────────────────────────────────────
  select(id)    { this.selected = id ? this.elements.find(e => e.id === id) || null : null; this.render(); this.emit('select', this.selected); }
  deselect()    { this.select(null); }
  getSelected() { return this.selected; }

  updateSelected(props) {
    if (!this.selected) return;
    if (props.value !== undefined || props.qrType !== undefined) delete this._qrCache[this.selected.id];
    if (props.value !== undefined || props.format !== undefined) delete this._bcCache[this.selected.id];
    Object.assign(this.selected, props);
    if (this.selected.type === 'image' && props.src) {
      const img = new Image(); img.onload = () => { this.selected._img = img; this.render(); }; img.src = props.src;
    }
    this.render(); this.emit('update', this.selected);
  }

  // Toggle visibility of selected element
  toggleSelectedVisibility() {
    if (!this.selected) return;
    this.selected.visible = !this.selected.visible;
    this.render(); this.saveHistory(); this.emit('update', this.selected);
  }

  deleteSelected() {
    if (!this.selected) return;
    delete this._qrCache[this.selected.id];
    delete this._bcCache[this.selected.id];
    this.elements = this.elements.filter(e => e.id !== this.selected.id);
    this.selected = null; this.render(); this.saveHistory(); this.emit('select', null);
  }

  duplicateSelected() {
    if (!this.selected) return;
    const clone = JSON.parse(JSON.stringify(this.selected));
    clone.id = this._id(); clone.x += 10; clone.y += 10; clone._img = null;
    if (clone.type === 'image' && clone.src) { const img = new Image(); img.onload = () => { clone._img = img; this.render(); }; img.src = clone.src; }
    this.elements.push(clone); this.select(clone.id); this.saveHistory();
  }

  bringForward() {
    if (!this.selected) return;
    const i = this.elements.indexOf(this.selected);
    if (i < this.elements.length - 1) { [this.elements[i], this.elements[i+1]] = [this.elements[i+1], this.elements[i]]; this.render(); this.saveHistory(); }
  }

  sendBackward() {
    if (!this.selected) return;
    const i = this.elements.indexOf(this.selected);
    if (i > 0) { [this.elements[i], this.elements[i-1]] = [this.elements[i-1], this.elements[i]]; this.render(); this.saveHistory(); }
  }

  // ── History ───────────────────────────────────────────────
  saveHistory() {
    const snap = JSON.stringify(this.elements.map(e => { const c={...e}; delete c._img; return c; }));
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(snap);
    if (this.history.length > 60) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.emit('history', { canUndo: this.historyIndex > 0, canRedo: false });
  }

  undo() {
    if (this.historyIndex <= 0) return;
    this.historyIndex--; this._restoreHistory();
    this.emit('history', { canUndo: this.historyIndex > 0, canRedo: this.historyIndex < this.history.length - 1 });
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex++; this._restoreHistory();
    this.emit('history', { canUndo: this.historyIndex > 0, canRedo: this.historyIndex < this.history.length - 1 });
  }

  _restoreHistory() {
    this._qrCache = {}; this._bcCache = {};
    const data = JSON.parse(this.history[this.historyIndex]);
    this.elements = data;
    data.forEach(el => {
      if (el.visible === undefined) el.visible = true;
      if (el.type === 'image' && el.src) { const img = new Image(); img.onload = () => { el._img = img; this.render(); }; img.src = el.src; }
    });
    this.selected = null; this.render(); this.emit('select', null);
  }

  // ── Rendering ─────────────────────────────────────────────
  render() {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(RENDER_SCALE, RENDER_SCALE);

    ctx.clearRect(0, 0, this.labelWidthPx, this.labelHeightPx);
    ctx.fillStyle = this.labelConfig.bgColor;
    ctx.fillRect(0, 0, this.labelWidthPx, this.labelHeightPx);

    if (this.labelConfig.showBorder) {
      ctx.strokeStyle = '#b0b0b0'; ctx.lineWidth = 0.5; ctx.setLineDash([4, 2]);
      ctx.strokeRect(0.25, 0.25, this.labelWidthPx - 0.5, this.labelHeightPx - 0.5);
      ctx.setLineDash([]);
    }

    this.elements.forEach(el => {
      if (el.visible === false) {
        // Draw ghost overlay for hidden elements in editor view
        ctx.save();
        ctx.globalAlpha = 0.25;
        this._drawElement(ctx, el);
        ctx.globalAlpha = 1;
        // Draw striped hidden indicator
        ctx.fillStyle = 'rgba(255,80,80,0.12)';
        ctx.fillRect(el.x, el.y, el.width, el.height);
        ctx.restore();
      } else {
        this._drawElement(ctx, el);
      }
    });
    if (this.selected) this._drawHandles(ctx, this.selected);

    ctx.restore();
  }

  // Render to canvas for PDF export (hidden elements not drawn)
  renderForExport() {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(RENDER_SCALE, RENDER_SCALE);
    ctx.clearRect(0, 0, this.labelWidthPx, this.labelHeightPx);
    ctx.fillStyle = this.labelConfig.bgColor;
    ctx.fillRect(0, 0, this.labelWidthPx, this.labelHeightPx);
    this.elements.forEach(el => { if (el.visible !== false) this._drawElement(ctx, el); });
    ctx.restore();
  }

  _drawElement(ctx, el) {
    ctx.save();
    const cx = el.x + el.width / 2, cy = el.y + el.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate((el.rotation || 0) * Math.PI / 180);
    ctx.translate(-cx, -cy);
    switch (el.type) {
      case 'text':    this._drawText(ctx, el);    break;
      case 'barcode': this._drawBarcode(ctx, el); break;
      case 'qrcode':  this._drawQR(ctx, el);      break;
      case 'shape':   this._drawShape(ctx, el);   break;
      case 'image':   this._drawImage(ctx, el);   break;
    }
    ctx.restore();
  }

  _drawText(ctx, el) {
    const style = [
      el.fontStyle  !== 'normal' ? el.fontStyle  : '',
      el.fontWeight !== 'normal' ? el.fontWeight : ''
    ].filter(Boolean).join(' ');
    ctx.font = `${style} ${el.fontSize}px "${el.fontFamily}"`.trim();
    ctx.fillStyle = el.color;
    ctx.textAlign = el.align;
    ctx.textBaseline = 'top';
    const x = el.align === 'center' ? el.x + el.width/2 : el.align === 'right' ? el.x + el.width : el.x;
    const lineH = el.fontSize * 1.35;
    const lines = this._wrapText(ctx, el.text, el.width);

    lines.forEach((line, i) => {
      const ty = el.y + i * lineH;
      ctx.fillText(line, x, ty);
      const lw = ctx.measureText(line).width;
      const lx = el.align === 'center' ? el.x + el.width/2 - lw/2
               : el.align === 'right'  ? el.x + el.width   - lw : el.x;
      ctx.strokeStyle = el.color;
      ctx.lineWidth   = Math.max(0.8, el.fontSize / 20);
      if ((el.textDecoration||'').includes('underline')) {
        ctx.beginPath(); ctx.moveTo(lx, ty + el.fontSize + 2); ctx.lineTo(lx + lw, ty + el.fontSize + 2); ctx.stroke();
      }
      if ((el.textDecoration||'').includes('line-through')) {
        ctx.beginPath(); ctx.moveTo(lx, ty + el.fontSize * 0.55); ctx.lineTo(lx + lw, ty + el.fontSize * 0.55); ctx.stroke();
      }
    });
  }

  _wrapText(ctx, text, maxWidth) {
    const words = text.split(' '); const lines = []; let cur = '';
    words.forEach(w => {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > maxWidth && cur) { lines.push(cur); cur = w; }
      else cur = t;
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  // ── Real scannable barcode via JsBarcode ──────────────────
  _drawBarcode(ctx, el) {
    ctx.fillStyle = el.bgColor || '#ffffff';
    ctx.fillRect(el.x, el.y, el.width, el.height);

    const showText = el.showText !== false;
    const cacheKey = [
      el.id, el.value, el.format, showText,
      el.width, el.height,
      el.color || '#000000', el.bgColor || '#ffffff'
    ].join('_');

    // Device-pixel target for this element (ctx is scaled by RENDER_SCALE)
    const targetW = Math.max(1, Math.round(el.width * RENDER_SCALE));
    const targetH = Math.max(1, Math.round(el.height * RENDER_SCALE));

    if (typeof JsBarcode !== 'undefined') {
      try {
        let barcodeCanvas = this._bcCache[cacheKey];
        if (!barcodeCanvas) {
          const tmp = document.createElement('canvas');
          const target = document.createElement('canvas');
          target.width = targetW;
          target.height = targetH;
          const tctx = target.getContext('2d');
          tctx.imageSmoothingEnabled = false;

          const formatMap = {
            'CODE128': 'CODE128',
            'CODE39':  'CODE39',
            'EAN13':   'EAN13',
            'EAN8':    'EAN8',
            'ITF25':   'ITF',
            'UPC_A':   'UPC'
          };
          const fmt = formatMap[el.format] || 'CODE128';

          // Typography tuned to the element size (logical px -> scaled by RENDER_SCALE)
          const fontSizeLogical = Math.max(7, Math.round(el.height * 0.22));
          const textMarginLogical = Math.max(1, Math.round(el.height * 0.06));
          const marginLogical = Math.max(1, Math.round(el.height * 0.04));
          const barAreaLogical = Math.max(
            6,
            Math.round(el.height - (showText ? (fontSizeLogical + textMarginLogical) : 0))
          );

          const renderScale = RENDER_SCALE; // generate enough pixels for crisp bars
          const fontSize = Math.max(6, Math.round(fontSizeLogical * renderScale));
          const textMargin = Math.max(1, Math.round(textMarginLogical * renderScale));
          const margin = Math.max(1, Math.round(marginLogical * renderScale)); // left/right quiet zone (px)
          const height = Math.max(8, Math.round(barAreaLogical * renderScale));

          // Try a couple widths to ensure we don't upscales/blur too much.
          let moduleWidth = Math.max(1, Math.round(0.8 * renderScale)); // start conservative; we'll tune to element width
          for (let attempt = 0; attempt < 3; attempt++) {
            // JsBarcode will size tmp canvas based on content + options.
            JsBarcode(tmp, el.value || '0', {
              format: fmt,
              displayValue: showText,
              fontSize,
              textMargin,
              margin: 0,
              marginLeft: margin,
              marginRight: margin,
              marginTop: 0,
              marginBottom: 0,
              background: el.bgColor || '#ffffff',
              lineColor: el.color || '#000000',
              width: moduleWidth,
              height
            });

            // If we have at least ~target width/height, stop early.
            if (tmp.width >= targetW * 0.98 && tmp.height >= targetH * 0.98) break;

            // Increase module width proportionally so bar spacing stays visible.
            const ratio = targetW / Math.max(1, tmp.width);
            moduleWidth = Math.max(1, Math.round(moduleWidth * ratio * 1.02));
            moduleWidth = Math.min(moduleWidth, 40 * renderScale);
          }

          // Resample tmp -> exact target size without smoothing (keeps bar edges crisp)
          tctx.clearRect(0, 0, targetW, targetH);
          tctx.fillStyle = el.bgColor || '#ffffff';
          tctx.fillRect(0, 0, targetW, targetH);
          tctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, 0, 0, targetW, targetH);

          this._bcCache[cacheKey] = target;
          barcodeCanvas = target;
        }

        // Draw with no smoothing; dest size matches source pixel dimensions (so scaling ~= 1)
        const prev = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          barcodeCanvas,
          0, 0, barcodeCanvas.width, barcodeCanvas.height,
          el.x, el.y, el.width, el.height
        );
        ctx.imageSmoothingEnabled = prev;
        return;
      } catch (e) {
        // If barcode generation fails (e.g. invalid value for format), show error
        delete this._bcCache[cacheKey];
        ctx.fillStyle = '#fee2e2';
        ctx.fillRect(el.x, el.y, el.width, el.height);
        ctx.fillStyle = '#dc2626';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Invalid barcode value', el.x + el.width / 2, el.y + el.height / 2);
        return;
      }
    }

    // Fallback: visual-only barcode
    this._drawBarcodeFallback(ctx, el);
  }

  _drawBarcodeFallback(ctx, el) {
    const data  = el.value || '0';
    const textH = el.showText ? 14 : 0;
    const barH  = el.height - textH;
    const barCount = Math.min(data.length * 8 + 20, 120);
    const barW  = el.width / barCount;
    ctx.fillStyle = el.color || '#000000';
    let seed = data.split('').reduce((a,c) => a + c.charCodeAt(0), 0);
    const pr = n => { seed = (seed*1103515245+12345)&0x7fffffff; return (seed+n)%3!==0; };
    for (let i=0; i<barCount; i++) if (pr(i)) ctx.fillRect(el.x+i*barW, el.y, barW, barH);
    if (el.showText) {
      ctx.font = '11px monospace'; ctx.fillStyle='#000';
      ctx.textAlign='center'; ctx.textBaseline='bottom';
      ctx.fillText(el.value, el.x+el.width/2, el.y+el.height);
    }
  }

  // ── QR Code ───────────────────────────────────────────────
  _drawQR(ctx, el) {
    const ecMap = {0:'M',1:'L',2:'H',3:'Q'};
    const ec    = ecMap[el.qrType ?? 0] || 'M';
    const key   = `${el.id}_${el.value}_${ec}`;

    if (typeof qrcode !== 'undefined') {
      try {
        let qr = this._qrCache[key];
        if (!qr) {
          qr = qrcode(0, ec);
          qr.addData(el.value || 'https://example.com');
          qr.make();
          this._qrCache[key] = qr;
        }
        const n = qr.getModuleCount();
        const cw = el.width/n, ch = el.height/n;
        ctx.fillStyle = el.bgColor || '#ffffff'; ctx.fillRect(el.x, el.y, el.width, el.height);
        ctx.fillStyle = el.color || '#000000';
        for (let r=0; r<n; r++) for (let c=0; c<n; c++) if (qr.isDark(r,c)) ctx.fillRect(el.x+c*cw, el.y+r*ch, cw+0.5, ch+0.5);
        return;
      } catch(e) { /* fallback */ }
    }
    this._drawQRFallback(ctx, el);
  }

  _drawQRFallback(ctx, el) {
    ctx.fillStyle = el.bgColor||'#ffffff'; ctx.fillRect(el.x,el.y,el.width,el.height);
    const n=25,cw=el.width/n,ch=el.height/n;
    ctx.fillStyle=el.color||'#000000';
    let hash=(el.value||'').split('').reduce((a,c)=>((a<<5)-a)+c.charCodeAt(0),0);
    const fp=(r,c)=>{
      for(const[fr,fc]of[[0,0],[0,n-7],[n-7,0]]){const dr=r-fr,dc=c-fc;if(dr>=0&&dr<7&&dc>=0&&dc<7){if(dr===0||dr===6||dc===0||dc===6)return true;return dr>=2&&dr<=4&&dc>=2&&dc<=4;}}return null;
    };
    for(let r=0;r<n;r++)for(let c=0;c<n;c++){const f=fp(r,c);const dark=f!==null?f:((hash^(r*37+c*19))&1)===1;if(dark)ctx.fillRect(el.x+c*cw,el.y+r*ch,cw+0.5,ch+0.5);}
  }

  _drawShape(ctx, el) {
    ctx.strokeStyle = el.strokeColor;
    ctx.fillStyle   = el.fillColor==='transparent' ? 'rgba(0,0,0,0)' : el.fillColor;
    ctx.lineWidth   = el.lineWidth;
    ctx.beginPath();
    switch(el.shape) {
      case 'rect':      ctx.rect(el.x,el.y,el.width,el.height); break;
      case 'roundrect': this._roundRect(ctx,el.x,el.y,el.width,el.height,el.radius||8); break;
      case 'ellipse':   ctx.ellipse(el.x+el.width/2,el.y+el.height/2,el.width/2,el.height/2,0,0,Math.PI*2); break;
      case 'line':      ctx.moveTo(el.x,el.y+el.height/2); ctx.lineTo(el.x+el.width,el.y+el.height/2); break;
    }
    ctx.fill(); ctx.stroke();
  }

  _roundRect(ctx,x,y,w,h,r){
    ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
  }

  _drawImage(ctx, el) {
    if (el._img) {
      ctx.save();
      if (el.colorMode==='gray') ctx.filter='grayscale(100%)';
      else if (el.colorMode==='bw') ctx.filter='grayscale(100%) contrast(200%)';
      ctx.drawImage(el._img, el.x, el.y, el.width, el.height);
      ctx.restore();
    } else {
      ctx.fillStyle='#e8e8e8'; ctx.fillRect(el.x,el.y,el.width,el.height);
      ctx.fillStyle='#999'; ctx.font='12px Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('IMG', el.x+el.width/2, el.y+el.height/2);
    }
  }

  _drawHandles(ctx, el) {
    // Different color if hidden
    const color = el.visible===false ? '#f97316' : '#2124f4';
    
    // Get handles (already rotated if element is rotated)
    const handles = this._getHandles(el);
    
    ctx.save();
    
    ctx.strokeStyle=color; ctx.lineWidth=1; ctx.setLineDash([3,2]);
    
    // Draw bounding box using the first and last handle positions
    // For rotated elements, draw a polygon connecting all corner handles
    if (el.rotation) {
      // Draw rotated rectangle by connecting corner handles
      ctx.beginPath();
      ctx.moveTo(handles[0].x, handles[0].y); // nw
      ctx.lineTo(handles[2].x, handles[2].y); // ne
      ctx.lineTo(handles[4].x, handles[4].y); // se
      ctx.lineTo(handles[6].x, handles[6].y); // sw
      ctx.closePath();
      ctx.stroke();
    } else {
      // Non-rotated: simple rectangle
      ctx.strokeRect(el.x-0.5,el.y-0.5,el.width+1,el.height+1);
    }
    
    ctx.setLineDash([]);
    
    // Draw handles
    handles.forEach(h=>{
      ctx.fillStyle='#fff'; ctx.strokeStyle=color; ctx.lineWidth=1;
      ctx.fillRect(h.x-3.5,h.y-3.5,7,7); ctx.strokeRect(h.x-3.5,h.y-3.5,7,7);
    });
    
    ctx.restore();
    
    // Hidden label (don't rotate this)
    if (el.visible===false) {
      ctx.fillStyle='rgba(249,115,22,0.9)';
      const label='HIDDEN';
      ctx.font='bold 8px Arial';
      const lw=ctx.measureText(label).width+6;
      ctx.fillRect(el.x, el.y, lw, 12);
      ctx.fillStyle='#fff'; ctx.textAlign='left'; ctx.textBaseline='middle';
      ctx.fillText(label, el.x+3, el.y+6);
    }
  }

  _getHandles(el) {
    // If element is rotated, calculate rotated handle positions
    if (el.rotation) {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const angle = el.rotation * Math.PI / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      
      const rotatePoint = (x, y) => {
        const dx = x - cx;
        const dy = y - cy;
        return {
          x: cx + dx * cos - dy * sin,
          y: cy + dx * sin + dy * cos
        };
      };
      
      return [
        {x: rotatePoint(el.x, el.y).x, y: rotatePoint(el.x, el.y).y, cursor:'nw-resize',dir:'nw'},
        {x: rotatePoint(el.x+el.width/2, el.y).x, y: rotatePoint(el.x+el.width/2, el.y).y, cursor:'n-resize', dir:'n'},
        {x: rotatePoint(el.x+el.width, el.y).x, y: rotatePoint(el.x+el.width, el.y).y, cursor:'ne-resize',dir:'ne'},
        {x: rotatePoint(el.x+el.width, el.y+el.height/2).x, y: rotatePoint(el.x+el.width, el.y+el.height/2).y, cursor:'e-resize',dir:'e'},
        {x: rotatePoint(el.x+el.width, el.y+el.height).x, y: rotatePoint(el.x+el.width, el.y+el.height).y, cursor:'se-resize',dir:'se'},
        {x: rotatePoint(el.x+el.width/2, el.y+el.height).x, y: rotatePoint(el.x+el.width/2, el.y+el.height).y, cursor:'s-resize', dir:'s'},
        {x: rotatePoint(el.x, el.y+el.height).x, y: rotatePoint(el.x, el.y+el.height).y, cursor:'sw-resize',dir:'sw'},
        {x: rotatePoint(el.x, el.y+el.height/2).x, y: rotatePoint(el.x, el.y+el.height/2).y, cursor:'w-resize',dir:'w'},
      ];
    }
    
    return [
      {x:el.x,           y:el.y,           cursor:'nw-resize',dir:'nw'},
      {x:el.x+el.width/2,y:el.y,           cursor:'n-resize', dir:'n'},
      {x:el.x+el.width,  y:el.y,           cursor:'ne-resize',dir:'ne'},
      {x:el.x+el.width,  y:el.y+el.height/2,cursor:'e-resize',dir:'e'},
      {x:el.x+el.width,  y:el.y+el.height, cursor:'se-resize',dir:'se'},
      {x:el.x+el.width/2,y:el.y+el.height, cursor:'s-resize', dir:'s'},
      {x:el.x,           y:el.y+el.height, cursor:'sw-resize',dir:'sw'},
      {x:el.x,           y:el.y+el.height/2,cursor:'w-resize',dir:'w'},
    ];
  }

  // Check if point is inside a rotated rectangle
  _pointInRotatedRect(pos, el) {
    if (!el.rotation) {
      return pos.x >= el.x && pos.x <= el.x + el.width &&
             pos.y >= el.y && pos.y <= el.y + el.height;
    }
    
    // Transform point to element's local coordinate system
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const angle = -el.rotation * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    
    const dx = pos.x - cx;
    const dy = pos.y - cy;
    
    const localX = cx + dx * cos - dy * sin;
    const localY = cy + dx * sin + dy * cos;
    
    return localX >= el.x && localX <= el.x + el.width &&
           localY >= el.y && localY <= el.y + el.height;
  }

  // ── Events ────────────────────────────────────────────────
  _bindEvents() {
    this.canvas.addEventListener('mousedown', e => this._onPointerDown(this._getMousePos(e)));
    this.canvas.addEventListener('mousemove', e => this._onPointerMove(this._getMousePos(e)));
    this.canvas.addEventListener('mouseup',   () => this._onPointerUp());
    this.canvas.addEventListener('dblclick',  e => this._onDblClick(this._getMousePos(e)));

    const scrollTarget = document.getElementById('canvas-area-inner') || this.canvas.parentElement;
    scrollTarget?.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.setZoom(this.zoom + (e.deltaY > 0 ? -0.1 : 0.1));
    }, {passive: false});

    this.canvas.addEventListener('touchstart', e => { e.preventDefault(); this._onPointerDown(this._getTouchPos(e)); }, {passive:false});
    this.canvas.addEventListener('touchmove',  e => { e.preventDefault(); this._onPointerMove(this._getTouchPos(e)); }, {passive:false});
    this.canvas.addEventListener('touchend',   e => { e.preventDefault(); this._onPointerUp(); });

    document.addEventListener('keydown', e => this._onKeyDown(e));

    if (typeof ResizeObserver !== 'undefined') {
      const area = document.getElementById('canvas-area-inner');
      if (area) new ResizeObserver(() => this._updateZoom()).observe(area);
    }
    window.addEventListener('resize', () => this._updateZoom());
  }

  _getMousePos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.zoom, y: (e.clientY - r.top) / this.zoom };
  }
  _getTouchPos(e) {
    const r = this.canvas.getBoundingClientRect();
    const t = e.touches[0] || e.changedTouches[0];
    return { x: (t.clientX - r.left) / this.zoom, y: (t.clientY - r.top) / this.zoom };
  }

  _onPointerDown(pos) {
    if (this.selected) {
      const h = this._getHandles(this.selected).find(h => Math.abs(h.x-pos.x)<8 && Math.abs(h.y-pos.y)<8);
      if (h) { this.resizing=true; this.resizeHandle=h.dir; this._resizeStart={...pos,el:{...this.selected}}; return; }
    }
    // Use rotated hit detection
    const hit = [...this.elements].reverse().find(el => this._pointInRotatedRect(pos, el));
    if (hit) { this.select(hit.id); this.dragging=true; this.dragOffset={x:pos.x-hit.x,y:pos.y-hit.y}; }
    else this.deselect();
  }

  _onPointerMove(pos) {
    if (this.dragging&&this.selected) {
      // Remove edge constraints - allow free movement
      this.selected.x=pos.x-this.dragOffset.x;
      this.selected.y=pos.y-this.dragOffset.y;
      this.render(); this.emit('update',this.selected);
    } else if (this.resizing&&this.selected) {
      this._handleResize(pos);
    } else if (this.selected) {
      const h=this._getHandles(this.selected).find(h=>Math.abs(h.x-pos.x)<8&&Math.abs(h.y-pos.y)<8);
      this.canvas.style.cursor=h?h.cursor:'default';
    }
  }

  _handleResize(pos) {
    const el=this.selected, s=this._resizeStart, dir=this.resizeHandle;
    
    // For rotated elements, transform the movement into local coordinates
    let dx = pos.x - s.x;
    let dy = pos.y - s.y;
    
    if (el.rotation) {
      const angle = -el.rotation * Math.PI / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const localDx = dx * cos - dy * sin;
      const localDy = dx * sin + dy * cos;
      dx = localDx;
      dy = localDy;
    }
    
    // Check if this is a diagonal resize (maintain aspect ratio)
    const isDiagonal = (dir === 'nw' || dir === 'ne' || dir === 'se' || dir === 'sw');
    const isHorizontal = (dir === 'e' || dir === 'w');
    const isVertical = (dir === 'n' || dir === 's');
    
    if (isDiagonal) {
      // Proportional resize - maintain aspect ratio
      const aspectRatio = s.el.width / s.el.height;
      
      // Calculate new dimensions based on movement
      let newWidth, newHeight;
      if (dir.includes('e')) {
        newWidth = Math.max(20, s.el.width + dx);
        newHeight = newWidth / aspectRatio;
      } else if (dir.includes('w')) {
        newWidth = Math.max(20, s.el.width - dx);
        newHeight = newWidth / aspectRatio;
      }
      
      if (dir.includes('s')) {
        newHeight = Math.max(10, s.el.height + dy);
        newWidth = newHeight * aspectRatio;
      } else if (dir.includes('n')) {
        newHeight = Math.max(10, s.el.height - dy);
        newWidth = newHeight * aspectRatio;
      }
      
      // Apply dimensions
      el.width = newWidth;
      el.height = newHeight;
      
      // Adjust position for nw, ne, sw corners
      if (dir.includes('w')) {
        el.x = s.el.x + (s.el.width - el.width);
      }
      if (dir.includes('n')) {
        el.y = s.el.y + (s.el.height - el.height);
      }
    } else if (isHorizontal) {
      // Horizontal stretch only
      if (dir === 'e') {
        el.width = Math.max(20, s.el.width + dx);
      } else if (dir === 'w') {
        el.x = s.el.x + dx;
        el.width = Math.max(20, s.el.width - dx);
      }
    } else if (isVertical) {
      // Vertical stretch only
      if (dir === 's') {
        el.height = Math.max(10, s.el.height + dy);
      } else if (dir === 'n') {
        el.y = s.el.y + dy;
        el.height = Math.max(10, s.el.height - dy);
      }
    }
    
    this.render(); this.emit('update', el);
  }

  _onPointerUp() {
    if(this.dragging||this.resizing)this.saveHistory();
    this.dragging=false;this.resizing=false;this.resizeHandle=null;this.canvas.style.cursor='default';
  }

  _onDblClick(pos) {
    const hit=[...this.elements].reverse().find(el=>pos.x>=el.x&&pos.x<=el.x+el.width&&pos.y>=el.y&&pos.y<=el.y+el.height);
    if(hit&&hit.type==='text')this.emit('editText',hit);
  }

  _onKeyDown(e) {
    if(!this.selected)return;
    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')return;
    const step=e.shiftKey?10:1;
    switch(e.key){
      case 'Delete':case 'Backspace':this.deleteSelected();break;
      case 'ArrowLeft':this.selected.x-=step;this.render();break;
      case 'ArrowRight':this.selected.x+=step;this.render();break;
      case 'ArrowUp':this.selected.y-=step;this.render();break;
      case 'ArrowDown':this.selected.y+=step;this.render();break;
      default:return;
    }
    e.preventDefault();this.saveHistory();
  }

  // ── Template ──────────────────────────────────────────────
  exportTemplate() {
    const elements = this.elements.map(e=>{const c={...e};delete c._img;return c;});
    return JSON.stringify({version:'4.0', labelConfig:this.labelConfig, elements}, null, 2);
  }

  // Convert legacy template format (fields/wmm/hmm) to new format
  convertLegacyTemplate(legacy) {
    try {
      // Set label dimensions from legacy format
      if (legacy.wmm && legacy.hmm) {
        this.setLabelMm(legacy.wmm, legacy.hmm);
      }

      // Convert fields to elements
      const elements = (legacy.fields || []).map(field => {
        const base = {
          id: field.id || this._id(),
          visible: field.visible !== undefined ? field.visible : true,
          x: Math.round(field.x || 0),
          y: Math.round(field.y || 0),
          width: Math.round(field.w || field.width || 100),
          height: Math.round(field.h || field.height || 40),
          rotation: field.rotation || 0,
        };

        // Convert based on type
        switch (field.type) {
          case 'text':
            return {
              ...base,
              type: 'text',
              text: field.text || field.prefix || '',
              fontSize: field.fontSize || 14,
              fontFamily: field.fontFamily || 'Arial',
              fontWeight: field.bold ? 'bold' : 'normal',
              fontStyle: field.italic ? 'italic' : 'normal',
              textDecoration: [
                field.underline ? 'underline' : '',
                field.strikethrough ? 'line-through' : ''
              ].filter(Boolean).join(' ') || 'none',
              color: field.color || '#000000',
              align: field.align || 'left',
            };
          case 'barcode':
            return {
              ...base,
              type: 'barcode',
              value: field.value || field.prefix || '123456789012',
              format: field.format || 'CODE128',
              showText: field.bcText !== undefined ? field.bcText : true,
              color: field.color || '#000000',
              bgColor: field.bgColor || '#ffffff',
            };
          case 'qr':
            return {
              ...base,
              type: 'qrcode',
              value: field.value || field.prefix || 'https://example.com',
              qrType: field.qrType || 0,
              color: field.color || '#000000',
              bgColor: field.bgColor || '#ffffff',
            };
          case 'shape':
            return {
              ...base,
              type: 'shape',
              shape: field.shape || 'rect',
              strokeColor: field.strokeColor || '#000000',
              fillColor: field.fillColor || 'transparent',
              lineWidth: field.lineWidth || 2,
              radius: field.radius || 8,
            };
          case 'image':
            return {
              ...base,
              type: 'image',
              src: field.src || '',
              colorMode: field.colorMode || 'original',
            };
          default:
            // Default to text if type unknown
            return {
              ...base,
              type: 'text',
              text: field.text || field.prefix || 'Unknown element',
              fontSize: field.fontSize || 14,
              fontFamily: field.fontFamily || 'Arial',
              color: field.color || '#000000',
            };
        }
      });

      return {
        version: '4.0',
        labelConfig: {
          widthMm: legacy.wmm || this.labelConfig.widthMm,
          heightMm: legacy.hmm || this.labelConfig.heightMm,
          orientation: this.labelConfig.orientation,
          bgColor: this.labelConfig.bgColor,
          showBorder: this.labelConfig.showBorder
        },
        elements
      };
    } catch (e) {
      console.error('Legacy template conversion failed:', e);
      return null;
    }
  }

  importTemplate(json) {
    try {
      const data = typeof json==='string' ? JSON.parse(json) : json;
      if (data.labelConfig) {
        this.labelConfig = {...this.labelConfig, ...data.labelConfig};
        this._applyLabelConfig();
      }
      this._qrCache={}; this._bcCache={};
      this.elements = (data.elements||[]).map(el => {
        if (el.visible === undefined) el.visible = true;
        return el;
      });
      // Reload images
      this.elements.forEach(el => {
        if (el.type==='image' && el.src) {
          const img=new Image();
          img.onload=()=>{el._img=img;this.render();};
          img.src=el.src;
        }
      });
      this.selected=null;
      this.render();
      this.saveHistory();
      return true;
    } catch(e) { console.error('Template import error:', e); return false; }
  }

  clear() { this._qrCache={}; this._bcCache={}; this.elements=[]; this.selected=null; this.render(); this.saveHistory(); this.emit('select',null); }

  exportImage(format='png', forExport=false) {
    const sel=this.selected; this.deselect();
    if (forExport) this.renderForExport();
    const data=this.canvas.toDataURL(`image/${format}`);
    if (forExport) this.render();
    if (sel) this.select(sel.id);
    return data;
  }
}

window.CanvasEngine  = CanvasEngine;
window.MM_TO_PX      = MM_TO_PX;
window.RENDER_SCALE  = RENDER_SCALE;
