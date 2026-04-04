// ============================================================
// ui-controller.js — LabelStudio v4
// Fixes: visibility toggle, template import, mobile layout,
//        barcode format changes, PDF uses export render
// ============================================================

class UIController {
  constructor(engine, dataManager) {
    this.engine = engine;
    this.dm     = dataManager;
    this.loadedFonts = new Set(); // Track dynamically loaded Google Fonts
    this._init();
  }

  // ── Google Fonts dynamic loader ───────────────────────────
  // Fonts already loaded in styles.css
  _preloadedFonts = new Set(['Inter', 'JetBrains Mono']);
  
  _googleFonts = new Set([
    'Roboto','Open Sans','Lato','Montserrat','Poppins','Raleway','Nunito','Ubuntu',
    'Merriweather','Playfair Display','Oswald','Rubik','Work Sans','Fira Sans',
    'PT Sans','Source Sans Pro','Quicksand','Barlow','Karla','Libre Baskerville',
    'Inconsolata','Space Grotesk','DM Sans','Manrope','Bebas Neue','Anton','Lobster',
    'Pacifico','Righteous','Permanent Marker','Fredoka One','Press Start 2P','Orbitron',
    'Exo 2','Titillium Web','Asap','Mukta','Hind','Kanit','Josefin Sans','Cabin',
    'Archivo','Overpass','Prompt','Teko','Rajdhani','Dosis','Abel','Oxygen',
    'Crimson Text','Vollkorn','Bitter','Lora','EB Garamond','Libre Caslon Text',
    'Spectral','Cormorant Garamond','Old Standard TT','Philosopher'
  ]);

