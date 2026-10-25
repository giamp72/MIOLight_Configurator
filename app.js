const STEPS = [
  { title: 'Prodotto', hint: 'Selezione articolo' },
  { title: 'Modello 3D', hint: 'Carica e verifica' },
  { title: 'Mappatura', hint: 'Collega le mesh' },
  { title: 'Aspetto', hint: 'Materiali e anteprime' },
  { title: 'Default e test', hint: 'Verifica il prodotto' },
  { title: 'Pubblicazione', hint: 'Valida e pubblica' }
];

const PRODUCTS = [
  {
    id: 'MIO-ANT-001',
    code: 'SED-ANT-01',
    name: 'Sedia Antonietta',
    category: 'Sedute · Sedia',
    icon: '♧',
    attributes: [
      {
        code: 'STRUTTURA',
        label: 'Struttura',
        default: 'STR_NERO',
        options: [
          { code: 'STR_NERO', label: 'Nero opaco', material: 'MAT_STR_NERO_OPACO', color: '#303835' },
          { code: 'STR_CROMO', label: 'Cromato', material: 'MAT_STR_CROMATO', color: '#a9b5b0' },
          { code: 'STR_OTTONE', label: 'Ottone satinato', material: 'MAT_STR_OTTONE', color: '#ad8a55' }
        ]
      },
      {
        code: 'CUSCINO',
        label: 'Cuscino',
        default: 'CUS_BEIGE',
        options: [
          { code: 'CUS_BEIGE', label: 'Tessuto beige', material: 'MAT_CUSCINO_BEIGE', color: '#c6b79a' },
          { code: 'CUS_GRIGIO', label: 'Tessuto grigio', material: 'MAT_CUSCINO_GRIGIO', color: '#8a918d' },
          { code: 'CUS_VERDE', label: 'Tessuto verde', material: 'MAT_CUSCINO_VERDE', color: '#667c68' }
        ]
      }
    ]
  },
  {
    id: 'MIO-POL-014',
    code: 'POL-LUC-02',
    name: 'Poltrona Luce',
    category: 'Sedute · Poltrona',
    icon: '⌂',
    attributes: [
      {
        code: 'STRUTTURA',
        label: 'Struttura',
        default: 'STR_ROVERE',
        options: [
          { code: 'STR_ROVERE', label: 'Rovere naturale', material: 'MAT_ROVERE', color: '#9b734e' },
          { code: 'STR_NERO', label: 'Nero opaco', material: 'MAT_NERO_OPACO', color: '#303835' }
        ]
      },
      {
        code: 'RIVESTIMENTO',
        label: 'Rivestimento',
        default: 'RIV_SABBIA',
        options: [
          { code: 'RIV_SABBIA', label: 'Lino sabbia', material: 'MAT_LINO_SABBIA', color: '#c8baa1' },
          { code: 'RIV_BOSCO', label: 'Velluto bosco', material: 'MAT_VELLUTO_BOSCO', color: '#526e5f' }
        ]
      }
    ]
  },
  {
    id: 'MIO-TAV-008',
    code: 'TAV-NOV-04',
    name: 'Tavolo Nova',
    category: 'Tavoli · Tavolo da pranzo',
    icon: '▱',
    attributes: [
      {
        code: 'PIANO',
        label: 'Piano',
        default: 'PIANO_ROVERE',
        options: [
          { code: 'PIANO_ROVERE', label: 'Rovere chiaro', material: 'MAT_ROVERE_CHIARO', color: '#c29e72' },
          { code: 'PIANO_NOCE', label: 'Noce', material: 'MAT_NOCE', color: '#76523e' }
        ]
      },
      {
        code: 'STRUTTURA',
        label: 'Struttura',
        default: 'STR_NERO',
        options: [
          { code: 'STR_NERO', label: 'Nero opaco', material: 'MAT_NERO_OPACO', color: '#303835' },
          { code: 'STR_CROMO', label: 'Cromato', material: 'MAT_CROMATO', color: '#a9b5b0' }
        ]
      }
    ]
  }
];

const MATERIAL_CATALOG = [
  { code: 'MAT_STR_NERO_OPACO', label: 'Nero opaco', color: '#303835' },
  { code: 'MAT_STR_CROMATO', label: 'Cromato', color: '#a9b5b0' },
  { code: 'MAT_STR_OTTONE', label: 'Ottone satinato', color: '#ad8a55' },
  { code: 'MAT_CUSCINO_BEIGE', label: 'Tessuto beige', color: '#c6b79a' },
  { code: 'MAT_CUSCINO_GRIGIO', label: 'Tessuto grigio', color: '#8a918d' },
  { code: 'MAT_CUSCINO_VERDE', label: 'Tessuto verde', color: '#667c68' },
  { code: 'MAT_ROVERE', label: 'Rovere naturale', color: '#9b734e' }
];

const freshState = () => ({
  id: null,
  currentStep: 0,
  productId: null,
  glbFileName: '',
  glbBlob: null,
  glbLoaded: false,
  meshes: [],
  materials: [],
  meshMap: {},
  optionMap: {},
  defaultsApplied: false,
  testChecks: { alternatives: false, compatibility: false },
  testEvidence: { alternatives: {}, defaultsRestored: false },
  testPassed: false,
  publishedAt: null,
  version: 0,
  search: ''
});

let state = freshState();
let three = null;
let gltfLoader = null;
let controls = null;
let scene = null;
let camera = null;
let renderer = null;
let modelRoot = null;
let threeMaterials = new Map();
let canvasResizeObserver = null;
let currentHighlightedMesh = null;
let currentToastTimer = null;
let viewerLoading = false;
let viewerUnavailable = false;
let modelLoading = false;
let viewerPromise = null;
const appDbPromise = openDatabase();

const workPanel = document.getElementById('workPanel');
const contextPanel = document.getElementById('contextPanel');
const stepNav = document.getElementById('stepNav');

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Questo browser non supporta il salvataggio locale delle bozze.'));
      return;
    }
    const request = indexedDB.open('miolight-configurator', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Impossibile aprire il salvataggio locale.'));
  });
}

function databaseRequest(mode, action) {
  return appDbPromise.then(db => new Promise((resolve, reject) => {
    const transaction = db.transaction('drafts', mode);
    const request = action(transaction.objectStore('drafts'));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Errore durante il salvataggio locale.'));
    transaction.onabort = () => reject(transaction.error || new Error('Salvataggio locale interrotto.'));
  }));
}

