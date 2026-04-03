// ============================================================
// data-manager.js — Import/Export, CSV, Excel, Templates
// ============================================================

class DataManager {
  constructor() {
    this.importedData = [];    // rows from CSV/Excel
    this.currentRowIndex = 0;
    this.fieldBindings = {};   // elementId → columnName
    this.listeners = {};
  }

  on(event, cb) { (this.listeners[event] = this.listeners[event] || []).push(cb); }
  emit(event, data) { (this.listeners[event] || []).forEach(cb => cb(data)); }

  // ── CSV Parser ────────────────────────────────────────────
  parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 1) return { headers: [], rows: [] };
    const headers = this._parseCSVLine(lines[0]);
    
    // Detect "wide" format: repeated column groups
    const uniqueHeaders = [...new Set(headers)];
    const isWideFormat = uniqueHeaders.length < headers.length && headers.length > uniqueHeaders.length;
    
    // Store metadata about column groups
    this.columnGroups = isWideFormat ? Math.floor(headers.length / uniqueHeaders.length) : 1;
    this.uniqueHeaders = uniqueHeaders;
    this.allHeaders = headers;
    
    // Normal format - just parse rows
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const values = this._parseCSVLine(lines[i]);
      const row = {};
      headers.forEach((h, idx) => { row[h] = values[idx] !== undefined ? values[idx].trim() : ''; });
      rows.push(row);
    }
    
    return { headers, rows };
  }

  _parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { current += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        result.push(current.trim()); current = '';
      } else { current += ch; }
    }
    result.push(current.trim());
    return result;
  }

  // ── Excel Parser (using SheetJS if available, else fallback) ──
  async parseExcel(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          if (typeof XLSX !== 'undefined') {
            const workbook = XLSX.read(e.target.result, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            if (jsonData.length < 1) { resolve({ headers: [], rows: [] }); return; }
            
            const headers = jsonData[0].map(String);
            
            // Detect "wide" format: repeated column groups
            const uniqueHeaders = [...new Set(headers)];
            const isWideFormat = uniqueHeaders.length < headers.length && headers.length > uniqueHeaders.length;
            
            // Store metadata
            this.columnGroups = isWideFormat ? Math.floor(headers.length / uniqueHeaders.length) : 1;
            this.uniqueHeaders = uniqueHeaders;
            this.allHeaders = headers;
            
            // Parse rows normally (keep wide format)
            const rows = jsonData.slice(1).map(row => {
              const obj = {};
              headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? String(row[i]).trim() : ''; });
              return obj;
            }).filter(r => Object.values(r).some(v => v));
            
            resolve({ headers, rows });
          } else {
            reject(new Error('SheetJS not loaded'));
          }
        } catch (err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  // ── JSON Parser (data rows) ────────────────────────────────
  parseJSON(text) {
    let json;
    try { json = JSON.parse(text); }
    catch { throw new Error('Invalid JSON file'); }

    // Avoid confusing LabelStudio template JSON with data JSON.
    if (json && typeof json === 'object' && (json.elements || json.labelConfig)) {
      throw new Error('This JSON looks like a Template. Use the Templates tab for .json templates.');
    }

    const normalizeScalar = v => (v === undefined || v === null) ? '' : String(v);

    // Format 1: array of objects (rows)
    if (Array.isArray(json)) {
      if (json.length === 0) return { headers: [], rows: [] };
      if (!json.every(r => r && typeof r === 'object' && !Array.isArray(r))) {
        // Format 2: array of arrays -> treat first row as headers
        if (Array.isArray(json[0])) {
          const headers = json[0].map(String);
          const rows = json.slice(1).map(arr => {
            const row = {};
            headers.forEach((h, i) => { row[h] = normalizeScalar(arr[i]); });
            return row;
          });
          return { headers, rows: rows.filter(r => Object.values(r).some(v => v !== '') ) };
        }
        throw new Error('Unsupported JSON data format (expected array of objects)');
      }

      const headersSet = new Set();
      json.forEach(r => Object.keys(r).forEach(k => headersSet.add(k)));
      const headers = Array.from(headersSet);
      const rows = json.map(r => {
        const row = {};
        headers.forEach(h => { row[h] = normalizeScalar(r[h]); });
        return row;
      }).filter(r => Object.values(r).some(v => v !== ''));
      return { headers, rows };
    }

    // Format 3+: object with headers/rows
    if (json && typeof json === 'object') {
      const headersRaw = json.headers;
      const rowsRaw = json.rows ?? json.data?.rows ?? json.data ?? json.records;

      // If rows are missing, allow object where keys are columns and values are arrays.
      if (!rowsRaw && !headersRaw) {
        const keys = Object.keys(json);
        const maybeCols = keys.every(k => Array.isArray(json[k]));
        if (maybeCols) {
          const headers = keys.map(String);
          const len = Math.max(0, ...keys.map(k => json[k].length));
          const rows = [];
          for (let i = 0; i < len; i++) {
            const row = {};
            headers.forEach(h => { row[h] = normalizeScalar(json[h][i]); });
            if (Object.values(row).some(v => v !== '')) rows.push(row);
          }
          return { headers, rows };
        }
      }

      // Prefer explicit headers.
      if (Array.isArray(headersRaw) && Array.isArray(rowsRaw)) {
        const headers = headersRaw.map(String);
        if (rowsRaw.length === 0) return { headers, rows: [] };

        // rows: array-of-arrays
        if (Array.isArray(rowsRaw[0])) {
          const rows = rowsRaw.map(arr => {
            const row = {};
            headers.forEach((h, i) => { row[h] = normalizeScalar(arr[i]); });
            return row;
          }).filter(r => Object.values(r).some(v => v !== ''));
          return { headers, rows };
        }

        // rows: array-of-objects
        if (rowsRaw[0] && typeof rowsRaw[0] === 'object' && !Array.isArray(rowsRaw[0])) {
          const rows = rowsRaw.map(r => {
            const row = {};
            headers.forEach(h => { row[h] = normalizeScalar(r?.[h]); });
            return row;
          }).filter(r => Object.values(r).some(v => v !== ''));
          return { headers, rows };
        }

        throw new Error('Unsupported JSON rows format');
      }

      // If headers are not provided but rows are array-of-objects
      if (Array.isArray(rowsRaw)) {
        if (rowsRaw.length === 0) return { headers: [], rows: [] };
        if (rowsRaw[0] && typeof rowsRaw[0] === 'object' && !Array.isArray(rowsRaw[0])) {
          const headersSet = new Set();
          rowsRaw.forEach(r => Object.keys(r || {}).forEach(k => headersSet.add(k)));
          const headers = Array.from(headersSet);
          const rows = rowsRaw.map(r => {
            const row = {};
            headers.forEach(h => { row[h] = normalizeScalar(r?.[h]); });
            return row;
          }).filter(r => Object.values(r).some(v => v !== ''));
          return { headers, rows };
        }
      }
    }

    throw new Error('Unsupported JSON data format. Expected array of objects, or { "headers": [...], "rows": [...] }.');
  }

  // ── Load data file ────────────────────────────────────────
  async loadFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    let result;

    if (ext === 'csv') {
      const text = await file.text();
      result = this.parseCSV(text);
    } else if (ext === 'xlsx' || ext === 'xls') {
      result = await this.parseExcel(file);
    } else if (ext === 'json') {
      const text = await file.text();
      result = this.parseJSON(text);
    } else {
      throw new Error('Unsupported file type. Use CSV, XLS/XLSX, or JSON.');
    }

    this.importedData = result.rows;
    this.headers = result.headers;
    this.currentRowIndex = 0;
    this.emit('dataLoaded', { rows: this.importedData, headers: this.headers });
    return result;
  }

  // ── Field bindings ────────────────────────────────────────
  bindField(elementId, columnName) {
    this.fieldBindings[elementId] = columnName;
  }

  unbindField(elementId) {
    delete this.fieldBindings[elementId];
  }

  getBindings() { return { ...this.fieldBindings }; }

  // ── Apply row data to canvas elements ─────────────────────
  applyRowToCanvas(engine, rowIndex, setIndex = 0) {
    const row = this.importedData[rowIndex];
    if (!row) return;
    this.currentRowIndex = rowIndex;
    this.currentSetIndex = setIndex;

    engine.elements.forEach(el => {
      const colName = this.fieldBindings[el.id];
      if (colName && row) {
        // If we have column groups, get value from the correct group
        let value;
        if (this.columnGroups > 1 && this.uniqueHeaders) {
          // Find which column in the group this binding refers to
          const uniqueIdx = this.uniqueHeaders.indexOf(colName);
          if (uniqueIdx !== -1) {
            const actualColIdx = setIndex * this.uniqueHeaders.length + uniqueIdx;
            const actualColName = this.allHeaders[actualColIdx];
            value = row[actualColName];
          }
        } else {
          value = row[colName];
        }
        
        if (value !== undefined) {
          if (el.type === 'text') el.text = value;
          else if (el.type === 'barcode' || el.type === 'qrcode') el.value = value;
        }
      }
    });
    engine.render();
    this.emit('rowApplied', { rowIndex, setIndex, row });
  }

  // ── Template import ────────────────────────────────────────
  async loadTemplateFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'json') {
      const text = await file.text();
      try {
        const data = JSON.parse(text);
        this.emit('templateLoaded', { type: 'json', data });
        return { type: 'json', data };
      } catch {
        throw new Error('Invalid JSON template file');
      }
    } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const result = { type: 'image', src: e.target.result };
          this.emit('templateLoaded', result);
          resolve(result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    } else {
      throw new Error('Unsupported template format. Use JSON or image files.');
    }
  }

  // ── PDF generation (using jsPDF + html2canvas fallback) ───
  async generatePDF(engine, allRows = false) {
    const totalSets = this.columnGroups || 1;
    const pages = allRows && this.importedData.length > 0 
      ? this.importedData.length * totalSets 
      : totalSets;

    const { width, height } = engine.labelConfig;
    const pdfPages = [];

    if (allRows && this.importedData.length > 0) {
      // Generate pages for all rows, iterating through sets
      for (let i = 0; i < this.importedData.length; i++) {
        for (let s = 0; s < totalSets; s++) {
          this.applyRowToCanvas(engine, i, s);
          await new Promise(r => setTimeout(r, 50));

          const sel = engine.selected;
          engine.deselect();
          const imgData = engine.canvas.toDataURL('image/png');
          if (sel) engine.select(sel.id);

          pdfPages.push(imgData);
        }
      }
    } else {
      // Single row (first row) with all sets
      const rowIdx = 0;
      for (let s = 0; s < totalSets; s++) {
        this.applyRowToCanvas(engine, rowIdx, s);
        await new Promise(r => setTimeout(r, 50));

        const sel = engine.selected;
        engine.deselect();
        const imgData = engine.canvas.toDataURL('image/png');
        if (sel) engine.select(sel.id);

        pdfPages.push(imgData);
      }
    }

    return pdfPages;
  }

  exportDataToCSV(rows, filename = 'exported_data.csv') {
    if (!rows || !rows.length) return;
    const headers = Object.keys(rows[0]);
    const lines = [headers.join(',')];
    rows.forEach(row => {
      lines.push(headers.map(h => `"${(row[h] || '').replace(/"/g, '""')}"`).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }
}

window.DataManager = DataManager;