  async _loadGoogleFont(fontName) {
    // Skip if already loaded, preloaded, or if it's a system font
    if (this.loadedFonts.has(fontName)) return true;
    if (this._preloadedFonts.has(fontName)) return true;
    if (!this._googleFonts.has(fontName)) return true; // System font, no need to load

    try {
      const family = fontName.replace(/ /g, '+');
      const link = document.createElement('link');
      link.href = `https://fonts.googleapis.com/css2?family=${family}:wght@300;400;500;600;700&family=${family}:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700&display=swap`;
      link.rel = 'stylesheet';
      document.head.appendChild(link);

      // Wait for font to be ready
      if (document.fonts && document.fonts.load) {
        await document.fonts.load(`400 16px "${fontName}"`);
        await document.fonts.load(`700 16px "${fontName}"`);
        await document.fonts.load(`italic 16px "${fontName}"`);
      } else {
        // Fallback for browsers without FontFaces API
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      this.loadedFonts.add(fontName);
      console.log(`✅ Font loaded: ${fontName}`);
      return true;
    } catch (e) {
      console.warn(`⚠️ Failed to load font: ${fontName}`, e);
      return false;
    }
  }

  _init() {
    this._bindToolbar();
    this._bindFormatButtons();
    this._bindAlignButtons();
    this._bindVisibilityToggle();
    this._bindPropertyPanel();
    this._bindDataPanel();
    this._bindTemplatePanel();
    this._bindPDFPanel();
    this._bindLabelSettings();
    this._bindEngineEvents();
    this._bindMenuActions();
    this._initPrebuiltTemplates();
    this._bindTabs();
    this._bindMobileUI();
  }

  // ── Toolbar ───────────────────────────────────────────────
  _bindToolbar() {
    const map = {
      // File menu items in toolbar
      'btn-new-label-tb':  () => { if (confirm('Start new label?')) this.engine.clear(); },
      'btn-export-png-tb': () => { const d=this.engine.exportImage('png',true); const a=document.createElement('a'); a.href=d; a.download='label.png'; a.click(); this.showToast('✅ PNG exported!'); },
      // Edit
      'btn-undo':          () => this.engine.undo(),
      'btn-redo':          () => this.engine.redo(),
      'btn-delete':        () => this.engine.deleteSelected(),
      'btn-duplicate':     () => this.engine.duplicateSelected(),
      'btn-bring-forward': () => this.engine.bringForward(),
      'btn-send-backward': () => this.engine.sendBackward(),
      'btn-clear':         () => { if (confirm('Clear all elements?')) this.engine.clear(); },
      // Preview/Print
      'btn-preview-pdf':   () => this.openPDFPreview(),
      'btn-download-pdf':  () => this.downloadPDF(),
      'btn-export-template': () => this.exportTemplate(),
      // Mobile quick actions
      'btn-m-undo':    () => this.engine.undo(),
      'btn-m-redo':    () => this.engine.redo(),
      'btn-m-delete':  () => this.engine.deleteSelected(),
      'btn-m-preview': () => this.openPDFPreview(),
      'btn-m-pdf':     () => this.downloadPDF(),
    };
    Object.entries(map).forEach(([id, fn]) => document.getElementById(id)?.addEventListener('click', fn));

    document.getElementById('img-upload')?.addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = ev => this.engine.addImage({src: ev.target.result, width:90, height:90});
      r.readAsDataURL(f); e.target.value = '';
    });
  }

  // ── Format toggle buttons ─────────────────────────────────
  _bindFormatButtons() {
    document.getElementById('fmt-bold')?.addEventListener('click', () => {
      const el = this.engine.getSelected(); if (!el) return;
      this.engine.updateSelected({fontWeight: el.fontWeight==='bold' ? 'normal' : 'bold'});
      this._syncFormatButtons(this.engine.getSelected());
    });
    document.getElementById('fmt-italic')?.addEventListener('click', () => {
      const el = this.engine.getSelected(); if (!el) return;
      this.engine.updateSelected({fontStyle: el.fontStyle==='italic' ? 'normal' : 'italic'});
      this._syncFormatButtons(this.engine.getSelected());
    });
    document.getElementById('fmt-underline')?.addEventListener('click', () => {
      const el = this.engine.getSelected(); if (!el) return;
      let d = el.textDecoration||'none';
      if (d==='underline') d='none';
      else if (d==='line-through') d='underline line-through';
      else if (d==='underline line-through') d='line-through';
      else d='underline';
      this.engine.updateSelected({textDecoration: d});
      this._syncFormatButtons(this.engine.getSelected());
    });
    document.getElementById('fmt-strikethrough')?.addEventListener('click', () => {
      const el = this.engine.getSelected(); if (!el) return;
      let d = el.textDecoration||'none';
      if (d==='line-through') d='none';
      else if (d==='underline') d='underline line-through';
      else if (d==='underline line-through') d='underline';
      else d='line-through';
      this.engine.updateSelected({textDecoration: d});
      this._syncFormatButtons(this.engine.getSelected());
    });
  }

  _syncFormatButtons(el) {
    if (!el) return;
    document.getElementById('fmt-bold')?.classList.toggle('active', el.fontWeight==='bold');
    document.getElementById('fmt-italic')?.classList.toggle('active', el.fontStyle==='italic');
    document.getElementById('fmt-underline')?.classList.toggle('active', (el.textDecoration||'').includes('underline'));
    document.getElementById('fmt-strikethrough')?.classList.toggle('active', (el.textDecoration||'').includes('line-through'));
  }

  // ── Alignment buttons ─────────────────────────────────────
  _bindAlignButtons() {
    document.querySelectorAll('.align-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.engine.updateSelected({align: btn.dataset.align});
        document.querySelectorAll('.align-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  _syncAlignButtons(el) {
    const align = el?.align || 'left';
    document.querySelectorAll('.align-btn').forEach(b => b.classList.toggle('active', b.dataset.align===align));
  }

  // ── Visibility toggle ─────────────────────────────────────
  _bindVisibilityToggle() {
    const chk = document.getElementById('prop-visible');
    chk?.addEventListener('change', () => {
      const el = this.engine.getSelected();
      if (!el) return;
      this.engine.updateSelected({visible: chk.checked});
      this._updateVisibilityHint(chk.checked);
    });
  }

  _updateVisibilityHint(visible) {
    const hint = document.getElementById('visibility-hint');
    if (hint) {
      hint.textContent = visible ? 'Shown in PDF' : 'Hidden in PDF';
      hint.style.color = visible ? '#059669' : '#dc2626';
    }
  }

  // ── Property Panel ────────────────────────────────────────
  _bindPropertyPanel() {
    const inputs = [
      'prop-text','prop-font-size','prop-font-family','prop-text-color',
      'prop-x','prop-y','prop-width','prop-height','prop-rotation',
      'prop-barcode-value','prop-barcode-format','prop-barcode-showtext',
      'prop-qr-value','prop-qr-type',
      'prop-shape-fill','prop-shape-stroke','prop-line-width','prop-shape-radius',
      'prop-image-colormode',
    ];
    inputs.forEach(id => {
      const el = document.getElementById(id); if (!el) return;
      const eventType = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(eventType, () => this._applyPropChange(id, el));
    });

    // Special handling for font family on mobile: also listen to 'input' event
    // This fixes the issue where 'change' doesn't fire reliably on mobile
    const fontSelect = document.getElementById('prop-font-family');
    if (fontSelect) {
      fontSelect.addEventListener('input', async (e) => {
        const fontName = e.target.value;
        // Load the font if it's a Google Font
        await this._loadGoogleFont(fontName);
        this._applyPropChange('prop-font-family', e.target);
        // Re-render canvas after font loads
        this.engine.render();
      });
    }
  }

  _applyPropChange(id, el) {
    const val = el.type==='checkbox' ? el.checked
              : el.type==='number'   ? (parseFloat(el.value)||0)
              : el.value;
    const map = {
      'prop-text':'text','prop-font-size':'fontSize','prop-font-family':'fontFamily',
      'prop-text-color':'color',
      'prop-x':'x','prop-y':'y','prop-width':'width','prop-height':'height','prop-rotation':'rotation',
      'prop-barcode-value':'value','prop-barcode-format':'format','prop-barcode-showtext':'showText',
      'prop-qr-value':'value','prop-qr-type':'qrType',
      'prop-shape-fill':'fillColor','prop-shape-stroke':'strokeColor',
      'prop-line-width':'lineWidth','prop-shape-radius':'radius',
      'prop-image-colormode':'colorMode',
    };
    if (map[id]) this.engine.updateSelected({[map[id]]: val});
  }

  _updatePropertyPanel(el) {
    const show = ids => {
      document.querySelectorAll('.prop-group').forEach(g => g.style.display='none');
      ids.forEach(id => { const g=document.getElementById(id); if (g) g.style.display='block'; });
    };
    const badge = document.getElementById('selected-type-badge');

    if (!el) {
      show([]);
      document.getElementById('no-selection-msg').style.display = 'flex';
      document.getElementById('prop-panel-content').style.display = 'none';
      if (badge) badge.style.display = 'none';
      return;
    }

    document.getElementById('no-selection-msg').style.display = 'none';
    document.getElementById('prop-panel-content').style.display = 'block';
    if (badge) { badge.style.display='inline-block'; badge.textContent=el.type.toUpperCase(); }

    // Always show visibility + position
    show(['prop-group-visibility','prop-group-position']);

    // Sync visibility toggle
    const visChk = document.getElementById('prop-visible');
    if (visChk) visChk.checked = el.visible !== false;
    this._updateVisibilityHint(el.visible !== false);

    this._sv('prop-x',        Math.round(el.x));
    this._sv('prop-y',        Math.round(el.y));
    this._sv('prop-width',    Math.round(el.width));
    this._sv('prop-height',   Math.round(el.height));
    this._sv('prop-rotation', el.rotation||0);

    switch (el.type) {
      case 'text':
        show(['prop-group-visibility','prop-group-position','prop-group-text','prop-group-textformat']);
        this._sv('prop-text',        el.text);
        this._sv('prop-font-size',   el.fontSize);
        this._sv('prop-font-family', el.fontFamily);
        this._sv('prop-text-color',  el.color);
        this._syncFormatButtons(el);
        this._syncAlignButtons(el);
        // Preload the font if it's a Google Font
        this._loadGoogleFont(el.fontFamily);
        break;
      case 'barcode':
        show(['prop-group-visibility','prop-group-position','prop-group-barcode']);
        this._sv('prop-barcode-value',  el.value);
        this._sv('prop-barcode-format', el.format);
        document.getElementById('prop-barcode-showtext').checked = el.showText;
        break;
      case 'qrcode':
        show(['prop-group-visibility','prop-group-position','prop-group-qr']);
        this._sv('prop-qr-value', el.value);
        this._sv('prop-qr-type',  el.qrType ?? 0);
        break;
      case 'shape':
        show(['prop-group-visibility','prop-group-position','prop-group-shape']);
        this._sv('prop-shape-fill',   el.fillColor==='transparent' ? '#ffffff' : el.fillColor);
        this._sv('prop-shape-stroke', el.strokeColor);
        this._sv('prop-line-width',   el.lineWidth);
        this._sv('prop-shape-radius', el.radius||8);
        break;
      case 'image':
        show(['prop-group-visibility','prop-group-position','prop-group-image']);
        this._sv('prop-image-colormode', el.colorMode);
        break;
    }
    this._updateBindingDropdown(el);
  }

  _sv(id, val) { const el=document.getElementById(id); if (el) el.value=val; }

  _updateBindingDropdown(el) {
    const c = document.getElementById('binding-container');
    const s = document.getElementById('prop-binding');
    if (!c||!s) return;
    if (!['text','barcode','qrcode'].includes(el?.type)) { c.style.display='none'; return; }
    c.style.display = 'block';
    s.innerHTML = '<option value="">-- No binding --</option>';
    (this.dm.headers||[]).forEach(h => {
      const o=document.createElement('option'); o.value=h; o.text=h;
      if (this.dm.fieldBindings[el.id]===h) o.selected=true;
      s.appendChild(o);
    });
    s.onchange = () => { if (s.value) this.dm.bindField(el.id,s.value); else this.dm.unbindField(el.id); };
  }

  // ── Engine events ─────────────────────────────────────────
  _bindEngineEvents() {
    this.engine.on('select', el => this._updatePropertyPanel(el));
    this.engine.on('update', el => this._updatePropertyPanel(el));
    this.engine.on('history', ({canUndo, canRedo}) => {
      const ub=document.getElementById('btn-undo'); if(ub) ub.disabled=!canUndo;
      const rb=document.getElementById('btn-redo'); if(rb) rb.disabled=!canRedo;
      const um=document.getElementById('btn-m-undo'); if(um) um.disabled=!canUndo;
      const rm=document.getElementById('btn-m-redo'); if(rm) rm.disabled=!canRedo;
    });
    this.engine.on('configChanged', cfg => {
      const wEl=document.getElementById('label-width-mm');
      const hEl=document.getElementById('label-height-mm');
      if (wEl) wEl.value=cfg.widthMm;
      if (hEl) hEl.value=cfg.heightMm;
      document.querySelectorAll('.orient-btn').forEach(b => b.classList.toggle('active', b.dataset.orient===cfg.orientation));
    });
    this.engine.on('zoomChanged', zoom => {
      const el=document.getElementById('zoom-display');
      if (el) el.textContent=Math.round(zoom*100)+'%';
    });
  }

  // ── Data Panel ────────────────────────────────────────────
  _bindDataPanel() {
    const fi=document.getElementById('data-file-input');
    const dz=document.getElementById('data-drop-zone');
    fi?.addEventListener('change', async e => { await this._loadDataFile(e.target.files[0]); e.target.value=''; });
    if (dz) {
      dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
      dz.addEventListener('drop', async e => { e.preventDefault(); dz.classList.remove('drag-over'); await this._loadDataFile(e.dataTransfer.files[0]); });
      dz.addEventListener('click', () => fi?.click());
    }
    document.getElementById('btn-prev-row')?.addEventListener('click', () => {
      const totalSets = this.dm.columnGroups || 1;
      let rowIdx = this.dm.currentRowIndex;
      let setIdx = (this.dm.currentSetIndex || 0) - 1;
      
      if (setIdx < 0) {
        if (rowIdx > 0) {
          rowIdx--;
          setIdx = totalSets - 1;
        } else {
          setIdx = 0;
        }
      }
      
      this.dm.applyRowToCanvas(this.engine, rowIdx, setIdx);
      this._updateRowNav();
    });
    
    document.getElementById('btn-next-row')?.addEventListener('click', () => {
      const totalSets = this.dm.columnGroups || 1;
      let rowIdx = this.dm.currentRowIndex;
      let setIdx = (this.dm.currentSetIndex || 0) + 1;
      
      if (setIdx >= totalSets) {
        if (rowIdx < this.dm.importedData.length - 1) {
          rowIdx++;
          setIdx = 0;
        } else {
          setIdx = totalSets - 1;
        }
      }
      
      this.dm.applyRowToCanvas(this.engine, rowIdx, setIdx);
      this._updateRowNav();
    });
    this.dm.on('dataLoaded', ({rows,headers}) => { this._renderDataTable(headers,rows); this._updateRowNav(); this.showToast(`✅ Loaded ${rows.length} rows`); });
    this.dm.on('rowApplied', ({rowIndex}) => { this._updateRowNav(); document.querySelectorAll('#data-table-body tr').forEach((r,i)=>r.classList.toggle('active-row',i===rowIndex)); });
  }

  async _loadDataFile(file) {
    if (!file) return;
    try { this.showToast('⏳ Loading…'); await this.dm.loadFile(file); }
    catch(e) { this.showToast('❌ '+e.message,'error'); }
  }

  _renderDataTable(headers, rows) {
    const th=document.getElementById('data-table-head');
    const tb=document.getElementById('data-table-body');
    if (!th||!tb) return;
    th.innerHTML='<tr>'+headers.map(h=>`<th>${h}</th>`).join('')+'<th>↵</th></tr>';
    tb.innerHTML=rows.map((row,i)=>`<tr>${headers.map(h=>`<td>${row[h]||''}</td>`).join('')}<td><button class="btn-apply-row" data-row="${i}">↵</button></td></tr>`).join('');
    tb.querySelectorAll('.btn-apply-row').forEach(b=>b.addEventListener('click',()=>this.dm.applyRowToCanvas(this.engine,parseInt(b.dataset.row))));
  }

  _updateRowNav() {
    const total=this.dm.importedData.length, cur=this.dm.currentRowIndex;
    const totalSets = this.dm.columnGroups || 1;
    const currentSet = this.dm.currentSetIndex || 0;
    const el=document.getElementById('row-nav-info');
    
    if (el) {
      if (total > 0 && totalSets > 1) {
        el.textContent = `Row ${cur+1}/${total} • Set ${currentSet+1}/${totalSets}`;
      } else {
        el.textContent = total > 0 ? `Row ${cur+1} / ${total}` : 'No data';
      }
    }
    
    document.getElementById('btn-prev-row').disabled = cur <= 0 && currentSet === 0;
    document.getElementById('btn-next-row').disabled = cur >= total - 1 && currentSet >= totalSets - 1;
  }

  // ── Template Panel ────────────────────────────────────────
  _bindTemplatePanel() {
    const fi=document.getElementById('template-file-input');
    const dz=document.getElementById('template-drop-zone');
    fi?.addEventListener('change', async e => { await this._loadTemplate(e.target.files[0]); e.target.value=''; });
    if (dz) {
      dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
      dz.addEventListener('drop', async e => { e.preventDefault(); dz.classList.remove('drag-over'); await this._loadTemplate(e.dataTransfer.files[0]); });
      dz.addEventListener('click', () => fi?.click());
    }
  }

  async _loadTemplate(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    try {
      if (ext === 'json') {
        // Read JSON directly here to ensure correct import flow
        const text = await file.text();
        let json;
        try { json = JSON.parse(text); }
        catch(e) { this.showToast('❌ Invalid JSON file — check the file format','error'); return; }

        // Handle legacy template format (with 'fields' array and wmm/hmm)
        if (json.fields && Array.isArray(json.fields)) {
          // Convert legacy format to new format
          const converted = this.engine.convertLegacyTemplate(json);
          if (!converted) {
            this.showToast('❌ Failed to convert legacy template format','error');
            return;
          }
          const ok = this.engine.importTemplate(converted);
          if (ok) {
            this.showToast(`✅ Legacy template loaded! (${(converted.elements||[]).length} elements)`);
          } else {
            this.showToast('❌ Template import failed','error');
          }
          return;
        }

        // Validate it looks like a LabelStudio template (new format)
        if (!json.elements && !json.labelConfig) {
          this.showToast('❌ JSON does not appear to be a LabelStudio template','error');
          return;
        }

        const ok = this.engine.importTemplate(json);
        if (ok) {
          this.showToast(`✅ Template loaded! (${(json.elements||[]).length} elements)`);
        } else {
          this.showToast('❌ Template import failed','error');
        }
      } else if (['png','jpg','jpeg','webp'].includes(ext)) {
        const result = await this.dm.loadTemplateFile(file);
        if (result.type === 'image') {
          this.engine.addImage({src:result.src, x:0, y:0, width:this.engine.labelWidthPx, height:this.engine.labelHeightPx});
          this.showToast('✅ Background image applied!');
        }
      } else {
        this.showToast('❌ Unsupported file type','error');
      }
    } catch(e) { this.showToast('❌ '+e.message,'error'); }
  }

  _initPrebuiltTemplates() {
    const templates = [
      { name:'2UPs', icon:'🏷️', wmm:50, hmm:15, orientation:'landscape', backgroundImage:'images/two-upArtboard 1@4x.png',
        },
      { name:'Jwellery', icon:'💍', wmm:50, hmm:100, orientation:'portrait', backgroundImage:'images/jwellery_lable_tamplate.jpeg'
        
        },
      { name:'Shipping', icon:'📦', wmm:90, hmm:50,
        make:(W,H)=>[
          {type:'text',x:8,y:8,width:180,height:18,text:'SHIP TO:',fontSize:11,fontWeight:'bold',color:'#000',fontFamily:'Arial',fontStyle:'normal',textDecoration:'none',align:'left',rotation:0,visible:true},
          {type:'text',x:8,y:28,width:200,height:48,text:'John Doe\n123 Main St\nCity ST 12345',fontSize:12,fontWeight:'normal',color:'#000',fontFamily:'Arial',fontStyle:'normal',textDecoration:'none',align:'left',rotation:0,visible:true},
          {type:'barcode',x:8,y:98,width:200,height:60,value:'123456789012',format:'CODE128',showText:true,rotation:0,color:'#000',bgColor:'#fff',visible:true},
        ]},
      { name:'QR Badge', icon:'🎫', wmm:60, hmm:30,
        make:(W,H)=>[
          {type:'qrcode',x:6,y:6,width:78,height:78,value:'https://example.com',qrType:0,rotation:0,color:'#000',bgColor:'#fff',visible:true},
          {type:'text',x:92,y:14,width:W-98,height:22,text:'Scan Me!',fontSize:14,fontWeight:'bold',color:'#333',fontFamily:'Arial',fontStyle:'normal',textDecoration:'none',align:'left',rotation:0,visible:true},
          {type:'text',x:92,y:40,width:W-98,height:16,text:'example.com',fontSize:10,fontWeight:'normal',color:'#666',fontFamily:'Arial',fontStyle:'normal',textDecoration:'none',align:'left',rotation:0,visible:true},
        ]},
      { name:'Food Label', icon:'🍱', wmm:75, hmm:38,
        make:(W,H)=>[
          {type:'text',x:8,y:8,width:W-16,height:26,text:'Fresh Organic Salad',fontSize:15,fontWeight:'bold',color:'#2E7D32',fontFamily:'Arial',fontStyle:'normal',textDecoration:'none',align:'center',rotation:0,visible:true},
          {type:'text',x:8,y:38,width:W-16,height:16,text:'Best Before: 2025-12-31',fontSize:10,fontWeight:'normal',color:'#555',fontFamily:'Arial',fontStyle:'normal',textDecoration:'none',align:'center',rotation:0,visible:true},
          {type:'barcode',x:50,y:58,width:180,height:58,value:'5901234123457',format:'EAN13',showText:true,rotation:0,color:'#000',bgColor:'#fff',visible:true},
        ]},
      { name:'Cable', icon:'🔌', wmm:50, hmm:75, orientation:'portrait', backgroundImage:'images/cable_lable_tamplate.jpeg',
        },
    ];

    const container = document.getElementById('prebuilt-templates');
    if (!container) return;
    container.innerHTML = templates.map((t,i) =>
      `<div class="template-card" data-index="${i}"><span class="template-icon">${t.icon}</span><span class="template-name">${t.name}</span></div>`
    ).join('');
    container.querySelectorAll('.template-card').forEach(card => {
      card.addEventListener('click', async () => {
        const t = templates[parseInt(card.dataset.index)];
        this.engine.clear();
        
        // Set orientation if specified
        if (t.orientation) {
          this.engine.setOrientation(t.orientation);
        }
        
        this.engine.setLabelMm(t.wmm, t.hmm);
        const W=this.engine.labelWidthPx, H=this.engine.labelHeightPx;

        // Add background image if specified - load as blob via XHR (avoids CORS tainting)
        if (t.backgroundImage) {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', t.backgroundImage, true);
          xhr.responseType = 'blob';
          xhr.onload = () => {
            if (xhr.status === 200) {
              const blob = xhr.response;
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result;
                // Add background image as data URL (won't taint canvas)
                this.engine.addImage({src:dataUrl, x:0, y:0, width:W, height:H, colorMode:'original'});
                // Add template elements after background
                const elements = t.make(W,H).map(e => ({...e, id:'el_'+Date.now()+'_'+Math.random().toString(36).slice(2)}));
                this.engine.elements = [...this.engine.elements, ...elements];
                this.engine.render();
                this.engine.saveHistory();
                this.showToast(`✅ "${t.name}" applied with background!`);
              };
              reader.readAsDataURL(blob);
            }
          };
          xhr.onerror = () => {
            console.error('Failed to load background image');
            this.engine.elements = t.make(W,H).map(e => ({...e, id:'el_'+Date.now()+'_'+Math.random().toString(36).slice(2)}));
            this.engine.render();
            this.engine.saveHistory();
            this.showToast(`✅ "${t.name}" applied!`);
          };
          xhr.send();
        } else {
          this.engine.elements = t.make(W,H).map(e => ({...e, id:'el_'+Date.now()+'_'+Math.random().toString(36).slice(2)}));
          this.engine.render();
          this.engine.saveHistory();
          this.showToast(`✅ "${t.name}" applied!`);
        }
      });
    });
  }

  // ── Label Settings ────────────────────────────────────────
  _bindLabelSettings() {
    const wEl=document.getElementById('label-width-mm');
    const hEl=document.getElementById('label-height-mm');
    const bgEl=document.getElementById('label-bg');

    const applySize = () => { this.engine.setLabelMm(parseFloat(wEl?.value)||100, parseFloat(hEl?.value)||62); };
    wEl?.addEventListener('change', applySize);
    hEl?.addEventListener('change', applySize);
    bgEl?.addEventListener('input', () => this.engine.setBackground(bgEl.value));

    document.querySelectorAll('.orient-btn').forEach(btn => btn.addEventListener('click', () => this.engine.setOrientation(btn.dataset.orient)));

    document.querySelectorAll('.size-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const [w,h]=btn.dataset.size.split('x').map(Number);
        if (wEl) wEl.value=w; if (hEl) hEl.value=h;
        this.engine.setLabelMm(w,h);
        document.querySelectorAll('.size-preset').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    document.getElementById('btn-zoom-in')?.addEventListener('click',  () => this.engine.setZoom(this.engine.zoom+0.15));
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => this.engine.setZoom(this.engine.zoom-0.15));
    document.getElementById('btn-zoom-fit')?.addEventListener('click', () => this.engine.recalcZoom());
  }

  // ── PDF ───────────────────────────────────────────────────
  _bindPDFPanel() {
    document.getElementById('btn-preview-pdf')?.addEventListener('click',    () => this.openPDFPreview());
    document.getElementById('btn-modal-download')?.addEventListener('click', () => this.downloadPDF());
    document.getElementById('btn-modal-print')?.addEventListener('click',    () => this.printPDF());
    document.getElementById('btn-modal-close')?.addEventListener('click',    () => this.closePDFPreview());
    document.getElementById('pdf-modal-overlay')?.addEventListener('click',  e => { if (e.target===e.currentTarget) this.closePDFPreview(); });
    document.getElementById('pdf-print-all')?.addEventListener('change',     e => this._refreshPreview(e.target.checked));
  }

  async openPDFPreview() {
    const modal=document.getElementById('pdf-modal-overlay');
    const container=document.getElementById('pdf-preview-container');
    if (!modal||!container) return;
    modal.style.display='flex';
    container.innerHTML='<div class="pdf-loading">⏳ Generating preview…</div>';
    await this._refreshPreview(document.getElementById('pdf-print-all')?.checked);
  }

  async _refreshPreview(printAll) {
    const container=document.getElementById('pdf-preview-container');
    if (!container) return;
    try {
      const pages = await this._generatePDFPages(printAll);
      container.innerHTML=pages.map((d,i)=>
        `<div class="pdf-page-preview"><div class="pdf-page-number">Page ${i+1}</div><img src="${d}"/></div>`
      ).join('');
    } catch(e) { container.innerHTML=`<div class="pdf-error">❌ ${e.message}</div>`; }
  }

  // Generate export pages (uses renderForExport so hidden elements excluded)
  async _generatePDFPages(printAll) {
    const rows = this.dm.importedData;
    const pages = printAll && rows.length > 0 ? rows.length : 1;
    const result = [];
    for (let i=0; i<pages; i++) {
      if (printAll && rows.length>0) {
        this.dm.applyRowToCanvas(this.engine, i);
        await new Promise(r=>setTimeout(r,50));
      }
      const sel=this.engine.selected; this.engine.deselect();
      this.engine.renderForExport();
      result.push(this.engine.canvas.toDataURL('image/png'));
      this.engine.render();
      if (sel) this.engine.select(sel.id);
    }
    return result;
  }

  closePDFPreview() { document.getElementById('pdf-modal-overlay').style.display='none'; }

  async downloadPDF() {
    try {
      this.showToast('⏳ Generating PDF…');
      const printAll=document.getElementById('pdf-print-all')?.checked;
      const pages=await this._generatePDFPages(printAll);
      if (window.jspdf?.jsPDF) {
        const {jsPDF}=window.jspdf;
        const wMm=this.engine.labelConfig.widthMm, hMm=this.engine.labelConfig.heightMm;
        const pdf=new jsPDF({orientation:wMm>hMm?'l':'p',unit:'mm',format:[wMm,hMm]});
        pages.forEach((d,i)=>{if(i>0)pdf.addPage([wMm,hMm]);pdf.addImage(d,'PNG',0,0,wMm,hMm);});
        pdf.save('labels.pdf');
        this.showToast('✅ PDF downloaded!');
      } else {
        const a=document.createElement('a'); a.href=pages[0]; a.download='label.png'; a.click();
        this.showToast('✅ Saved as PNG');
      }
    } catch(e) { this.showToast('❌ '+e.message,'error'); }
  }

  async printPDF() {
    try {
      this.showToast('⏳ Preparing print…');
      const printAll=document.getElementById('pdf-print-all')?.checked;
      const pages=await this._generatePDFPages(printAll);
      
      if (window.jspdf?.jsPDF) {
        const {jsPDF}=window.jspdf;
        const wMm=this.engine.labelConfig.widthMm, hMm=this.engine.labelConfig.heightMm;
        const pdf=new jsPDF({orientation:wMm>hMm?'l':'p',unit:'mm',format:[wMm,hMm]});
        pages.forEach((d,i)=>{if(i>0)pdf.addPage([wMm,hMm]);pdf.addImage(d,'PNG',0,0,wMm,hMm);});
        
        // Generate blob and open in new tab for printing
        const blob = pdf.output('blob');
        const url = URL.createObjectURL(blob);
        const printWindow = window.open(url, '_blank');
        
        if (printWindow) {
          printWindow.onload = () => {
            printWindow.focus();
            setTimeout(() => {
              printWindow.print();
            }, 250);
          };
        }
        this.showToast('✅ Print dialog opened!');
      } else {
        // Fallback: open image in new tab
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
          <html>
            <head><title>Print Label</title></head>
            <body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;">
              <img src="${pages[0]}" onload="window.print();" />
            </body>
          </html>
        `);
        printWindow.document.close();
        this.showToast('✅ Print dialog opened!');
      }
    } catch(e) { this.showToast('❌ '+e.message,'error'); }
  }

  exportTemplate() {
    const json=this.engine.exportTemplate();
    const blob=new Blob([json],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download='label-template.json'; a.click();
    URL.revokeObjectURL(url); this.showToast('✅ Template saved!');
  }

  // ── Menu ──────────────────────────────────────────────────
  _bindMenuActions() {
    // Mobile menu actions (File only)
    document.getElementById('menu-new-m')?.addEventListener('click',        () => { if (confirm('Start new label?')) this.engine.clear(); this.closeMobileDrawers(); });
    document.getElementById('menu-export-png-m')?.addEventListener('click', () => { const d=this.engine.exportImage('png',true); const a=document.createElement('a'); a.href=d; a.download='label.png'; a.click(); this.showToast('✅ PNG exported!'); this.closeMobileDrawers(); });
    document.getElementById('menu-save-m')?.addEventListener('click',       () => { this.exportTemplate(); this.closeMobileDrawers(); });
    document.getElementById('menu-load-m')?.addEventListener('click',       () => { document.getElementById('template-file-input')?.click(); this.closeMobileDrawers(); });
  }

  // ── Tabs ──────────────────────────────────────────────────
  _bindTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add('active');
      });
    });
  }

  // ── Mobile UI ─────────────────────────────────────────────
  _bindMobileUI() {
    document.getElementById('mobile-backdrop')?.addEventListener('click',  () => this.closeMobileDrawers());
    document.getElementById('btn-close-sidebar')?.addEventListener('click',() => this.closeMobileDrawers());
    document.getElementById('btn-close-props')?.addEventListener('click',  () => this.closeMobileDrawers());
    document.getElementById('btn-mobile-menu')?.addEventListener('click',  () => this.openMobileSidebar());
    document.getElementById('btn-mobile-props')?.addEventListener('click', () => this.openMobileProps());
    
    // Mobile dropdown menu toggles
    document.querySelectorAll('.mm-group-title').forEach(title => {
      title.addEventListener('click', () => {
        const group = title.closest('.mm-group');
        group.classList.toggle('open');
      });
    });
  }

  openMobileSidebar() {
    document.getElementById('sidebar')?.classList.add('mobile-open');
    document.getElementById('mobile-backdrop')?.classList.add('active');
  }
  openMobileProps() {
    document.getElementById('props-panel')?.classList.add('mobile-open');
    document.getElementById('mobile-backdrop')?.classList.add('active');
  }
  closeMobileDrawers() {
    document.getElementById('sidebar')?.classList.remove('mobile-open');
    document.getElementById('props-panel')?.classList.remove('mobile-open');
    document.getElementById('mobile-backdrop')?.classList.remove('active');
  }

  // ── Toast ─────────────────────────────────────────────────
  showToast(msg, type='info') {
    let c=document.getElementById('toast-container');
    if (!c) { c=document.createElement('div'); c.id='toast-container'; document.body.appendChild(c); }
    const t=document.createElement('div'); t.className=`toast toast-${type}`; t.textContent=msg;
    c.appendChild(t);
    setTimeout(()=>t.classList.add('show'),10);
    setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),300);},3200);
  }
}

window.UIController = UIController;