function selectedProduct() {
  return PRODUCTS.find(product => product.id === state.productId) || null;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function getOption(attributeCode, optionCode) {
  const attribute = selectedProduct()?.attributes.find(item => item.code === attributeCode);
  return attribute?.options.find(option => option.code === optionCode) || null;
}

function getOptionMapKey(attributeCode, optionCode) {
  return `${attributeCode}::${optionCode}`;
}

function materialOptions(attribute, option) {
  const names = state.materials.map(name => ({ code: `GLB:${name}`, label: `GLB · ${name}`, color: colorFromName(name) }));
  const catalog = MATERIAL_CATALOG.map(material => ({ ...material, label: `Catalogo · ${material.label}` }));
  const all = [...names, ...catalog];
  const preferred = all.find(material => material.code === option.material);
  if (preferred) return all;
  return [{ code: option.material, label: `${option.material} · ${option.label}`, color: option.color }, ...all];
}

function colorFromName(name) {
  const normalized = name.toLowerCase();
  if (normalized.includes('nero') || normalized.includes('black')) return '#303835';
  if (normalized.includes('crom') || normalized.includes('silver') || normalized.includes('chrome')) return '#a9b5b0';
  if (normalized.includes('ottone') || normalized.includes('brass')) return '#ad8a55';
  if (normalized.includes('beige') || normalized.includes('sabbia') || normalized.includes('sand')) return '#c6b79a';
  if (normalized.includes('verde') || normalized.includes('green')) return '#667c68';
  if (normalized.includes('noce') || normalized.includes('walnut')) return '#76523e';
  return '#9b734e';
}

function render() {
  renderNavigation();
  renderHeading();
  renderContext();
  renderStep();
  updateProgress();
  if (state.currentStep === 1 && !state.glbBlob && !renderer && !viewerLoading && !viewerUnavailable) {
    viewerLoading = true;
    ensureThree().then(() => {
      viewerLoading = false;
      attachViewer();
    }).catch(error => {
      viewerLoading = false;
      viewerUnavailable = true;
      const placeholder = document.getElementById('viewerPlaceholder');
      if (placeholder) placeholder.innerHTML = `<span><strong>Visualizzatore non disponibile</strong>${escapeHtml(error.message)}</span>`;
      showToast(error.message, true);
    });
  }
  if (state.currentStep === 1 && state.glbBlob && state.glbLoaded && !modelRoot && !modelLoading) {
    modelLoading = true;
    state.glbBlob.arrayBuffer().then(buffer => loadModelIntoViewer(buffer)).then(displayed => {
      modelLoading = false;
      if (!displayed) {
        state.glbLoaded = false;
        showToast('Il modello salvato non può essere visualizzato. Carica nuovamente il GLB.', true);
      }
      render();
    }).catch(error => {
      modelLoading = false;
      state.glbLoaded = false;
      showToast(error.message || 'Impossibile ripristinare il modello GLB.', true);
      render();
    });
  }
  attachViewer();
}

function attachViewer() {
  const stage = document.getElementById('viewerStage');
  if (!stage || !renderer) return;
  if (renderer.domElement.parentElement !== stage) stage.prepend(renderer.domElement);
  const placeholder = document.getElementById('viewerPlaceholder');
  if (placeholder) placeholder.hidden = true;
  if (canvasResizeObserver) {
    canvasResizeObserver.disconnect();
    canvasResizeObserver.observe(stage);
  }
  resizeViewer();
  if (state.currentStep === 1 && !modelRoot) createDemoChair();
}

function renderNavigation() {
  stepNav.innerHTML = STEPS.map((step, index) => {
    const active = index === state.currentStep;
    const complete = stepComplete(index);
    const disabled = !selectedProduct() && index !== 0;
    return `<button class="step-nav-button ${active ? 'active' : ''} ${complete ? 'complete' : ''}" type="button" data-action="go-step" data-step="${index}" ${disabled ? 'disabled' : ''} aria-current="${active ? 'step' : 'false'}">
      <span class="step-number">${complete && !active ? '✓' : index + 1}</span>
      <span class="step-nav-copy"><strong>${step.title}</strong><small>${step.hint}</small></span>
    </button>`;
  }).join('');
}

function stepComplete(index) {
  if (index === 0) return Boolean(selectedProduct());
  if (!selectedProduct()) return false;
  if (index === 1) return state.glbLoaded && state.meshes.length > 0;
  if (index === 2) return state.meshes.length > 0 && state.meshes.every(mesh => {
    const mapping = state.meshMap[mesh.id];
    return mapping && (mapping.type === 'fixed' || (mapping.type === 'variable' && mapping.attribute));
  });
  if (index === 3) return hasCompleteOptionMappings();
  if (index === 4) return state.defaultsApplied && state.testPassed;
  if (index === 5) return Boolean(state.publishedAt);
  return false;
}

function renderHeading() {
  const product = selectedProduct();
  document.getElementById('pageTitle').textContent = product ? product.name : 'Nuova configurazione';
  document.getElementById('pageSubtitle').textContent = product
    ? `${product.code} · Configurazione visuale in lavorazione`
    : 'Seleziona un prodotto esistente per iniziare il percorso guidato.';
  const status = document.getElementById('draftStatus');
  status.classList.remove('saved', 'unsaved');
  if (state.publishedAt && !state.dirty) {
    status.classList.add('saved');
    status.innerHTML = '<span class="status-dot"></span> Pubblicata';
  } else if (state.dirty && state.id) {
    status.classList.add('unsaved');
    status.innerHTML = '<span class="status-dot"></span> Modifiche non salvate';
  } else if (state.id) {
    status.classList.add('saved');
    status.innerHTML = '<span class="status-dot"></span> Bozza salvata';
  } else {
    status.classList.remove('saved');
    status.innerHTML = '<span class="status-dot"></span> Bozza non salvata';
  }
}

function renderContext() {
  const product = selectedProduct();
  const completed = STEPS.filter((_, index) => stepComplete(index)).length;
  const percent = Math.round(completed / STEPS.length * 100);
  const meshCount = state.meshes.length;
  const variableCount = state.meshes.filter(mesh => state.meshMap[mesh.id]?.type === 'variable').length;
  contextPanel.innerHTML = `
    <div class="context-card">
      <div class="context-heading"><strong>Riepilogo configurazione</strong><span class="tag">${state.publishedAt ? 'Pubblicata' : state.id ? 'Bozza' : 'Nuova'}</span></div>
      ${product ? `<div class="context-product"><span class="context-product-thumb">${escapeHtml(product.icon)}</span><span class="context-product-copy"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.code)}</small></span></div>` : '<p class="context-note">Scegli un articolo dal catalogo MIO/Pigreco dimostrativo.</p>'}
      <div class="context-divider"></div>
      <div class="context-row"><span>Avanzamento</span><strong>${percent}%</strong></div>
      <div class="context-progress"><span style="width:${percent}%"></span></div>
      <div class="context-row"><span>Modello 3D</span><strong title="${escapeHtml(state.glbFileName || 'Non caricato')}">${state.glbFileName ? escapeHtml(state.glbFileName) : 'Non caricato'}</strong></div>
      <div class="context-row"><span>Mesh</span><strong>${meshCount ? `${meshCount} identificate` : 'In attesa'}</strong></div>
      <div class="context-row"><span>Parti variabili</span><strong>${variableCount}</strong></div>
      <div class="context-row"><span>Test funzionale</span><strong>${state.testPassed ? 'Confermato' : 'Da eseguire'}</strong></div>
    </div>
    <div class="context-card">
      <div class="context-heading"><strong>Stato sorgente</strong><span class="tag warning">Demo</span></div>
      <div class="activity-line"><span class="activity-mark"></span><span>Prodotti, opzioni e default sono dati esemplificativi.</span></div>
      <div class="activity-line"><span class="activity-mark"></span><span>Compatibilità e pubblicazione non sono collegate al backend.</span></div>
      ${state.publishedAt ? `<div class="context-divider"></div><div class="published-stamp">✓ Versione ${state.version} · ${new Date(state.publishedAt).toLocaleDateString('it-IT')}</div>` : ''}
    </div>`;
}

function renderStep() {
  const renderers = [renderProductStep, renderModelStep, renderMappingStep, renderAppearanceStep, renderTestStep, renderPublishStep];
  workPanel.innerHTML = renderers[state.currentStep]();
}

function stepHeader(index, title, description) {
  return `<div class="panel-content">
    <div class="step-eyebrow"><span class="step-number">${index + 1}</span> Fase ${index + 1} di 6 · ${STEPS[index].title}</div>
    <h2 class="panel-title">${title}</h2>
    <p class="panel-description">${description}</p>
    <div class="panel-divider"></div>`;
}

function stepFooter(previous, next, nextLabel = 'Continua') {
  return `</div><div class="panel-actions">
    <button class="button button-quiet" type="button" data-action="${previous >= 0 ? 'go-step' : 'noop'}" ${previous >= 0 ? `data-step="${previous}"` : 'disabled'}>← Indietro</button>
    <div class="action-right"><button class="button button-secondary" type="button" data-action="save">Salva bozza</button>
    <button class="button button-primary" type="button" data-action="${next < 0 ? 'noop' : 'go-step'}" ${next >= 0 ? `data-step="${next}"` : 'disabled'}>${nextLabel} ${next >= 0 ? '→' : ''}</button></div>
  </div>`;
}

function renderProductStep() {
  const product = selectedProduct();
  const filtered = PRODUCTS.filter(item => `${item.code} ${item.name} ${item.category}`.toLowerCase().includes((state.search || '').toLowerCase()));
  const rows = filtered.map(item => `<button class="product-card ${state.productId === item.id ? 'chosen' : ''}" type="button" data-action="select-product" data-product="${escapeHtml(item.id)}">
    <span class="product-thumb" aria-hidden="true">${escapeHtml(item.icon)}</span>
    <span class="product-copy"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.code)} · ${escapeHtml(item.category)}</small></span>
    <span class="product-badge">${item.attributes.length} attributi</span><span class="product-check" aria-hidden="true">✓</span>
  </button>`).join('');
  return `${stepHeader(0, 'Scegli il prodotto da configurare', 'Cerca un articolo già presente nell’anagrafica. L’identificativo sorgente viene mantenuto: MIO Light aggiunge solo le associazioni necessarie alla rappresentazione 3D.')}
    <div class="info-banner"><span class="info-symbol">i</span><span><strong>Catalogo dimostrativo.</strong> I prodotti e gli attributi mostrati non provengono da MIO/Pigreco.</span></div>
    <div style="margin-top:17px">
      <label class="field-label" for="productSearch">Cerca per codice o descrizione</label>
      <div class="search-wrap"><span class="search-glyph" aria-hidden="true">⌕</span><input id="productSearch" class="text-input" type="search" placeholder="Es. SED-ANT-01 oppure Antonietta" value="${escapeHtml(state.search)}"></div>
    </div>
    <div class="product-list">${rows || '<div class="empty-note">Nessun prodotto corrisponde alla ricerca.</div>'}</div>
    ${product ? `<div class="info-banner" style="margin-top:14px"><span class="info-symbol">✓</span><span><strong>${escapeHtml(product.name)} selezionato.</strong> ${product.attributes.length} attributi configurabili e relativi default sono disponibili nel dataset demo.</span></div>` : ''}
    ${stepFooter(-1, product ? 1 : -1)}`;
}

function renderModelStep() {
  const meshes = state.meshes;
  const meshList = meshes.length ? meshes.map(mesh => {
    const type = state.meshMap[mesh.id]?.type;
    return `<button type="button" class="mesh-list-item ${currentHighlightedMesh === mesh.id ? 'selected' : ''}" data-action="highlight-mesh" data-mesh="${escapeHtml(mesh.id)}">
      <span class="mesh-shape"></span><span>${escapeHtml(mesh.name)}</span><span class="mesh-status">${type === 'fixed' ? 'Fissa' : type === 'variable' ? 'Variabile' : 'Da classificare'}</span>
    </button>`;
  }).join('') : '<div class="empty-note" style="margin:10px">Carica un file GLB per leggere le mesh.</div>';
  return `${stepHeader(1, 'Carica e analizza il modello 3D', 'Importa il GLB già predisposto. Il viewer legge la gerarchia e i nomi delle mesh: questa operazione non modifica attributi, opzioni o regole commerciali.')}
    <div class="upload-zone">
      <span class="upload-icon" aria-hidden="true">↑</span>
      <div class="upload-copy"><strong>${state.glbFileName ? escapeHtml(state.glbFileName) : 'Trascina qui il file GLB'}</strong><p>${state.glbFileName ? `${meshes.length} mesh · ${state.materials.length} materiali identificati` : 'Formato .glb · modello ottimizzato per il web'}</p></div>
      <label class="button button-secondary" for="glbInput">${state.glbFileName ? 'Sostituisci GLB' : 'Seleziona GLB'}</label>
      <input class="file-input-hidden" id="glbInput" type="file" accept=".glb,model/gltf-binary">
    </div>
    ${state.glbFileName && !meshes.length ? '<div class="info-banner error" style="margin-top:10px"><span class="info-symbol">!</span><span>Il GLB non contiene mesh leggibili. Seleziona un modello GLB valido con geometria.</span></div>' : ''}
    <div class="model-layout">
      <div class="viewer-card"><div class="viewer-head"><strong>Anteprima modello</strong><small>${state.glbLoaded ? 'GLB caricato' : 'Visualizzazione demo'}</small></div>
        <div class="viewer-stage" id="viewerStage"><div class="viewer-placeholder" id="viewerPlaceholder"><span><strong>${state.glbLoaded ? 'Caricamento modello…' : 'Visualizzatore 3D'}</strong>${state.glbLoaded ? '' : 'Carica un GLB per visualizzare il tuo modello. La scena demo mostra le parti selezionabili.'}</span></div><span class="viewer-help">Trascina per ruotare · scroll per zoom</span></div>
      </div>
      <div class="mesh-card"><div class="mesh-card-head"><strong>Albero delle mesh</strong><span class="tag">${meshes.length}</span></div><div class="mesh-list">${meshList}</div></div>
    </div>
    <div class="hint" style="margin-top:10px">Se il modello non viene visualizzato, verifica che il GLB contenga geometria e materiali incorporati. Il viewer usa Three.js installato nel progetto.</div>
    ${stepFooter(0, 2)}`;
}

function renderMappingStep() {
  const product = selectedProduct();
  if (!state.meshes.length) {
    return `${stepHeader(2, 'Classifica e collega le parti del modello', 'Per ogni mesh indica se rimane fissa oppure se varia con una scelta commerciale. Più mesh possono condividere lo stesso attributo.')}
      <div class="empty-note">Carica prima un GLB nella fase “Modello 3D” per poter classificare le mesh.</div>${stepFooter(1, -1)}`;
  }
  const rows = state.meshes.map(mesh => {
    const mapping = state.meshMap[mesh.id] || {};
    const type = mapping.type || '';
    const attributes = product.attributes.map(attribute => `<option value="${escapeHtml(attribute.code)}" ${mapping.attribute === attribute.code ? 'selected' : ''}>${escapeHtml(attribute.label)}</option>`).join('');
    return `<div class="mapping-row">
      <span class="mapping-name" title="${escapeHtml(mesh.name)}">${escapeHtml(mesh.name)}</span>
      <select class="select-input type-select" aria-label="Tipo mesh ${escapeHtml(mesh.name)}" data-action="mesh-type" data-mesh="${escapeHtml(mesh.id)}">
        <option value="">Classifica…</option><option value="fixed" ${type === 'fixed' ? 'selected' : ''}>Fissa</option><option value="variable" ${type === 'variable' ? 'selected' : ''}>Variabile</option>
      </select>
      <select class="select-input" aria-label="Attributo per ${escapeHtml(mesh.name)}" data-action="mesh-attribute" data-mesh="${escapeHtml(mesh.id)}" ${type !== 'variable' ? 'disabled' : ''}>
        <option value="">Seleziona attributo…</option>${attributes}
      </select>
    </div>`;
  }).join('');
  const classified = state.meshes.filter(mesh => {
    const mapping = state.meshMap[mesh.id];
    return mapping && (mapping.type === 'fixed' || (mapping.type === 'variable' && mapping.attribute));
  }).length;
  return `${stepHeader(2, 'Classifica e collega le parti del modello', 'Per ogni mesh indica se rimane fissa oppure se varia con una scelta commerciale. Più mesh possono condividere lo stesso attributo.')}
    <div class="info-banner"><span class="info-symbol">i</span><span>Le mesh non classificate generano un avviso; una mesh variabile senza attributo blocca la pubblicazione.</span></div>
    <div class="mapping-list" style="margin-top:14px">${rows}</div>
    <div class="mapping-footer">${classified} di ${state.meshes.length} mesh classificate · ${product.attributes.length} attributi sorgente disponibili</div>
    ${stepFooter(1, 3)}`;
}

function renderAppearanceStep() {
  const product = selectedProduct();
  const mappedAttributes = [...new Set(Object.values(state.meshMap).filter(mapping => mapping?.type === 'variable' && mapping.attribute).map(mapping => mapping.attribute))];
  const groups = mappedAttributes.map(attributeCode => {
    const attribute = product.attributes.find(item => item.code === attributeCode);
    if (!attribute) return '';
    const rows = attribute.options.map(option => {
      const key = getOptionMapKey(attribute.code, option.code);
      const mapping = state.optionMap[key] || {};
      const materials = materialOptions(attribute, option);
      const options = materials.map(material => `<option value="${escapeHtml(material.code)}" ${mapping.material === material.code ? 'selected' : ''}>${escapeHtml(material.label)}</option>`).join('');
      return `<div class="option-row">
        <span class="option-copy"><strong>${escapeHtml(option.label)}</strong><small>${escapeHtml(option.code)}</small></span>
        <select class="select-input" aria-label="Materiale per ${escapeHtml(option.label)}" data-action="option-material" data-attribute="${escapeHtml(attribute.code)}" data-option="${escapeHtml(option.code)}">
          <option value="">Associa materiale 3D…</option>${options}
        </select>
        <div class="preview-upload">${mapping.previewUrl ? `<img class="preview-thumb" src="${mapping.previewUrl}" alt="Anteprima ${escapeHtml(option.label)}">` : '<span class="preview-thumb" aria-hidden="true"></span>'}
          <label class="button button-secondary" for="preview-${escapeHtml(attribute.code)}-${escapeHtml(option.code)}">${mapping.previewName ? 'Cambia JPG' : 'Aggiungi JPG'}</label>
          <input class="file-input-hidden" id="preview-${escapeHtml(attribute.code)}-${escapeHtml(option.code)}" type="file" accept="image/jpeg,.jpg,.jpeg" data-action="option-preview" data-attribute="${escapeHtml(attribute.code)}" data-option="${escapeHtml(option.code)}">
          <span>${mapping.previewName ? escapeHtml(mapping.previewName) : 'Facoltativo'}</span>
        </div>
      </div>`;
    }).join('');
    return `<div class="option-group"><div class="option-group-head"><strong>${escapeHtml(attribute.label)}</strong><small>${attribute.options.length} opzioni sorgente · ${state.meshes.filter(mesh => state.meshMap[mesh.id]?.attribute === attribute.code).length} mesh collegate</small></div>${rows}</div>`;
  }).join('');
  return `${stepHeader(3, 'Associa l’aspetto alle opzioni', 'Per ogni opzione commerciale seleziona il materiale 3D che il viewer applicherà alle mesh collegate. Le anteprime JPG sono facoltative in questo prototipo.')}
    <div class="info-banner"><span class="info-symbol">i</span><span>Il codice dell’opzione resta quello sorgente. Più opzioni possono condividere lo stesso materiale; l’immagine JPG non sostituisce il materiale 3D.</span></div>
    ${groups ? `<div class="option-groups" style="margin-top:14px">${groups}</div>` : '<div class="empty-note" style="margin-top:14px">Nessun attributo è ancora collegato a una mesh variabile. Completa la mappatura nella fase precedente.</div>'}
    <div class="hint" style="margin-top:12px">I materiali del GLB caricato e il catalogo grafico sono selezionabili; il catalogo mostrato è dimostrativo.</div>
    ${stepFooter(2, 4)}`;
}

function renderTestStep() {
  const product = selectedProduct();
  const defaults = product.attributes.map(attribute => `<div class="default-card"><label>${escapeHtml(attribute.label)} · default MIO/Pigreco</label>
    <select class="select-input" aria-label="Default sorgente ${escapeHtml(attribute.label)}" disabled>
      ${attribute.options.map(option => `<option value="${escapeHtml(option.code)}" ${option.code === attribute.default ? 'selected' : ''}>${escapeHtml(option.label)} · ${escapeHtml(option.code)}</option>`).join('')}
    </select></div>`).join('');
  const testOptions = product.attributes.map(attribute => `<div class="test-row"><strong>${escapeHtml(attribute.label)}</strong>
    <select class="select-input" aria-label="Opzione di test ${escapeHtml(attribute.label)}" data-action="test-option" data-attribute="${escapeHtml(attribute.code)}">
      ${attribute.options.map(option => `<option value="${escapeHtml(option.code)}">${escapeHtml(option.label)}</option>`).join('')}
    </select></div>`).join('');
  return `${stepHeader(4, 'Applica i default e prova il configuratore', 'I valori iniziali sono ereditati dal prodotto sorgente. Controlla il rendering, poi registra l’esito del test prima della pubblicazione.')}
    <div class="info-banner warning"><span class="info-symbol">!</span><span>Integrazione non attiva: i controlli sono una simulazione locale e non interrogano il backend MIO/Pigreco.</span></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin:17px 0 9px"><strong style="font-size:10px">Configurazione iniziale</strong><button type="button" class="button button-secondary" data-action="apply-defaults">Applica default sorgente</button></div>
    <div class="default-grid">${defaults}</div>
    ${state.defaultsApplied ? '<div class="info-banner" style="margin-top:10px"><span class="info-symbol">✓</span><span>Default applicati al viewer. Verifica visivamente la corrispondenza col prodotto atteso.</span></div>' : ''}
    <div class="panel-divider"></div>
    <strong style="font-size:10px">Anteprima cliente · selezioni alternative</strong>
    <p class="hint" style="margin:5px 0 0">Le opzioni disponibili sono esemplificative; il viewer applica i materiali associati alle mesh.</p>
    <div class="test-attribute-list">${testOptions}</div>
    <p class="hint">Prova almeno un’opzione alternativa per ogni attributo, poi riapplica i default prima di confermare il test.</p>
    <div class="check-line"><input type="checkbox" id="testAlternatives" data-action="test-check" data-check="alternatives" ${state.testChecks.alternatives ? 'checked' : ''}><label for="testAlternatives">Ho provato un’alternativa per ogni attributo e ho verificato il ritorno ai default.</label></div>
    <div class="check-line"><input type="checkbox" id="testCompatibility" data-action="test-check" data-check="compatibility" ${state.testChecks.compatibility ? 'checked' : ''}><label for="testCompatibility">Ho verificato la gestione delle opzioni non ammesse dal backend, se previste per questo prodotto.</label></div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:13px"><button class="button button-primary" type="button" data-action="confirm-test" ${!state.defaultsApplied ? 'disabled' : ''}>Conferma esito test</button>${state.testPassed ? '<span class="tag success">Test registrato</span>' : '<span class="hint">Conferma dopo aver completato i controlli.</span>'}</div>
    ${stepFooter(3, 5)}`;
}

function renderPublishStep() {
  const checks = validateConfiguration();
  const blocking = checks.filter(check => check.level === 'blocking');
  const successCount = checks.filter(check => check.level === 'success').length;
  const rows = checks.map(check => `<div class="validation-item ${check.level === 'blocking' ? 'blocking' : check.level === 'notice' ? 'notice' : ''}">
    <span class="validation-icon">${check.level === 'success' ? '✓' : check.level === 'blocking' ? '!' : 'i'}</span>
    <span class="validation-copy"><strong>${escapeHtml(check.title)}</strong><small>${escapeHtml(check.detail)}</small></span>
    <span class="tag ${check.level === 'success' ? 'success' : check.level === 'blocking' ? 'error' : 'warning'}">${check.level === 'success' ? 'OK' : check.level === 'blocking' ? 'Bloccante' : 'Avviso'}</span>
  </div>`).join('');
  return `${stepHeader(5, 'Verifica e pubblica la configurazione', 'Controlla il riepilogo. Una bozza può essere salvata in qualsiasi momento; la pubblicazione è consentita solo senza errori bloccanti.')}
    <div class="validation-list">${rows}</div>
    <div class="publish-card">
      <div>${state.publishedAt ? `<strong>Versione ${state.version} pubblicata</strong><p>Pubblicata il ${new Date(state.publishedAt).toLocaleString('it-IT')} · Le nuove modifiche richiedono un nuovo test e una nuova pubblicazione.</p>` : `<strong>${blocking.length ? `${blocking.length} controlli bloccanti da risolvere` : `${successCount} controlli superati`}</strong><p>Le anteprime JPG sono segnalate come avviso se non associate.</p>`}</div>
      ${state.publishedAt ? '<span class="published-stamp">✓ Online</span>' : `<button class="button button-primary" type="button" data-action="publish" ${blocking.length ? 'disabled' : ''}>Pubblica configurazione →</button>`}
    </div>
    <div class="info-banner warning" style="margin-top:12px"><span class="info-symbol">i</span><span>La pubblicazione è locale a questo browser. Per renderla disponibile al frontend cliente occorre collegare le API e l’archivio di produzione.</span></div>
    ${stepFooter(4, -1)}`;
}

function hasCompleteOptionMappings() {
  const product = selectedProduct();
  if (!product) return false;
  const mappedAttributes = new Set(Object.values(state.meshMap).filter(mapping => mapping?.type === 'variable').map(mapping => mapping.attribute).filter(Boolean));
  if (!mappedAttributes.size) return false;
  return [...mappedAttributes].every(code => {
    const attribute = product.attributes.find(item => item.code === code);
    return attribute && attribute.options.every(option => Boolean(state.optionMap[getOptionMapKey(code, option.code)]?.material));
  });
}

function updateProgress() {
  document.getElementById('progressFill').style.width = `${((state.currentStep + 1) / STEPS.length) * 100}%`;
}

function setDirty() {
  markDraftChanged({ invalidateDefault: true, resetTestEvidence: true });
  render();
}

function markDraftChanged({ invalidateDefault = false, resetTestEvidence = false } = {}) {
  state.dirty = true;
  state.testPassed = false;
  state.publishedAt = null;
  if (invalidateDefault) state.defaultsApplied = false;
  if (resetTestEvidence) state.testEvidence = { alternatives: {}, defaultsRestored: false };
}

function setCurrentStep(index) {
  if (index < 0 || index >= STEPS.length) return;
  if (index > 0 && !selectedProduct()) {
    showToast('Seleziona prima un prodotto sorgente.', true);
    return;
  }
  state.currentStep = index;
  render();
}

async function selectProduct(productId) {
  if (!PRODUCTS.some(product => product.id === productId)) {
    showToast('Il prodotto selezionato non è disponibile nel catalogo demo.', true);
    return;
  }
  if (state.productId !== productId) {
    if (state.productId && state.dirty && !window.confirm('La configurazione corrente contiene modifiche non salvate. Vuoi abbandonarle?')) return;
    try {
      const drafts = await databaseRequest('readonly', store => store.getAll());
      const existing = drafts.find(draft => draft.productId === productId && draft.id !== state.id);
      if (existing) {
        removeLoadedModel();
        state = { ...freshState(), ...existing, search: '', dirty: false };
        state.testEvidence ||= { alternatives: {}, defaultsRestored: false };
        localStorage.setItem('miolight-active-draft', existing.id);
        currentHighlightedMesh = null;
        render();
        showToast('Esiste già una configurazione salvata: ho aperto la bozza esistente.');
        return;
      }
    } catch (error) {
      showToast(error.message || 'Impossibile verificare le configurazioni salvate.', true);
      return;
    }
    state = { ...freshState(), productId, currentStep: 0, dirty: true };
    currentHighlightedMesh = null;
    removeLoadedModel();
  }
  render();
}

function removeLoadedModel() {
  if (modelRoot && scene) scene.remove(modelRoot);
  modelRoot = null;
  threeMaterials = new Map();
  state.glbLoaded = false;
  state.glbBlob = null;
  state.glbFileName = '';
  state.meshes = [];
  state.materials = [];
  state.meshMap = {};
  state.optionMap = {};
  state.defaultsApplied = false;
}

function readGlbJson(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('Il file selezionato non è un GLB valido.');
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`Versione GLB ${version} non supportata; è richiesto GLB 2.0.`);
  const declaredLength = view.getUint32(8, true);
  if (declaredLength > buffer.byteLength) throw new Error('Il GLB è incompleto o danneggiato.');
  let offset = 12;
  while (offset + 8 <= declaredLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    offset += 8;
    if (chunkLength > declaredLength - offset) throw new Error('Il GLB contiene un chunk non valido.');
    if (chunkType === 0x4e4f534a) {
      try {
        return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset, chunkLength)).replace(/\0+$/, '').trim());
      } catch {
        throw new Error('Il GLB contiene metadati JSON non leggibili.');
      }
    }
    offset += chunkLength;
  }
  throw new Error('Nel GLB manca il chunk JSON necessario per leggere le mesh.');
}

async function handleGlbUpload(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.glb')) {
    showToast('Seleziona un file con estensione .glb.', true);
    return;
  }
  if (file.size > 150 * 1024 * 1024) {
    showToast('Il file supera il limite demo di 150 MB.', true);
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    const gltfJson = readGlbJson(buffer);
    const meshEntries = [];
    const nodes = gltfJson.nodes || [];
    nodes.forEach((node, nodeIndex) => {
      if (Number.isInteger(node.mesh) && gltfJson.meshes?.[node.mesh]) {
        const mesh = gltfJson.meshes[node.mesh];
        meshEntries.push({ id: `node-${nodeIndex}`, name: node.name || mesh.name || `Mesh ${nodeIndex + 1}` });
      }
    });
    if (!meshEntries.length) {
      (gltfJson.meshes || []).forEach((mesh, index) => meshEntries.push({ id: `mesh-${index}`, name: mesh.name || `Mesh ${index + 1}` }));
    }
    if (!meshEntries.length || !(gltfJson.accessors || []).length) {
      throw new Error('Nel GLB non sono state trovate mesh con geometria.');
    }
    state.meshMap = {};
    state.optionMap = {};
    state.defaultsApplied = false;
    state.testPassed = false;
    state.glbFileName = file.name;
    state.glbBlob = file;
    state.glbLoaded = true;
    state.meshes = meshEntries;
    state.materials = (gltfJson.materials || []).map((material, index) => material.name || `Materiale ${index + 1}`);
    markDraftChanged({ invalidateDefault: true, resetTestEvidence: true });
    currentHighlightedMesh = null;
    render();
    const displayed = await loadModelIntoViewer(buffer);
    if (!displayed) {
      state.glbLoaded = false;
      render();
      showToast('Mesh lette, ma il modello non può essere visualizzato. La pubblicazione resta bloccata.', true);
      return;
    }
    showToast(`${file.name}: ${meshEntries.length} mesh identificate.`);
  } catch (error) {
    state.glbFileName = file.name;
    state.glbBlob = null;
    state.glbLoaded = false;
    state.meshes = [];
    state.materials = [];
    markDraftChanged({ invalidateDefault: true, resetTestEvidence: true });
    render();
    showToast(error.message || 'Impossibile leggere il file GLB.', true);
  }
}

async function loadModelIntoViewer(buffer) {
  try {
    await ensureThree();
    const parsed = await new Promise((resolve, reject) => {
      gltfLoader.parse(buffer, '', result => resolve(result), error => reject(error));
    });
    if (modelRoot && scene) scene.remove(modelRoot);
    modelRoot = parsed.scene;
    threeMaterials = new Map();
    modelRoot.traverse(object => {
      const association = parsed.parser?.associations.get(object);
      if (Number.isInteger(association?.nodes)) object.userData.sourceMeshId = `node-${association.nodes}`;
      else if (object.parent?.userData.sourceMeshId?.startsWith('node-')) object.userData.sourceMeshId = object.parent.userData.sourceMeshId;
      else if (Number.isInteger(association?.meshes)) object.userData.sourceMeshId = `mesh-${association.meshes}`;
      if (object.isMesh) {
        object.userData.partName = object.name;
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(material => {
            if (material.name) threeMaterials.set(material.name, material);
            if (material.name && !state.materials.includes(material.name)) state.materials.push(material.name);
          });
        }
      }
    });
    scene.add(modelRoot);
    fitCamera(modelRoot);
    viewerUnavailable = false;
    render();
    return true;
  } catch (error) {
    const placeholder = document.getElementById('viewerPlaceholder');
    if (placeholder) placeholder.innerHTML = `<span><strong>Mesh lette · viewer non disponibile</strong>${escapeHtml(error.message || 'Controlla che Three.js sia installato nel progetto.')}</span>`;
    return false;
  }
}

async function ensureThree() {
  if (three && renderer) return;
  if (!viewerPromise) {
    viewerPromise = (async () => {
      try {
        const [THREE, loaderModule, controlsModule] = await Promise.all([
          import('three'),
          import('three/addons/loaders/GLTFLoader.js'),
          import('three/addons/controls/OrbitControls.js')
        ]);
        three = THREE;
        gltfLoader = new loaderModule.GLTFLoader();
        const stage = document.getElementById('viewerStage');
        if (!stage) throw new Error('Area del visualizzatore non disponibile.');
        scene = new THREE.Scene();
        scene.background = new THREE.Color('#f5f7f3');
        camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
        camera.position.set(4.2, 3.1, 5.4);
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;
        renderer.shadowMap.enabled = true;
        stage.prepend(renderer.domElement);
        controls = new controlsModule.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.target.set(0, 1, 0);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x89958a, 2));
        const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
        keyLight.position.set(4, 7, 5);
        keyLight.castShadow = true;
        scene.add(keyLight);
        scene.add(new THREE.AmbientLight(0xffffff, .45));
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#eef1eb', roughness: 1 }));
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -.025;
        floor.receiveShadow = true;
        scene.add(floor);
        createDemoChair();
        canvasResizeObserver = new ResizeObserver(resizeViewer);
        canvasResizeObserver.observe(stage);
        animate();
      } catch (error) {
        throw new Error(`Viewer 3D non disponibile. Verifica l'installazione di Three.js: ${error.message}`);
      }
    })();
  }
  try {
    await viewerPromise;
  } catch (error) {
    viewerPromise = null;
    throw error;
  }
}

function createDemoChair() {
  if (!three || !scene || modelRoot) return;
  const group = new three.Group();
  group.name = 'Modello dimostrativo';
  const addBox = (name, x, y, z, sx, sy, sz, color, materialCode = '') => {
    const material = new three.MeshStandardMaterial({ color, roughness: .65, metalness: color === '#303835' ? .3 : .04 });
    const mesh = new three.Mesh(new three.BoxGeometry(sx, sy, sz), material);
    mesh.name = name;
    mesh.userData.partName = name;
    mesh.userData.materialCode = materialCode;
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  addBox('CUSCINO', 0, 1.23, 0, 1.25, .22, 1.2, '#c6b79a', 'MAT_CUSCINO_BEIGE');
  addBox('SEDUTA', 0, 1.08, 0, 1.3, .08, 1.24, '#303835', 'MAT_STR_NERO_OPACO');
  addBox('SCHIENALE', 0, 2, -.52, 1.28, 1.18, .12, '#c6b79a', 'MAT_CUSCINO_BEIGE');
  addBox('TELAIO', -.57, 1.76, -.48, .09, 1.72, .1, '#303835', 'MAT_STR_NERO_OPACO');
  addBox('TELAIO', .57, 1.76, -.48, .09, 1.72, .1, '#303835', 'MAT_STR_NERO_OPACO');
  addBox('PIEDINI', -.5, .48, -.48, .075, 1, .075, '#303835', 'MAT_STR_NERO_OPACO');
  addBox('PIEDINI', .5, .48, -.48, .075, 1, .075, '#303835', 'MAT_STR_NERO_OPACO');
  addBox('PIEDINI', -.5, .48, .5, .075, 1, .075, '#303835', 'MAT_STR_NERO_OPACO');
  addBox('PIEDINI', .5, .48, .5, .075, 1, .075, '#303835', 'MAT_STR_NERO_OPACO');
  modelRoot = group;
  scene.add(modelRoot);
  threeMaterials = new Map();
  fitCamera(modelRoot);
}

function animate() {
  if (!renderer || !scene || !camera) return;
  requestAnimationFrame(animate);
  if (controls) controls.update();
  renderer.render(scene, camera);
}

function resizeViewer() {
  const stage = document.getElementById('viewerStage');
  if (!stage || !renderer || !camera) return;
  const width = Math.max(1, stage.clientWidth);
  const height = Math.max(1, stage.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function fitCamera(object) {
  if (!three || !object || !camera || !controls) return;
  const box = new three.Box3().setFromObject(object);
  const size = box.getSize(new three.Vector3());
  const center = box.getCenter(new three.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z, 1);
  camera.position.set(center.x + maxSize * 1.5, center.y + maxSize * .95, center.z + maxSize * 1.8);
  camera.near = Math.max(.01, maxSize / 100);
  camera.far = maxSize * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

function highlightMesh(meshId) {
  currentHighlightedMesh = meshId;
  const selected = state.meshes.find(mesh => mesh.id === meshId);
  if (modelRoot && selected) {
    modelRoot.traverse(object => {
      if (!object.isMesh) return;
      const active = object.userData.sourceMeshId === meshId || object.name === selected.name;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => {
        if (!material.userData.originalEmissive) {
          material.userData.originalEmissive = material.emissive?.clone();
        }
        if (material.emissive) material.emissive.set(active ? '#5c986e' : '#000000');
        if (material.emissive && !active && material.userData.originalEmissive) material.emissive.copy(material.userData.originalEmissive);
      });
    });
  }
  render();
}

function applyMaterialToModel(attributeCode, optionCode) {
  const mapping = state.optionMap[getOptionMapKey(attributeCode, optionCode)];
  const option = getOption(attributeCode, optionCode);
  if (!mapping?.material || !option || !modelRoot || !three) return;
  const match = mapping.material.match(/^GLB:(.+)$/);
  const sourceMaterial = match ? threeMaterials.get(match[1]) : null;
  const color = match ? colorFromName(match[1]) : MATERIAL_CATALOG.find(material => material.code === mapping.material)?.color || option.color;
  const mappedMeshes = state.meshes.filter(mesh => state.meshMap[mesh.id]?.type === 'variable' && state.meshMap[mesh.id]?.attribute === attributeCode);
  const meshIds = new Set(mappedMeshes.map(mesh => mesh.id));
  const meshNames = new Set(mappedMeshes.map(mesh => mesh.name));
  modelRoot.traverse(object => {
    if (!object.isMesh || (!meshIds.has(object.userData.sourceMeshId) && !meshNames.has(object.name))) return;
    if (sourceMaterial) {
      object.material = sourceMaterial.clone();
      return;
    }
    const oldMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const nextMaterials = oldMaterials.map(oldMaterial => {
      const material = oldMaterial.clone();
      material.color.set(color);
      return material;
    });
    object.material = Array.isArray(object.material) ? nextMaterials : nextMaterials[0];
  });
}

function applyProductDefaults() {
  const product = selectedProduct();
  if (!product) return;
  product.attributes.forEach(attribute => applyMaterialToModel(attribute.code, attribute.default));
  markDraftChanged();
  state.defaultsApplied = true;
  state.testEvidence.defaultsRestored = product.attributes.every(attribute => Boolean(state.testEvidence.alternatives[attribute.code]));
  render();
  showToast('Default sorgente applicati al viewer.');
}

function updateTestSelection(attributeCode, optionCode) {
  applyMaterialToModel(attributeCode, optionCode);
  markDraftChanged({ invalidateDefault: true });
  const attribute = selectedProduct()?.attributes.find(item => item.code === attributeCode);
  if (attribute && optionCode !== attribute.default) state.testEvidence.alternatives[attributeCode] = optionCode;
  state.testEvidence.defaultsRestored = false;
}

function confirmTest() {
  if (!state.defaultsApplied) {
    showToast('Applica prima i default sorgente.', true);
    return;
  }
  const product = selectedProduct();
  const untested = product?.attributes.filter(attribute => !state.testEvidence.alternatives[attribute.code]) || [];
  if (untested.length) {
    showToast(`Prova un’opzione alternativa per: ${untested.map(attribute => attribute.label).join(', ')}.`, true);
    return;
  }
  if (!state.testEvidence.defaultsRestored) {
    showToast('Dopo aver provato le alternative, ripristina i default sorgente.', true);
    return;
  }
  if (!state.testChecks.alternatives || !state.testChecks.compatibility) {
    showToast('Conferma entrambi i controlli manuali per registrare il test.', true);
    return;
  }
  markDraftChanged();
  state.testPassed = true;
  render();
  showToast('Esito del test registrato. Verifica manuale in ambiente demo.');
}

function validateConfiguration() {
  const product = selectedProduct();
  if (!product) return [{ level: 'blocking', title: 'Prodotto sorgente', detail: 'Seleziona un prodotto MIO/Pigreco valido nella prima fase.' }];
  const checks = [];
  checks.push(state.glbLoaded && state.meshes.length
    ? { level: 'success', title: 'GLB leggibile e con geometria', detail: `${state.glbFileName} · ${state.meshes.length} mesh identificate.` }
    : { level: 'blocking', title: 'GLB leggibile e con geometria', detail: 'Carica un file GLB valido con almeno una mesh.' });
  if (!state.meshes.length) {
    checks.push({ level: 'blocking', title: 'Classificazione delle mesh', detail: 'Carica il modello e classifica tutte le mesh come fisse o variabili.' });
  } else {
    const unclassified = state.meshes.filter(mesh => !state.meshMap[mesh.id]?.type);
    const missingAttributes = state.meshes.filter(mesh => state.meshMap[mesh.id]?.type === 'variable' && !state.meshMap[mesh.id]?.attribute);
    checks.push(unclassified.length
      ? { level: 'notice', title: 'Classificazione delle mesh', detail: `${unclassified.length} mesh non sono ancora classificate; verifica che non siano parti variabili.` }
      : { level: 'success', title: 'Classificazione delle mesh', detail: 'Tutte le mesh sono classificate come fisse o variabili.' });
    checks.push(missingAttributes.length
      ? { level: 'blocking', title: 'Mappatura mesh → attributo', detail: `${missingAttributes.map(mesh => mesh.name).join(', ')}: associa un attributo sorgente valido.` }
      : { level: 'success', title: 'Mappatura mesh → attributo', detail: 'Ogni mesh variabile è collegata a un attributo configurabile.' });
  }
  const activeAttributes = new Set(state.meshes.filter(mesh => state.meshMap[mesh.id]?.type === 'variable').map(mesh => state.meshMap[mesh.id]?.attribute).filter(Boolean));
  const unmappedOptions = [];
  for (const attributeCode of activeAttributes) {
    const attribute = product.attributes.find(item => item.code === attributeCode);
    if (!attribute) {
      unmappedOptions.push(`${attributeCode}: attributo non valido`);
      continue;
    }
    for (const option of attribute.options) {
      if (!state.optionMap[getOptionMapKey(attribute.code, option.code)]?.material) unmappedOptions.push(`${option.code}: materiale mancante`);
    }
  }
  checks.push(unmappedOptions.length
    ? { level: 'blocking', title: 'Materiali per le opzioni', detail: `${unmappedOptions.length} associazioni mancanti: ${unmappedOptions.slice(0, 3).join('; ')}${unmappedOptions.length > 3 ? '…' : ''}` }
    : activeAttributes.size
      ? { level: 'success', title: 'Materiali per le opzioni', detail: 'Tutte le opzioni degli attributi collegati hanno un materiale.' }
      : { level: 'blocking', title: 'Materiali per le opzioni', detail: 'Collega almeno una mesh variabile a un attributo e associa i materiali.' });
  const invalidDefaults = product.attributes.filter(attribute => !attribute.options.some(option => option.code === attribute.default));
  const missingDefaultMaterials = product.attributes.filter(attribute => activeAttributes.has(attribute.code) && !state.optionMap[getOptionMapKey(attribute.code, attribute.default)]?.material);
  checks.push(invalidDefaults.length || missingDefaultMaterials.length
    ? { level: 'blocking', title: 'Default sorgente rappresentabili', detail: 'Il default di un attributo non è valido o non ha il materiale associato.' }
    : state.defaultsApplied
      ? { level: 'success', title: 'Default sorgente rappresentabili', detail: 'Default presenti tra le opzioni valide e applicati al viewer.' }
      : { level: 'blocking', title: 'Default sorgente rappresentabili', detail: 'Applica i default sorgente e verifica il rendering nella fase precedente.' });
  checks.push(state.testPassed
    ? { level: 'success', title: 'Test funzionale registrato', detail: 'Conferma manuale registrata; il backend non è collegato in questa demo.' }
    : { level: 'blocking', title: 'Test funzionale registrato', detail: 'Completa i controlli e conferma l’esito nella fase “Default e test”.' });
  const missingPreviews = [...activeAttributes].flatMap(code => {
    const attribute = product.attributes.find(item => item.code === code);
    return attribute ? attribute.options.filter(option => !state.optionMap[getOptionMapKey(code, option.code)]?.previewName) : [];
  });
  checks.push(missingPreviews.length
    ? { level: 'notice', title: 'Anteprime JPG', detail: `${missingPreviews.length} opzioni senza anteprima. Facoltative nel prototipo; obbligatorietà da confermare.` }
    : { level: 'success', title: 'Anteprime JPG', detail: 'Le opzioni rilevanti hanno un’anteprima associata.' });
  return checks;
}

async function saveDraft() {
  try {
    if (!selectedProduct()) {
      showToast('Seleziona un prodotto prima di salvare la bozza.', true);
      return;
    }
    const id = state.id || crypto.randomUUID();
    const saved = { ...state, id };
    delete saved.search;
    await databaseRequest('readwrite', store => store.put(saved));
    state.id = id;
    state.dirty = false;
    localStorage.setItem('miolight-active-draft', id);
    render();
    showToast('Bozza salvata in questo browser.');
  } catch (error) {
    showToast(error.message || 'Impossibile salvare la bozza.', true);
  }
}

async function restoreDraft() {
  try {
    const id = localStorage.getItem('miolight-active-draft');
    if (!id) return;
    const saved = await databaseRequest('readonly', store => store.get(id));
    if (!saved) return;
    state = { ...freshState(), ...saved, search: '', dirty: false };
    state.testEvidence ||= { alternatives: {}, defaultsRestored: false };
    render();
  } catch (error) {
    showToast(error.message || 'Impossibile ripristinare la bozza salvata.', true);
  }
}

async function publishConfiguration() {
  const blocking = validateConfiguration().filter(check => check.level === 'blocking');
  if (blocking.length) {
    showToast('Risolvi tutti gli errori bloccanti prima di pubblicare.', true);
    return;
  }
  state.publishedAt = new Date().toISOString();
  state.version = (state.version || 0) + 1;
  state.dirty = false;
  await saveDraft();
  showToast('Versione demo pubblicata localmente.');
}

function showToast(message, error = false) {
  const region = document.getElementById('toastRegion');
  const toast = document.createElement('div');
  toast.className = `toast${error ? ' error' : ''}`;
  toast.textContent = message;
  region.append(toast);
  window.clearTimeout(currentToastTimer);
  currentToastTimer = window.setTimeout(() => toast.remove(), 3800);
}

document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'noop') return;
  if (action === 'go-step') setCurrentStep(Number(target.dataset.step));
  if (action === 'select-product') selectProduct(target.dataset.product);
  if (action === 'save') saveDraft();
  if (action === 'apply-defaults') applyProductDefaults();
  if (action === 'confirm-test') confirmTest();
  if (action === 'publish') publishConfiguration();
  if (action === 'highlight-mesh') highlightMesh(target.dataset.mesh);
});

document.addEventListener('change', event => {
  const target = event.target;
  const action = target.dataset.action;
  if (target.id === 'glbInput' && target.files?.[0]) handleGlbUpload(target.files[0]);
  if (action === 'mesh-type') {
    const meshId = target.dataset.mesh;
    state.meshMap[meshId] = { ...state.meshMap[meshId], type: target.value, attribute: target.value === 'variable' ? state.meshMap[meshId]?.attribute || '' : '' };
    setDirty();
  }
  if (action === 'mesh-attribute') {
    const meshId = target.dataset.mesh;
    state.meshMap[meshId] = { ...state.meshMap[meshId], attribute: target.value };
    setDirty();
  }
  if (action === 'option-material') {
    const key = getOptionMapKey(target.dataset.attribute, target.dataset.option);
    state.optionMap[key] = { ...state.optionMap[key], material: target.value };
    markDraftChanged({ invalidateDefault: true, resetTestEvidence: true });
    render();
  }
  if (action === 'option-preview' && target.files?.[0]) {
    const file = target.files[0];
    if (!['image/jpeg', 'image/jpg'].includes(file.type) && !/\.jpe?g$/i.test(file.name)) {
      showToast('Carica un’immagine JPG o JPEG.', true);
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast('L’anteprima JPG deve essere inferiore a 2 MB.', true);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => showToast('Impossibile leggere il file JPG.', true);
    reader.onload = () => {
      const key = getOptionMapKey(target.dataset.attribute, target.dataset.option);
      state.optionMap[key] = { ...state.optionMap[key], previewName: file.name, previewUrl: reader.result };
      markDraftChanged();
      render();
    };
    reader.readAsDataURL(file);
  }
  if (action === 'test-option') updateTestSelection(target.dataset.attribute, target.value);
  if (action === 'test-check') {
    state.testChecks[target.dataset.check] = target.checked;
    markDraftChanged();
    render();
  }
});

document.addEventListener('input', event => {
  const target = event.target;
  if (target.id === 'productSearch') {
    state.search = target.value;
    const query = state.search.toLowerCase();
    document.querySelectorAll('.product-card').forEach(card => {
      card.hidden = !card.textContent.toLowerCase().includes(query);
    });
    const list = document.querySelector('.product-list');
    const empty = list?.querySelector('.empty-note');
    const visible = [...(list?.querySelectorAll('.product-card') || [])].some(card => !card.hidden);
    if (empty) empty.remove();
    if (!visible && list) list.insertAdjacentHTML('beforeend', '<div class="empty-note">Nessun prodotto corrisponde alla ricerca.</div>');
    if (visible && list?.querySelectorAll('.empty-note').length > 1) list.querySelector('.empty-note').remove();
  }
});

document.addEventListener('dragover', event => {
  if (event.target.closest('.upload-zone')) event.preventDefault();
});

document.addEventListener('drop', event => {
  if (!event.target.closest('.upload-zone')) return;
  event.preventDefault();
  if (event.dataTransfer?.files?.[0]) handleGlbUpload(event.dataTransfer.files[0]);
});

document.getElementById('saveDraftButton').addEventListener('click', saveDraft);

window.addEventListener('resize', resizeViewer);

render();
restoreDraft();
