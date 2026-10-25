const EDITOR_TABS = [
  { id: 'details', label: 'Prodotto e GLB' },
  { id: 'attributes', label: 'Attributi' },
  { id: 'meshes', label: 'Mesh' },
  { id: 'actions', label: 'Azioni' },
  { id: 'conditions', label: 'Condizioni' },
  { id: 'review', label: 'Controlli e pubblicazione' }
];
const WORKSPACE_KEY = 'workspace';
const MAX_GLB_SIZE = 150 * 1024 * 1024;

function createId() {
  return crypto.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function freshWorkspace() {
  return {
    id: WORKSPACE_KEY,
    view: 'products',
    editorTab: 'details',
    activeProductId: null,
    attributes: [],
    products: [],
    lastSavedAt: null
  };
}

let workspace = freshWorkspace();
let pendingSave = Promise.resolve();
let currentToastTimer = null;
const workPanel = document.getElementById('workPanel');
const contextPanel = document.getElementById('contextPanel');

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Questo browser non supporta il salvataggio locale dei dati.'));
      return;
    }
    const request = indexedDB.open('miolight-configurator', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('drafts')) {
        request.result.createObjectStore('drafts', { keyPath: 'id' });
      }
      if (!request.result.objectStoreNames.contains('workspace')) {
        request.result.createObjectStore('workspace', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Impossibile aprire l’archivio locale.'));
  });
}

const databasePromise = openDatabase();

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '_');
}

function saveWorkspace() {
  setStorageStatus('Salvataggio in corso…', false);
  pendingSave = pendingSave.catch(() => {}).then(() => {
    workspace.lastSavedAt = new Date().toISOString();
    return databasePromise.then(db => new Promise((resolve, reject) => {
      const transaction = db.transaction('workspace', 'readwrite');
      const request = transaction.objectStore('workspace').put(workspace);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Impossibile salvare la bozza locale.'));
      transaction.onabort = () => reject(transaction.error || new Error('Il salvataggio locale è stato interrotto.'));
    }));
  }).then(() => {
    setStorageStatus('Bozza salvata in questo browser', true);
  }).catch(error => {
    setStorageStatus('Errore di salvataggio', false);
    showToast(error.message || 'Impossibile salvare i dati locali.', true);
    throw error;
  });
  return pendingSave;
}

function setStorageStatus(message, saved) {
  const status = document.getElementById('storageStatus');
  if (!status) return;
  status.classList.toggle('saved', saved);
  status.classList.toggle('unsaved', !saved);
  status.innerHTML = `<span class="status-dot"></span> ${escapeHtml(message)}`;
}

async function restoreWorkspace() {
  try {
    const db = await databasePromise;
    const saved = await new Promise((resolve, reject) => {
      const request = db.transaction('workspace', 'readonly').objectStore('workspace').get(WORKSPACE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Impossibile leggere l’archivio locale.'));
    });
    if (saved) workspace = { ...freshWorkspace(), ...saved };
    render();
    setStorageStatus(saved ? 'Bozza locale ripristinata' : 'Archivio locale pronto', true);
  } catch (error) {
    setStorageStatus('Archivio non disponibile', false);
    showToast(error.message || 'Impossibile ripristinare i dati locali.', true);
  }
}

function selectedProduct() {
  return workspace.products.find(product => product.id === workspace.activeProductId) || null;
}

function libraryAttribute(attributeId) {
  return workspace.attributes.find(attribute => attribute.id === attributeId) || null;
}

function libraryOption(attributeId, optionId) {
  return libraryAttribute(attributeId)?.options.find(option => option.id === optionId) || null;
}

function assignments(product) {
  return (product?.attributes || []).map(assignment => ({
    assignment,
    attribute: libraryAttribute(assignment.attributeId)
  })).filter(item => item.attribute);
}

function productMeshMap(product) {
  return new Map((product?.meshes || []).map(mesh => [mesh.id, mesh]));
}

function changeWorkspace() {
  render();
  saveWorkspace().catch(() => {});
}

function changeProduct(product = selectedProduct()) {
  if (product) product.dirty = true;
  changeWorkspace();
}

function render() {
  renderNavigation();
  renderHeading();
  renderCurrentView();
  renderContext();
}

function renderNavigation() {
  document.querySelectorAll('.workspace-link').forEach(button => {
    button.classList.toggle('active', button.dataset.view === workspace.view);
  });
}

function renderHeading() {
  const product = selectedProduct();
  const labels = {
    products: ['Prodotti configurabili', 'Crea un prodotto MIO Light e collega le definizioni riutilizzabili del catalogo.'],
    library: ['Archivio attributi', 'Gestisci una libreria condivisa di attributi e opzioni, indipendente dai singoli prodotti.'],
    editor: [product?.name || 'Nuovo prodotto', product ? `${product.codePrefix || 'Codice non definito'} · Bozza prodotto` : 'Crea un prodotto autonomo in MIO Light.']
  };
  const [title, subtitle] = labels[workspace.view] || labels.products;
  document.getElementById('pageTitle').textContent = title;
  document.getElementById('pageSubtitle').textContent = subtitle;
  document.getElementById('breadcrumbCurrent').textContent = workspace.view === 'library'
    ? 'Archivio attributi'
    : workspace.view === 'editor' ? `${product?.name || 'Nuovo prodotto'} · ${EDITOR_TABS.find(tab => tab.id === workspace.editorTab)?.label || ''}` : 'Prodotti';
}

function renderCurrentView() {
  if (workspace.view === 'library') workPanel.innerHTML = renderLibrary();
  else if (workspace.view === 'editor' && selectedProduct()) workPanel.innerHTML = renderEditor();
  else {
    workspace.view = 'products';
    workPanel.innerHTML = renderProducts();
  }
}

function renderContext() {
  const product = selectedProduct();
  const draftCount = workspace.products.filter(item => item.dirty).length;
  contextPanel.innerHTML = `
    <div class="context-card">
      <div class="context-heading"><strong>Archivio MIO Light</strong><span class="tag">Locale</span></div>
      <div class="context-row"><span>Attributi riutilizzabili</span><strong>${workspace.attributes.length}</strong></div>
      <div class="context-row"><span>Prodotti</span><strong>${workspace.products.length}</strong></div>
      <div class="context-row"><span>Bozze da pubblicare</span><strong>${draftCount}</strong></div>
    </div>
    ${product ? `<div class="context-card">
      <div class="context-heading"><strong>Prodotto aperto</strong><span class="tag ${product.publishedVersions.length ? 'success' : ''}">${product.publishedVersions.length ? `v${product.publishedVersions.length}` : 'Bozza'}</span></div>
      <div class="context-product"><span class="context-product-thumb" aria-hidden="true">◈</span><span class="context-product-copy"><strong>${escapeHtml(product.name || 'Senza nome')}</strong><small>${escapeHtml(product.codePrefix || 'Codice non definito')}</small></span></div>
      <div class="context-divider"></div>
      <div class="context-row"><span>Mesh importate</span><strong>${product.meshes.length}</strong></div>
      <div class="context-row"><span>Attributi assegnati</span><strong>${product.attributes.length}</strong></div>
      <div class="context-row"><span>Stato</span><strong>${product.publishedVersions.length ? (product.dirty ? 'Nuova bozza' : 'Pubblicato') : 'Bozza'}</strong></div>
    </div>` : `<div class="context-card"><div class="context-heading"><strong>Inizia da zero</strong></div><p class="context-note">Crea prima attributi e opzioni riutilizzabili oppure registra direttamente un prodotto. Non servono anagrafiche MIO/Pigreco già presenti.</p></div>`}
    <div class="context-card">
      <div class="context-heading"><strong>Ambiente demo</strong><span class="tag warning">Locale</span></div>
      <div class="activity-line"><span class="activity-mark"></span><span>I dati sono conservati nel browser; API e archivio di produzione non sono collegati.</span></div>
      <div class="activity-line"><span class="activity-mark"></span><span>Le versioni pubblicate restano snapshot separati dalle nuove bozze.</span></div>
    </div>`;
}

function panelHeader(title, description, eyebrow = '') {
  return `<div class="panel-content">
    ${eyebrow ? `<div class="step-eyebrow">${escapeHtml(eyebrow)}</div>` : ''}
    <h2 class="panel-title">${escapeHtml(title)}</h2>
    <p class="panel-description">${escapeHtml(description)}</p>
    <div class="panel-divider"></div>`;
}

function renderProducts() {
  const rows = workspace.products.map(product => `
    <article class="product-card">
      <span class="product-thumb" aria-hidden="true">◈</span>
      <span class="product-copy"><strong>${escapeHtml(product.name || 'Prodotto senza nome')}</strong><small>${escapeHtml(product.codePrefix || 'Codice da definire')} · ${escapeHtml(product.fileName || 'GLB non collegato')}</small></span>
      <span class="tag ${product.publishedVersions.length && !product.dirty ? 'success' : 'warning'}">${product.publishedVersions.length ? (product.dirty ? `Bozza · v${product.publishedVersions.length} pubblicata` : `Pubblicata · v${product.publishedVersions.length}`) : 'Bozza'}</span>
      <button class="button button-secondary" type="button" data-action="open-product" data-product-id="${escapeHtml(product.id)}">Apri</button>
    </article>`).join('');
  return `${panelHeader('Anagrafiche prodotto', 'Crea e gestisci prodotti MIO Light senza dipendere da un catalogo esterno. Ogni prodotto conserva il proprio GLB, le associazioni e la cronologia delle pubblicazioni.', 'AREA PRODOTTI')}
    <div class="toolbar"><label class="search-wrap"><span class="visually-hidden">Cerca prodotto</span><input id="productSearch" class="text-input" type="search" placeholder="Cerca per nome o codice"></label><button class="button button-primary" type="button" data-action="create-product">+ Nuovo prodotto</button></div>
    <div class="info-banner"><span class="info-symbol">i</span><span>Per riusare definizioni su più prodotti, gestisci prima l’<button class="inline-link" type="button" data-action="navigate" data-view="library">archivio attributi</button>.</span></div>
    <div class="product-list" id="productList">${rows || '<div class="empty-state"><strong>Ancora nessun prodotto</strong><span>Crea la prima anagrafica e collega il relativo GLB. L’archivio può partire completamente vuoto.</span><button class="button button-primary" type="button" data-action="create-product">Crea il primo prodotto</button></div>'}</div>
    </div>`;
}

function renderLibrary() {
  const cards = workspace.attributes.slice().sort((a, b) => a.order - b.order).map((attribute, attributeIndex, orderedAttributes) => `
    <article class="library-card" data-attribute-id="${escapeHtml(attribute.id)}">
      <div class="library-card-head">
        <div><strong>${escapeHtml(attribute.name)}</strong><small>${escapeHtml(attribute.description || 'Nessuna descrizione')}</small></div>
        <span class="tag">${attribute.options.length} opzioni</span>
        <div class="option-row-actions"><button class="button button-quiet" type="button" data-action="move-library-attribute" data-attribute-id="${escapeHtml(attribute.id)}" data-direction="-1" aria-label="Sposta ${escapeHtml(attribute.name)} in alto" ${attributeIndex === 0 ? 'disabled' : ''}>↑</button><button class="button button-quiet" type="button" data-action="move-library-attribute" data-attribute-id="${escapeHtml(attribute.id)}" data-direction="1" aria-label="Sposta ${escapeHtml(attribute.name)} in basso" ${attributeIndex === orderedAttributes.length - 1 ? 'disabled' : ''}>↓</button></div>
        <button class="button button-danger" type="button" data-action="remove-library-attribute" data-attribute-id="${escapeHtml(attribute.id)}">Elimina</button>
      </div>
      <div class="library-fields">
        <label>Nome<input class="text-input" value="${escapeHtml(attribute.name)}" data-action="edit-library-attribute" data-attribute-id="${escapeHtml(attribute.id)}" data-field="name"></label>
        <label>Descrizione<input class="text-input" value="${escapeHtml(attribute.description)}" data-action="edit-library-attribute" data-attribute-id="${escapeHtml(attribute.id)}" data-field="description"></label>
        <label>Ordine<input class="text-input" type="number" min="0" value="${Number(attribute.order) || 0}" data-action="edit-library-attribute" data-attribute-id="${escapeHtml(attribute.id)}" data-field="order"></label>
      </div>
      <div class="option-table-head"><strong>Opzioni riutilizzabili</strong><span>Etichetta · codice · segmento</span></div>
      <div class="library-options">${attribute.options.map((option, optionIndex) => `
        <div class="library-option-row">
          <input class="text-input" aria-label="Nome opzione" value="${escapeHtml(option.label)}" data-action="edit-library-option" data-attribute-id="${escapeHtml(attribute.id)}" data-option-id="${escapeHtml(option.id)}" data-field="label">
          <input class="text-input" aria-label="Codice opzione" value="${escapeHtml(option.code)}" data-action="edit-library-option" data-attribute-id="${escapeHtml(attribute.id)}" data-option-id="${escapeHtml(option.id)}" data-field="code">
          <input class="text-input" aria-label="Segmento codice commerciale" value="${escapeHtml(option.segment || '')}" placeholder="Segmento codice" data-action="edit-library-option" data-attribute-id="${escapeHtml(attribute.id)}" data-option-id="${escapeHtml(option.id)}" data-field="segment">
          <div class="option-row-actions"><button class="button button-quiet" type="button" data-action="move-library-option" data-attribute-id="${escapeHtml(attribute.id)}" data-option-id="${escapeHtml(option.id)}" data-direction="-1" aria-label="Sposta ${escapeHtml(option.label)} in alto" ${optionIndex === 0 ? 'disabled' : ''}>↑</button><button class="button button-quiet" type="button" data-action="move-library-option" data-attribute-id="${escapeHtml(attribute.id)}" data-option-id="${escapeHtml(option.id)}" data-direction="1" aria-label="Sposta ${escapeHtml(option.label)} in basso" ${optionIndex === attribute.options.length - 1 ? 'disabled' : ''}>↓</button><button class="button button-quiet" type="button" data-action="remove-library-option" data-attribute-id="${escapeHtml(attribute.id)}" data-option-id="${escapeHtml(option.id)}" aria-label="Elimina opzione ${escapeHtml(option.label)}">Elimina</button></div>
        </div>`).join('') || '<div class="empty-note">Aggiungi almeno un’opzione riutilizzabile.</div>'}</div>
      <button class="button button-secondary" type="button" data-action="add-library-option" data-attribute-id="${escapeHtml(attribute.id)}">+ Aggiungi opzione</button>
    </article>`).join('');
  return `${panelHeader('Archivio attributi e opzioni', 'Le definizioni sono condivise tra prodotti. Le associazioni a mesh, i default e i limiti delle opzioni appartengono invece al singolo prodotto.', 'LIBRERIA CONDIVISA')}
    <div class="info-banner"><span class="info-symbol">i</span><span>Gli identificativi delle definizioni sono stabili. Se un’opzione è già usata da prodotti pubblicati, conferma prima di modificarla o rimuoverla.</span></div>
    <div class="library-toolbar"><label class="search-wrap"><span class="visually-hidden">Cerca definizione</span><input id="attributeSearch" class="text-input" type="search" placeholder="Cerca attributo o opzione"></label><button class="button button-primary" type="button" data-action="add-library-attribute">+ Nuovo attributo</button></div>
    <div class="library-list">${cards || '<div class="empty-state"><strong>L’archivio è vuoto</strong><span>Crea un attributo e le sue opzioni prima di assegnarli ai prodotti.</span><button class="button button-primary" type="button" data-action="add-library-attribute">Crea il primo attributo</button></div>'}</div>
    </div>`;
}

function renderEditor() {
  const product = selectedProduct();
  const tabs = EDITOR_TABS.map((tab, index) => `<button class="editor-tab ${workspace.editorTab === tab.id ? 'active' : ''}" type="button" data-action="editor-tab" data-tab="${tab.id}"><span>${index + 1}</span>${escapeHtml(tab.label)}</button>`).join('');
  return `<div class="editor-topbar">
      <button class="button button-quiet" type="button" data-action="navigate" data-view="products">← Prodotti</button>
      <nav class="editor-tabs" aria-label="Sezioni prodotto">${tabs}</nav>
      <button class="button button-secondary" type="button" data-action="save-workspace">Salva bozza</button>
    </div>
    <div class="editor-content">${renderEditorTab(product)}</div>`;
}

function renderEditorTab(product) {
  const tab = workspace.editorTab;
  if (tab === 'attributes') return renderProductAttributes(product);
  if (tab === 'meshes') return renderProductMeshes(product);
  if (tab === 'actions') return renderProductActions(product);
  if (tab === 'conditions') return renderProductConditions(product);
  if (tab === 'review') return renderProductReview(product);
  return renderProductDetails(product);
}

function renderProductDetails(product) {
  const fileSummary = product.fileName
    ? `${escapeHtml(product.fileName)} · ${product.meshes.length} mesh · ${product.materials.length} materiali`
    : 'Nessun modello GLB collegato';
  const changes = product.glbChanges;
  return `${panelHeader('Anagrafica e modello', 'Registra un prodotto MIO Light, carica il GLB e mantieni il riferimento al file insieme alla sua impronta e versione.', 'PRODOTTO · GLB')}
    <div class="form-grid">
      <label>Nome prodotto<input class="text-input" required value="${escapeHtml(product.name)}" placeholder="Es. Sedia Giuseppina" data-action="edit-product" data-field="name"></label>
      <label>Prefisso codice<input class="text-input" value="${escapeHtml(product.codePrefix)}" placeholder="Es. GIU" data-action="edit-product" data-field="codePrefix"></label>
      <label class="full-width">Codice predefinito generato<output class="generated-code">${escapeHtml(generatedProductCode(product) || 'Definisci opzioni e default')}</output></label>
    </div>
    <div class="section-heading"><div><h3>File GLB</h3><p>Il sistema legge il grafo e presenta le mesh in tabella, senza viewer 3D.</p></div></div>
    <div class="upload-zone">
      <span class="upload-icon" aria-hidden="true">↑</span>
      <div class="upload-copy"><strong>${fileSummary}</strong><p>Formato .glb · massimo 150 MB</p></div>
      <label class="button button-secondary" for="glbInput">${product.fileName ? 'Sostituisci GLB' : 'Seleziona GLB'}</label>
      <input class="file-input-hidden" id="glbInput" type="file" accept=".glb,model/gltf-binary">
    </div>
    ${changes ? `<div class="info-banner ${changes.removed.length ? 'warning' : ''}"><span class="info-symbol">i</span><span>Confronto GLB: ${changes.added.length} mesh nuove, ${changes.removed.length} non più presenti. Rivedi le associazioni prima di ripubblicare.${changes.removed.length ? ` Da rimappare: ${changes.removed.map(escapeHtml).join(', ')}.` : ''}</span></div>` : ''}
    ${product.materials.length ? `<div class="materials-summary"><strong>Materiali letti dal GLB</strong><span>${product.materials.map(material => escapeHtml(material.name)).join(' · ')}</span></div>` : ''}
    <div class="editor-actions"><button class="button button-primary" type="button" data-action="editor-tab" data-tab="attributes">Continua agli attributi →</button></div>
    </div>`;
}

function renderProductAttributes(product) {
  const usedIds = new Set(product.attributes.map(item => item.attributeId));
  const available = workspace.attributes.filter(attribute => !usedIds.has(attribute.id)).sort((a, b) => a.order - b.order);
  const cards = assignments(product).map(({ assignment, attribute }, index) => {
    const allowed = new Set(assignment.optionIds);
    const options = attribute.options.map(option => `<label class="option-check"><input type="checkbox" data-action="toggle-product-option" data-attribute-id="${escapeHtml(attribute.id)}" data-option-id="${escapeHtml(option.id)}" ${allowed.has(option.id) ? 'checked' : ''}><span>${escapeHtml(option.label)}</span><small>${escapeHtml(option.code)}</small></label>`).join('');
    const defaults = attribute.options.filter(option => allowed.has(option.id)).map(option => `<option value="${escapeHtml(option.id)}" ${assignment.defaultOptionId === option.id ? 'selected' : ''}>${escapeHtml(option.label)} · ${escapeHtml(option.code)}</option>`).join('');
    return `<article class="assigned-attribute">
      <div class="assigned-head"><div><strong>${escapeHtml(attribute.name)}</strong><small>${escapeHtml(attribute.description || 'Definizione condivisa')}</small></div><div class="assigned-actions"><button class="button button-quiet" type="button" data-action="move-product-attribute" data-attribute-id="${escapeHtml(attribute.id)}" data-direction="-1" aria-label="Sposta ${escapeHtml(attribute.name)} in alto" ${index === 0 ? 'disabled' : ''}>↑</button><button class="button button-quiet" type="button" data-action="move-product-attribute" data-attribute-id="${escapeHtml(attribute.id)}" data-direction="1" aria-label="Sposta ${escapeHtml(attribute.name)} in basso" ${index === product.attributes.length - 1 ? 'disabled' : ''}>↓</button><button class="button button-danger" type="button" data-action="remove-product-attribute" data-attribute-id="${escapeHtml(attribute.id)}">Rimuovi</button></div></div>
      <div class="option-check-list">${options || '<span class="empty-inline">La libreria non contiene opzioni.</span>'}</div>
      <label class="default-select">Default prodotto<select class="select-input" data-action="set-product-default" data-attribute-id="${escapeHtml(attribute.id)}"><option value="">Seleziona un’opzione…</option>${defaults}</select></label>
    </article>`;
  }).join('');
  return `${panelHeader('Attributi del prodotto', 'Seleziona definizioni condivise, limita le opzioni consentite e stabilisci un default specifico per questa anagrafica.', 'CONFIGURAZIONE PRODOTTO')}
    ${available.length ? `<div class="assign-toolbar"><label>Assegna attributo esistente<select class="select-input" id="attributeToAssign"><option value="">Seleziona dall’archivio…</option>${available.map(attribute => `<option value="${escapeHtml(attribute.id)}">${escapeHtml(attribute.name)}</option>`).join('')}</select></label><button class="button button-secondary" type="button" data-action="assign-attribute">Assegna</button><button class="button button-quiet" type="button" data-action="navigate" data-view="library">+ Crea definizione</button></div>` : `<div class="info-banner warning"><span class="info-symbol">!</span><span>Nessuna definizione disponibile. <button class="inline-link" type="button" data-action="navigate" data-view="library">Crea un attributo nell’archivio</button>, poi torna qui per assegnarlo.</span></div>`}
    <div class="assigned-list">${cards || '<div class="empty-note">Questo prodotto non ha ancora attributi assegnati.</div>'}</div>
    <div class="editor-actions"><button class="button button-primary" type="button" data-action="editor-tab" data-tab="meshes">Continua alle mesh →</button></div>
    </div>`;
}

function renderProductMeshes(product) {
  const settings = product.meshSettings || {};
  const duplicateNames = duplicateMeshNames(product.meshes);
  const rows = product.meshes.map(mesh => {
    const state = settings[mesh.id] || 'verify';
    return `<tr data-mesh-row><td><strong>${escapeHtml(mesh.name)}</strong>${duplicateNames.has(mesh.name) ? '<span class="tag warning">Nome duplicato</span>' : ''}</td><td class="mesh-path">${escapeHtml(mesh.path)}</td><td>${escapeHtml(mesh.materialNames.join(', ') || '—')}</td><td><select class="select-input" aria-label="Stato mesh ${escapeHtml(mesh.name)}" data-action="set-mesh-state" data-mesh-id="${escapeHtml(mesh.id)}">
      <option value="verify" ${state === 'verify' ? 'selected' : ''}>Da verificare</option><option value="fixed" ${state === 'fixed' ? 'selected' : ''}>Fissa</option><option value="configurable" ${state === 'configurable' ? 'selected' : ''}>Configurabile</option>
    </select></td></tr>`;
  }).join('');
  return `${panelHeader('Importazione e tabella mesh', 'Ogni mesh è identificata dal percorso nel grafo GLB, non dal solo nome. Verifica le parti e confronta la tabella dopo ogni sostituzione del file.', 'STRUTTURA DEL MODELLO')}
    ${product.fileName ? `<div class="mesh-toolbar"><label class="search-wrap"><span class="visually-hidden">Cerca mesh</span><input id="meshSearch" class="text-input" type="search" placeholder="Cerca per nome, percorso o materiale"></label><span class="tag">${product.meshes.length} mesh</span></div><div class="mesh-table-wrap"><table class="mesh-table"><thead><tr><th>Nome mesh</th><th>Percorso nel grafo</th><th>Materiale sorgente</th><th>Stato</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Il GLB non contiene mesh.</td></tr>'}</tbody></table></div>` : '<div class="empty-state"><strong>Carica prima un GLB</strong><span>Il file viene analizzato automaticamente e le mesh sono elencate qui.</span><button class="button button-secondary" type="button" data-action="editor-tab" data-tab="details">Vai a prodotto e GLB</button></div>'}
    ${duplicateNames.size ? `<div class="info-banner warning"><span class="info-symbol">!</span><span>Nomi ripetuti: ${[...duplicateNames].map(escapeHtml).join(', ')}. Usa il percorso per distinguere le mesh nelle azioni.</span></div>` : ''}
    ${product.glbChanges?.removed.length ? `<div class="info-banner error"><span class="info-symbol">!</span><span>Mesh non più presenti nel GLB: ${product.glbChanges.removed.map(escapeHtml).join(', ')}. Le azioni che le referenziano devono essere rimappate.</span></div>` : ''}
    ${product.glbChanges?.changed && !product.glbReviewed ? `<div class="info-banner warning"><span class="info-symbol">!</span><span>Il contenuto del GLB è cambiato. Verifica percorsi e associazioni della nuova versione prima di confermarla.</span><button class="button button-secondary" type="button" data-action="review-glb">Conferma verifica</button></div>` : ''}
    <div class="editor-actions"><button class="button button-primary" type="button" data-action="editor-tab" data-tab="actions">Continua alle azioni →</button></div>
    </div>`;
}

function renderProductActions(product) {
  const productAssignments = assignments(product);
  const meshOptions = (selectedId = '') => [
    '<option value="">Seleziona mesh…</option>',
    ...product.meshes.map(mesh => `<option value="${escapeHtml(mesh.id)}" ${mesh.id === selectedId ? 'selected' : ''}>${escapeHtml(mesh.name)} · ${escapeHtml(mesh.path)}</option>`),
    ...missingActionMeshes(product).filter(mesh => mesh.id === selectedId).map(mesh => `<option value="${escapeHtml(mesh.id)}" selected>RIMAPPARE · ${escapeHtml(mesh.name)} · ${escapeHtml(mesh.path)}</option>`)
  ].join('');
  const materialOptions = selectedId => [
    '<option value="">Seleziona materiale…</option>',
    ...product.materials.map(material => `<option value="${escapeHtml(material.id)}" ${material.id === selectedId ? 'selected' : ''}>${escapeHtml(material.name)}</option>`)
  ].join('');
  const groups = productAssignments.map(({ assignment, attribute }) => {
    const options = attribute.options.filter(option => assignment.optionIds.includes(option.id));
    return `<section class="action-attribute"><h3>${escapeHtml(attribute.name)}</h3>
      ${options.map(option => {
        const actions = product.actions[option.id] || [];
        return `<article class="option-actions"><div class="option-actions-head"><strong>${escapeHtml(option.label)}</strong><span class="tag">${escapeHtml(option.code)}</span><button class="button button-secondary" type="button" data-action="add-option-action" data-option-id="${escapeHtml(option.id)}">+ Aggiungi azione</button></div>
          ${actions.map(action => `<div class="action-row">
            <select class="select-input action-type" aria-label="Tipo azione per ${escapeHtml(option.label)}" data-action="edit-option-action" data-option-id="${escapeHtml(option.id)}" data-action-id="${escapeHtml(action.id)}" data-field="type">
              <option value="show" ${action.type === 'show' ? 'selected' : ''}>MOSTRA</option><option value="hide" ${action.type === 'hide' ? 'selected' : ''}>NASCONDI</option><option value="material" ${action.type === 'material' ? 'selected' : ''}>APPLICA MATERIALE</option>
            </select>
            <select class="select-input" aria-label="Mesh destinazione" data-action="edit-option-action" data-option-id="${escapeHtml(option.id)}" data-action-id="${escapeHtml(action.id)}" data-field="meshId">${meshOptions(action.meshId)}</select>
            ${action.type === 'material' ? `<select class="select-input" aria-label="Materiale da applicare" data-action="edit-option-action" data-option-id="${escapeHtml(option.id)}" data-action-id="${escapeHtml(action.id)}" data-field="materialId">${materialOptions(action.materialId)}</select>` : '<span class="action-placeholder">—</span>'}
            <button class="button button-quiet" type="button" data-action="remove-option-action" data-option-id="${escapeHtml(option.id)}" data-action-id="${escapeHtml(action.id)}" aria-label="Rimuovi azione">✕</button>
          </div>`).join('') || '<p class="empty-inline">Nessuna azione definita per questa opzione.</p>'}
        </article>`;
      }).join('')}
    </section>`;
  }).join('');
  return `${panelHeader('Azioni per opzione', 'Associa a ogni opzione una o più azioni dichiarative MOSTRA, NASCONDI o APPLICA MATERIALE, ciascuna riferita al percorso di una mesh.', 'REGOLE DEL MODELLO')}
    <div class="info-banner"><span class="info-symbol">i</span><span>Le definizioni globali non contengono riferimenti al GLB. Le azioni sono salvate qui, nel contesto del prodotto.</span></div>
    ${product.materials.length ? '' : '<div class="info-banner warning"><span class="info-symbol">!</span><span>Il GLB non dichiara materiali. Le azioni MOSTRA e NASCONDI sono disponibili; APPLICA MATERIALE richiede un GLB con materiali.</span></div>'}
    <div class="action-groups">${groups || '<div class="empty-state"><strong>Nessuna opzione configurabile</strong><span>Assegna attributi e opzioni al prodotto prima di definire le azioni.</span><button class="button button-secondary" type="button" data-action="editor-tab" data-tab="attributes">Vai agli attributi</button></div>'}</div>
    <div class="editor-actions"><button class="button button-primary" type="button" data-action="editor-tab" data-tab="conditions">Continua alle condizioni →</button></div>
    </div>`;
}

function renderProductConditions(product) {
  const available = assignments(product);
  const attributeOptions = (selectedId = '', excluded = '') => [
    '<option value="">Seleziona attributo…</option>',
    ...available.filter(item => item.attribute.id !== excluded || item.attribute.id === selectedId).map(item => `<option value="${escapeHtml(item.attribute.id)}" ${item.attribute.id === selectedId ? 'selected' : ''}>${escapeHtml(item.attribute.name)}</option>`)
  ].join('');
  const conditionRows = product.conditions.map(condition => {
    const sourceAttribute = libraryAttribute(condition.sourceAttributeId);
    const sourceOptions = sourceAttribute?.options.filter(option => product.attributes.find(item => item.attributeId === sourceAttribute.id)?.optionIds.includes(option.id)) || [];
    return `<div class="condition-row">
      <span class="condition-keyword">SE</span>
      <select class="select-input" aria-label="Attributo condizione" data-action="edit-condition" data-condition-id="${escapeHtml(condition.id)}" data-field="sourceAttributeId">${attributeOptions(condition.sourceAttributeId)}</select>
      <select class="select-input" aria-label="Operatore condizione" data-action="edit-condition" data-condition-id="${escapeHtml(condition.id)}" data-field="operator"><option value="equals" ${condition.operator === 'equals' ? 'selected' : ''}>è uguale a</option><option value="not_equals" ${condition.operator === 'not_equals' ? 'selected' : ''}>è diverso da</option></select>
      <select class="select-input" aria-label="Opzione condizione" data-action="edit-condition" data-condition-id="${escapeHtml(condition.id)}" data-field="sourceOptionId"><option value="">Seleziona opzione…</option>${sourceOptions.map(option => `<option value="${escapeHtml(option.id)}" ${option.id === condition.sourceOptionId ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>
      <span class="condition-keyword">ALLORA DISATTIVA</span>
      <select class="select-input" aria-label="Attributo da disattivare" data-action="edit-condition" data-condition-id="${escapeHtml(condition.id)}" data-field="targetAttributeId">${attributeOptions(condition.targetAttributeId, condition.sourceAttributeId)}</select>
      <button class="button button-quiet" type="button" data-action="remove-condition" data-condition-id="${escapeHtml(condition.id)}" aria-label="Rimuovi condizione">✕</button>
    </div>`;
  }).join('');
  const cycle = hasConditionCycle(product);
  return `${panelHeader('Condizioni tra attributi', 'Usa regole guidate SE / ALLORA per rendere inattivo un attributo quando un’opzione viene scelta. I valori inattivi sono esclusi dall’output.', 'DIPENDENZE SEMPLICI')}
    <div class="info-banner"><span class="info-symbol">i</span><span>Operatore della prima versione: uguaglianza o differenza su una singola scelta. I cicli fra attributi sono bloccati in pubblicazione.</span></div>
    <div class="condition-list">${conditionRows || '<div class="empty-note">Nessuna condizione definita.</div>'}</div>
    ${cycle ? '<div class="info-banner error"><span class="info-symbol">!</span><span>Le condizioni formano una dipendenza ciclica. Rimuovi o modifica almeno una regola.</span></div>' : ''}
    <button class="button button-secondary" type="button" data-action="add-condition" ${available.length < 2 ? 'disabled' : ''}>+ Aggiungi condizione</button>
    <div class="editor-actions"><button class="button button-primary" type="button" data-action="editor-tab" data-tab="review">Controlla e pubblica →</button></div>
    </div>`;
}

function renderProductReview(product) {
  const checks = validateProduct(product);
  const blocking = checks.filter(check => check.level === 'blocking');
  const errors = checks.map((check, index) => `<div class="validation-item ${check.level}">
    <span class="validation-icon">${check.level === 'success' ? '✓' : check.level === 'blocking' ? '!' : 'i'}</span>
    <span class="validation-copy"><strong>${escapeHtml(check.title)}</strong><small>${escapeHtml(check.detail)}</small></span>
    ${check.tab ? `<button class="button button-quiet" type="button" data-action="editor-tab" data-tab="${check.tab}" aria-label="Vai a ${escapeHtml(check.title)}">Apri</button>` : `<span class="tag ${check.level === 'success' ? 'success' : check.level === 'blocking' ? 'error' : 'warning'}">${check.level === 'success' ? 'OK' : check.level === 'blocking' ? 'Bloccante' : 'Avviso'}</span>`}
  </div>`).join('');
  const payload = JSON.stringify(buildPublishedPayload(product, product.publishedVersions.length + 1), null, 2);
  const history = product.publishedVersions.slice().reverse().map(version => `<div class="version-row"><span><strong>Versione ${version.version}</strong><small>${new Date(version.publishedAt).toLocaleString('it-IT')} · ${escapeHtml(version.name)}</small></span><span class="tag success">Snapshot</span></div>`).join('');
  return `${panelHeader('Verifica e pubblicazione', 'Risolvi gli errori bloccanti prima del rilascio. Ogni pubblicazione crea uno snapshot che non viene modificato dalle bozze successive.', 'CONTROLLO VERSIONE')}
    <div class="validation-list">${errors}</div>
    <div class="publish-card">
      <div><strong>${blocking.length ? `${blocking.length} controlli bloccanti` : 'Configurazione pronta per la pubblicazione'}</strong><p>Codice predefinito: ${escapeHtml(generatedProductCode(product) || 'non disponibile')}</p></div>
      <button class="button button-primary" type="button" data-action="publish-product" ${blocking.length || (product.publishedVersions.length && !product.dirty) ? 'disabled' : ''}>${product.publishedVersions.length && !product.dirty ? `Versione ${product.publishedVersions.length} già pubblicata` : `Pubblica versione ${product.publishedVersions.length + 1} →`}</button>
    </div>
    <div class="section-heading"><div><h3>Snapshot pubblicati</h3><p>La bozza corrente resta separata dalle versioni rilasciate.</p></div></div>
    <div class="version-list">${history || '<div class="empty-note">Nessuna versione pubblicata.</div>'}</div>
    <details class="payload-details"><summary>Anteprima payload dichiarativo per il frontend</summary><pre>${escapeHtml(payload)}</pre></details>
    <div class="editor-actions"><button class="button button-secondary" type="button" data-action="export-payload">Esporta JSON</button><button class="button button-quiet" type="button" data-action="save-workspace">Salva bozza incompleta</button></div>
    </div>`;
}

function duplicateMeshNames(meshes) {
  const counts = new Map();
  meshes.forEach(mesh => counts.set(mesh.name, (counts.get(mesh.name) || 0) + 1));
  return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
}

function missingActionMeshes(product) {
  const known = new Map((product.meshHistory || []).map(mesh => [mesh.id, mesh]));
  const currentIds = new Set(product.meshes.map(mesh => mesh.id));
  return [...known.values()].filter(mesh => !currentIds.has(mesh.id));
}

function optionAssignmentsFor(product, optionId) {
  return assignments(product).filter(({ assignment }) => assignment.optionIds.includes(optionId));
}

function hasConditionCycle(product) {
  const graph = new Map();
  product.conditions.forEach(condition => {
    if (!condition.sourceAttributeId || !condition.targetAttributeId) return;
    const targets = graph.get(condition.sourceAttributeId) || [];
    targets.push(condition.targetAttributeId);
    graph.set(condition.sourceAttributeId, targets);
  });
  const visiting = new Set();
  const visited = new Set();
  function visit(node) {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    if ((graph.get(node) || []).some(visit)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  }
  return [...graph.keys()].some(visit);
}

function inactiveForSelection(product, targetAttributeId, selection) {
  return product.conditions.some(condition => {
    if (condition.targetAttributeId !== targetAttributeId) return false;
    const selected = selection[condition.sourceAttributeId];
    if (!selected) return false;
    return condition.operator === 'not_equals'
      ? selected !== condition.sourceOptionId
      : selected === condition.sourceOptionId;
  });
}

function defaultSelection(product) {
  return Object.fromEntries(product.attributes.map(assignment => [assignment.attributeId, assignment.defaultOptionId]));
}

function generatedProductCode(product) {
  const selection = defaultSelection(product);
  const segments = [String(product.codePrefix || '').trim()];
  assignments(product).forEach(({ assignment }) => {
    if (inactiveForSelection(product, assignment.attributeId, selection)) return;
    const option = libraryOption(assignment.attributeId, assignment.defaultOptionId);
    if (option?.segment) segments.push(option.segment);
    else if (option?.code) segments.push(option.code);
  });
  return segments.filter(Boolean).join('-');
}

function buildPublishedPayload(product, version) {
  const selection = defaultSelection(product);
  const attributes = assignments(product).map(({ assignment, attribute }) => ({
    id: attribute.id,
    name: attribute.name,
    options: attribute.options.filter(option => assignment.optionIds.includes(option.id)).map(option => ({
      id: option.id,
      code: option.code,
      label: option.label
    }))
  }));
  const defaults = Object.fromEntries(assignments(product)
    .filter(({ assignment }) => !inactiveForSelection(product, assignment.attributeId, selection))
    .map(({ assignment }) => [assignment.attributeId, assignment.defaultOptionId]));
  const actions = Object.fromEntries(Object.entries(product.actions)
    .filter(([optionId]) => optionAssignmentsFor(product, optionId).length)
    .map(([optionId, rows]) => [optionId, rows]));
  return {
    product: { id: product.id, name: product.name, code: generatedProductCode(product), version },
    glb: { fileName: product.fileName, fingerprint: product.fileHash, meshes: product.meshes },
    attributes,
    defaults,
    actions,
    conditions: product.conditions
  };
}

function canOptionsCoexist(product, first, second) {
  if (first.attributeId === second.attributeId) return false;
  return !product.conditions.some(condition => {
    if (condition.targetAttributeId === second.attributeId && condition.sourceAttributeId === first.attributeId) {
      const matches = condition.operator === 'not_equals'
        ? first.optionId !== condition.sourceOptionId
        : first.optionId === condition.sourceOptionId;
      if (matches) return true;
    }
    if (condition.targetAttributeId === first.attributeId && condition.sourceAttributeId === second.attributeId) {
      const matches = condition.operator === 'not_equals'
        ? second.optionId !== condition.sourceOptionId
        : second.optionId === condition.sourceOptionId;
      if (matches) return true;
    }
    return false;
  });
}

function actionConflict(product, first, second) {
  if (first.meshId !== second.meshId) return false;
  if ((first.type === 'show' && second.type === 'hide') || (first.type === 'hide' && second.type === 'show')) return true;
  return first.type === 'material' && second.type === 'material' && first.materialId !== second.materialId;
}

function validateProduct(product) {
  const checks = [];
  const add = (level, title, detail, tab = '') => checks.push({ level, title, detail, tab });
  add(product.name.trim() ? 'success' : 'blocking', 'Nome prodotto', product.name.trim() ? 'Anagrafica prodotto definita.' : 'Inserisci un nome per il prodotto.', 'details');
  add(product.fileName && product.meshes.length ? 'success' : 'blocking', 'GLB e mesh', product.fileName && product.meshes.length ? `${product.fileName} · ${product.meshes.length} mesh importate.` : 'Carica un GLB leggibile con almeno una mesh.', 'details');
  if (product.glbChanges?.changed && !product.glbReviewed) add('blocking', 'Nuova versione GLB da verificare', 'Conferma di aver verificato le mesh e le associazioni dopo la sostituzione del modello.', 'meshes');
  if (product.meshes.length) {
    const unverified = product.meshes.filter(mesh => !product.meshSettings?.[mesh.id] || product.meshSettings[mesh.id] === 'verify');
    const duplicates = duplicateMeshNames(product.meshes);
    add(unverified.length ? 'notice' : 'success', 'Stato delle mesh', unverified.length ? `${unverified.length} mesh da verificare.` : 'Tutte le mesh sono classificate.', 'meshes');
    if (duplicates.size) add('notice', 'Nomi mesh duplicati', `${[...duplicates].join(', ')}: le associazioni usano percorsi univoci.`, 'meshes');
  }
  const productAssignments = assignments(product);
  const invalidAssignments = product.attributes.filter(assignment => !libraryAttribute(assignment.attributeId));
  add(invalidAssignments.length ? 'blocking' : productAssignments.length ? 'success' : 'blocking', 'Attributi assegnati', invalidAssignments.length ? 'Una o più definizioni non esistono più nella libreria.' : productAssignments.length ? `${productAssignments.length} definizioni collegate al prodotto.` : 'Assegna almeno un attributo riutilizzabile.', 'attributes');
  const invalidOptions = productAssignments.filter(({ assignment, attribute }) =>
    !assignment.optionIds.length || assignment.optionIds.some(optionId => !attribute.options.some(option => option.id === optionId)) ||
    !assignment.defaultOptionId || !assignment.optionIds.includes(assignment.defaultOptionId)
  );
  add(invalidOptions.length ? 'blocking' : 'success', 'Opzioni ammesse e default', invalidOptions.length ? 'Ogni attributo assegnato deve avere opzioni valide e un default ammesso.' : 'Opzioni e default del prodotto sono coerenti.', 'attributes');
  const meshIds = new Set(product.meshes.map(mesh => mesh.id));
  const actions = Object.entries(product.actions).flatMap(([optionId, rows]) =>
    optionAssignmentsFor(product, optionId).flatMap(({ assignment }) => rows.map(action => ({ ...action, optionId, attributeId: assignment.attributeId })))
  );
  const broken = actions.filter(action => !meshIds.has(action.meshId));
  add(broken.length ? 'blocking' : 'success', 'Destinazioni delle azioni', broken.length ? `${broken.length} azioni puntano a mesh rimosse o non rimappate.` : 'Tutte le azioni puntano a mesh presenti nel GLB.', 'actions');
  const invalidMaterials = actions.filter(action => action.type === 'material' && !product.materials.some(material => material.id === action.materialId));
  add(invalidMaterials.length ? 'blocking' : 'success', 'Materiali delle azioni', invalidMaterials.length ? `${invalidMaterials.length} azioni APPLICA MATERIALE non hanno un materiale GLB valido.` : 'I materiali selezionati sono presenti nel modello.', 'actions');
  const missingActions = productAssignments.flatMap(({ assignment, attribute }) =>
    attribute.options.filter(option => assignment.optionIds.includes(option.id) && !(product.actions[option.id] || []).length).map(option => `${attribute.name}: ${option.label}`)
  );
  if (missingActions.length) add('notice', 'Opzioni senza azioni 3D', `${missingActions.length} opzioni non modificano mesh. Verifica che sia intenzionale.`, 'actions');
  const conflicts = [];
  for (let i = 0; i < actions.length; i += 1) {
    for (let j = i + 1; j < actions.length; j += 1) {
      if (actions[i].optionId !== actions[j].optionId && !canOptionsCoexist(product, actions[i], actions[j])) continue;
      if (actionConflict(product, actions[i], actions[j])) {
        conflicts.push(`${libraryOption(actions[i].attributeId, actions[i].optionId)?.label || 'Opzione'} / ${libraryOption(actions[j].attributeId, actions[j].optionId)?.label || 'Opzione'}`);
      }
    }
  }
  add(conflicts.length ? 'blocking' : 'success', 'Conflitti fra azioni', conflicts.length ? `Azioni simultanee in conflitto: ${conflicts.slice(0, 3).join('; ')}.` : 'Nessun conflitto rilevato sulle proprietà mesh.', 'actions');
  const invalidConditions = product.conditions.filter(condition =>
    !libraryAttribute(condition.sourceAttributeId) || !libraryAttribute(condition.targetAttributeId) ||
    !libraryOption(condition.sourceAttributeId, condition.sourceOptionId) || condition.sourceAttributeId === condition.targetAttributeId
  );
  add(invalidConditions.length ? 'blocking' : hasConditionCycle(product) ? 'blocking' : 'success', 'Condizioni e dipendenze', invalidConditions.length ? 'Una o più regole fanno riferimento a definizioni rimosse o non valide.' : hasConditionCycle(product) ? 'Le condizioni formano un ciclo tra attributi.' : 'Regole valide e senza dipendenze cicliche.', 'conditions');
  const selection = defaultSelection(product);
  const outputCount = productAssignments.filter(({ assignment }) => !inactiveForSelection(product, assignment.attributeId, selection)).length;
  add(outputCount ? 'success' : 'blocking', 'Default e codice', outputCount ? `Configurazione predefinita valida · ${generatedProductCode(product) || 'codice non definito'}.` : 'Le condizioni disattivano tutti gli attributi predefiniti.', 'attributes');
  add('success', 'Versionamento', product.publishedVersions.length ? `${product.publishedVersions.length} snapshot immutabili già pubblicati.` : 'La prima pubblicazione creerà uno snapshot versionato.');
  return checks;
}

function renderToast(message, error = false) {
  const region = document.getElementById('toastRegion');
  const toast = document.createElement('div');
  toast.className = `toast${error ? ' error' : ''}`;
  toast.textContent = message;
  region.append(toast);
  window.clearTimeout(currentToastTimer);
  currentToastTimer = window.setTimeout(() => toast.remove(), 3800);
}

function showToast(message, error = false) {
  renderToast(message, error);
}

function addLibraryAttribute() {
  let number = workspace.attributes.length + 1;
  while (workspace.attributes.some(attribute => attribute.name === `Attributo ${number}`)) number += 1;
  workspace.attributes.push({
    id: createId(),
    name: `Attributo ${number}`,
    description: '',
    order: workspace.attributes.length,
    options: []
  });
  changeWorkspace();
}

function addLibraryOption(attributeId) {
  const attribute = libraryAttribute(attributeId);
  if (!attribute) return;
  const number = attribute.options.length + 1;
  attribute.options.push({ id: createId(), code: `OPZ_${number}`, label: `Opzione ${number}`, segment: '', order: attribute.options.length });
  markProductsUsingAttribute(attributeId);
  changeWorkspace();
}

function moveLibraryAttribute(attributeId, direction) {
  const attributes = workspace.attributes.slice().sort((a, b) => a.order - b.order);
  const index = attributes.findIndex(attribute => attribute.id === attributeId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= attributes.length) return;
  [attributes[index], attributes[nextIndex]] = [attributes[nextIndex], attributes[index]];
  attributes.forEach((attribute, order) => { attribute.order = order; });
  workspace.attributes = attributes;
  attributes.forEach(attribute => markProductsUsingAttribute(attribute.id));
  changeWorkspace();
}

function moveLibraryOption(attributeId, optionId, direction) {
  const attribute = libraryAttribute(attributeId);
  if (!attribute) return;
  const options = attribute.options.slice().sort((a, b) => a.order - b.order);
  const index = options.findIndex(option => option.id === optionId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= options.length) return;
  [options[index], options[nextIndex]] = [options[nextIndex], options[index]];
  options.forEach((option, order) => { option.order = order; });
  attribute.options = options;
  markProductsUsingAttribute(attributeId);
  changeWorkspace();
}

function moveProductAttribute(attributeId, direction) {
  const product = selectedProduct();
  if (!product) return;
  const index = product.attributes.findIndex(assignment => assignment.attributeId === attributeId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= product.attributes.length) return;
  [product.attributes[index], product.attributes[nextIndex]] = [product.attributes[nextIndex], product.attributes[index]];
  changeProduct(product);
}

function hasPublishedProductUsing(attributeId, optionId = '') {
  return workspace.products.some(product => product.publishedVersions.length && product.attributes.some(assignment =>
    assignment.attributeId === attributeId && (!optionId || assignment.optionIds.includes(optionId))
  ));
}

function markProductsUsingAttribute(attributeId) {
  workspace.products.forEach(product => {
    if (product.attributes.some(assignment => assignment.attributeId === attributeId)) product.dirty = true;
  });
}

function removeLibraryAttribute(attributeId) {
  const attribute = libraryAttribute(attributeId);
  if (!attribute) return;
  if (hasPublishedProductUsing(attributeId) && !window.confirm(`L’attributo “${attribute.name}” è usato da prodotti pubblicati. Rimuoverlo renderà da correggere le relative bozze. Continuare?`)) return;
  markProductsUsingAttribute(attributeId);
  workspace.attributes = workspace.attributes.filter(item => item.id !== attributeId);
  changeWorkspace();
}

function removeLibraryOption(attributeId, optionId) {
  const attribute = libraryAttribute(attributeId);
  const option = libraryOption(attributeId, optionId);
  if (!attribute || !option) return;
  if (hasPublishedProductUsing(attributeId, optionId) && !window.confirm(`L’opzione “${option.label}” è usata da prodotti pubblicati. Rimuoverla?`)) return;
  markProductsUsingAttribute(attributeId);
  attribute.options = attribute.options.filter(item => item.id !== optionId);
  changeWorkspace();
}

function createProduct() {
  const product = {
    id: createId(),
    name: '',
    codePrefix: '',
    fileName: '',
    fileHash: '',
    fileVersion: 0,
    glbBlob: null,
    materials: [],
    meshes: [],
    meshHistory: [],
    meshSettings: {},
    glbChanges: null,
    glbReviewed: true,
    attributes: [],
    actions: {},
    conditions: [],
    publishedVersions: [],
    dirty: true
  };
  workspace.products.unshift(product);
  workspace.activeProductId = product.id;
  workspace.view = 'editor';
  workspace.editorTab = 'details';
  changeWorkspace();
}

function openProduct(productId) {
  if (!workspace.products.some(product => product.id === productId)) return;
  workspace.activeProductId = productId;
  workspace.view = 'editor';
  workspace.editorTab = 'details';
  render();
}

function assignAttribute(product, attributeId) {
  const attribute = libraryAttribute(attributeId);
  if (!attribute || product.attributes.some(item => item.attributeId === attributeId)) return;
  product.attributes.push({
    attributeId,
    optionIds: attribute.options.map(option => option.id),
    defaultOptionId: attribute.options[0]?.id || ''
  });
  changeProduct(product);
}

function updateLibraryField(target) {
  const attribute = libraryAttribute(target.dataset.attributeId);
  if (!attribute) return;
  const optionId = target.dataset.optionId;
  if (hasPublishedProductUsing(attribute.id, optionId || '') &&
    !window.confirm(`Questa definizione è usata da prodotti pubblicati. La modifica non cambierà gli snapshot esistenti, ma richiederà una nuova validazione dei prodotti. Continuare?`)) {
    target.value = target.dataset.field === 'name' ? attribute.name
      : target.dataset.field === 'description' ? attribute.description
        : target.dataset.field === 'order' ? attribute.order
          : libraryOption(attribute.id, optionId)?.[target.dataset.field] || '';
    return;
  }
  if (target.dataset.action === 'edit-library-attribute') {
    const field = target.dataset.field;
    if (field === 'name') {
      const name = target.value.trim();
      if (!name || workspace.attributes.some(item => item !== attribute && item.name.toLowerCase() === name.toLowerCase())) {
        showToast('Il nome dell’attributo deve essere univoco e non vuoto.', true);
        target.value = attribute.name;
        return;
      }
      attribute.name = name;
    } else if (field === 'description') attribute.description = target.value.trim();
    else if (field === 'order') attribute.order = Math.max(0, Number(target.value) || 0);
  } else {
    const option = libraryOption(attribute.id, target.dataset.optionId);
    if (!option) return;
    if (target.dataset.field === 'code') {
      const code = normalizeCode(target.value);
      if (!/^[A-Z0-9_-]{1,40}$/.test(code) || attribute.options.some(item => item !== option && item.code === code)) {
        showToast('Il codice opzione deve essere univoco nell’attributo (lettere, numeri, _ e -).', true);
        target.value = option.code;
        return;
      }
      option.code = code;
    } else if (target.dataset.field === 'label') {
      if (!target.value.trim()) {
        showToast('Inserisci una descrizione per l’opzione.', true);
        target.value = option.label;
        return;
      }
      option.label = target.value.trim();
    } else if (target.dataset.field === 'segment') option.segment = target.value.trim();
  }
  const card = target.closest('.library-card');
  if (card) {
    card.querySelector('.library-card-head strong').textContent = attribute.name;
    card.querySelector('.library-card-head small').textContent = attribute.description || 'Nessuna descrizione';
  }
  markProductsUsingAttribute(attribute.id);
  renderContext();
  saveWorkspace().catch(() => {});
}

function updateProductAttribute(product, target) {
  const assignment = product.attributes.find(item => item.attributeId === target.dataset.attributeId);
  if (!assignment) return;
  if (target.dataset.action === 'toggle-product-option') {
    const optionId = target.dataset.optionId;
    if (target.checked && !assignment.optionIds.includes(optionId)) assignment.optionIds.push(optionId);
    if (!target.checked) {
      assignment.optionIds = assignment.optionIds.filter(id => id !== optionId);
      if (assignment.defaultOptionId === optionId) assignment.defaultOptionId = assignment.optionIds[0] || '';
    }
  } else {
    assignment.defaultOptionId = target.value;
  }
  changeProduct(product);
}

function readGlbJson(buffer) {
  if (buffer.byteLength < 20) throw new Error('Il file è troppo breve per essere un GLB valido.');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('Il file selezionato non è un GLB valido.');
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`Versione GLB ${version} non supportata; è richiesto GLB 2.0.`);
  const declaredLength = view.getUint32(8, true);
  if (declaredLength > buffer.byteLength || declaredLength < 20) throw new Error('Il GLB è incompleto o danneggiato.');
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

function parseGlbMeshes(gltf) {
  const nodes = gltf.nodes || [];
  const meshes = gltf.meshes || [];
  const entries = [];
  const seen = new Set();
  function visit(nodeIndex, parentPath, ancestors) {
    const node = nodes[nodeIndex];
    if (!node || ancestors.has(nodeIndex)) return;
    const nodeName = node.name || meshes[node.mesh]?.name || `Nodo ${nodeIndex + 1}`;
    const path = `${parentPath}/${nodeName}[${nodeIndex}]`;
    if (Number.isInteger(node.mesh) && meshes[node.mesh]) {
      const materialIndexes = new Set((meshes[node.mesh].primitives || []).map(primitive => primitive.material).filter(Number.isInteger));
      entries.push({
        id: `mesh:${path}`,
        name: node.name || meshes[node.mesh].name || `Mesh ${nodeIndex + 1}`,
        path,
        materialNames: [...materialIndexes].map(index => gltf.materials?.[index]?.name || `Materiale ${index + 1}`)
      });
      seen.add(nodeIndex);
    }
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(nodeIndex);
    (node.children || []).forEach(child => visit(child, path, nextAncestors));
  }
  const scenes = gltf.scenes || [];
  scenes.forEach((scene, sceneIndex) => {
    const sceneName = scene.name || `Scena ${sceneIndex + 1}`;
    (scene.nodes || []).forEach(nodeIndex => visit(nodeIndex, `/${sceneName}`, new Set()));
  });
  nodes.forEach((node, index) => {
    if (Number.isInteger(node.mesh) && meshes[node.mesh] && !seen.has(index)) visit(index, '/Nodi non collegati', new Set());
  });
  if (!entries.length && meshes.length) {
    meshes.forEach((mesh, index) => entries.push({
      id: `mesh:asset/${mesh.name || `Mesh ${index + 1}`}[${index}]`,
      name: mesh.name || `Mesh ${index + 1}`,
      path: `/asset/${mesh.name || `Mesh ${index + 1}`}[${index}]`,
      materialNames: [...new Set((mesh.primitives || []).map(primitive => primitive.material).filter(Number.isInteger))]
        .map(materialIndex => gltf.materials?.[materialIndex]?.name || `Materiale ${materialIndex + 1}`)
    }));
  }
  return entries;
}

async function fingerprint(buffer) {
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${buffer.byteLength}-${new DataView(buffer).getUint32(0, true)}`;
}

async function uploadGlb(file) {
  const product = selectedProduct();
  if (!product || !file) return;
  if (!file.name.toLowerCase().endsWith('.glb')) {
    showToast('Seleziona un file con estensione .glb.', true);
    return;
  }
  if (file.size > MAX_GLB_SIZE) {
    showToast('Il file supera il limite demo di 150 MB.', true);
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    const gltf = readGlbJson(buffer);
    const meshes = parseGlbMeshes(gltf);
    if (!meshes.length || !gltf.accessors?.length) throw new Error('Il GLB non contiene mesh con geometria utilizzabile.');
    const previousIds = new Set(product.meshes.map(mesh => mesh.id));
    const currentIds = new Set(meshes.map(mesh => mesh.id));
    const known = new Map([...(product.meshHistory || []), ...product.meshes].map(mesh => [mesh.id, mesh]));
    meshes.forEach(mesh => known.set(mesh.id, mesh));
    const removed = product.meshes.filter(mesh => !currentIds.has(mesh.id)).map(mesh => mesh.name);
    const added = meshes.filter(mesh => !previousIds.has(mesh.id)).map(mesh => mesh.name);
    const materialNames = gltf.materials || [];
    product.materials = materialNames.map((material, index) => ({
      id: `material:${index}`,
      name: material.name || `Materiale ${index + 1}`
    }));
    product.meshHistory = [...known.values()];
    product.meshes = meshes;
    product.meshSettings ||= {};
    meshes.forEach(mesh => {
      if (!product.meshSettings[mesh.id]) product.meshSettings[mesh.id] = 'verify';
    });
    const previousHash = product.fileHash;
    const nextHash = await fingerprint(buffer);
    const changed = Boolean(previousHash && previousHash !== nextHash);
    product.glbChanges = product.fileName ? { added, removed, changed } : null;
    product.glbReviewed = !changed;
    product.fileName = file.name;
    product.fileHash = nextHash;
    product.fileVersion = (product.fileVersion || 0) + 1;
    product.glbBlob = file;
    changeProduct(product);
    showToast(`${meshes.length} mesh identificate. Verifica eventuali associazioni da rimappare.`);
  } catch (error) {
    showToast(error.message || 'Impossibile analizzare il file GLB.', true);
  }
}

function addOptionAction(optionId) {
  const product = selectedProduct();
  if (!product) return;
  product.actions[optionId] ||= [];
  product.actions[optionId].push({ id: createId(), type: 'show', meshId: '', materialId: '' });
  changeProduct(product);
}

function editOptionAction(target) {
  const product = selectedProduct();
  const action = product?.actions[target.dataset.optionId]?.find(item => item.id === target.dataset.actionId);
  if (!action) return;
  action[target.dataset.field] = target.value;
  if (target.dataset.field === 'type' && target.value !== 'material') action.materialId = '';
  changeProduct(product);
}

function removeOptionAction(optionId, actionId) {
  const product = selectedProduct();
  if (!product?.actions[optionId]) return;
  product.actions[optionId] = product.actions[optionId].filter(action => action.id !== actionId);
  if (!product.actions[optionId].length) delete product.actions[optionId];
  changeProduct(product);
}

function addCondition() {
  const product = selectedProduct();
  const available = assignments(product);
  if (!product || available.length < 2) return;
  const source = available[0];
  const target = available[1];
  product.conditions.push({
    id: createId(),
    sourceAttributeId: source.attribute.id,
    operator: 'equals',
    sourceOptionId: source.assignment.optionIds[0] || '',
    targetAttributeId: target.attribute.id
  });
  changeProduct(product);
}

function editCondition(target) {
  const product = selectedProduct();
  const condition = product?.conditions.find(item => item.id === target.dataset.conditionId);
  if (!condition) return;
  condition[target.dataset.field] = target.value;
  if (target.dataset.field === 'sourceAttributeId') {
    const assignment = product.attributes.find(item => item.attributeId === target.value);
    condition.sourceOptionId = assignment?.optionIds[0] || '';
    if (condition.targetAttributeId === target.value) {
      condition.targetAttributeId = product.attributes.find(item => item.attributeId !== target.value)?.attributeId || '';
    }
  } else if (target.dataset.field === 'targetAttributeId' && condition.sourceAttributeId === target.value) {
    showToast('La condizione deve collegare due attributi distinti.', true);
    render();
    return;
  }
  changeProduct(product);
}

function publishProduct() {
  const product = selectedProduct();
  if (!product) return;
  if (product.publishedVersions.length && !product.dirty) {
    showToast('La versione corrente è già pubblicata. Modifica il prodotto per creare una nuova revisione.');
    return;
  }
  const blocking = validateProduct(product).filter(check => check.level === 'blocking');
  if (blocking.length) {
    showToast('Risolvi tutti i controlli bloccanti prima di pubblicare.', true);
    return;
  }
  const versionNumber = product.publishedVersions.length + 1;
  const snapshot = structuredClone({
    id: product.id,
    name: product.name,
    codePrefix: product.codePrefix,
    fileName: product.fileName,
    fileHash: product.fileHash,
    fileVersion: product.fileVersion,
    glbBlob: product.glbBlob,
    materials: product.materials,
    meshes: product.meshes,
    meshSettings: product.meshSettings,
    attributes: product.attributes,
    attributeDefinitions: assignments(product).map(({ assignment, attribute }) => ({
      ...attribute,
      options: attribute.options.filter(option => assignment.optionIds.includes(option.id)),
      defaultOptionId: assignment.defaultOptionId
    })),
    actions: product.actions,
    conditions: product.conditions,
    code: generatedProductCode(product),
    version: versionNumber,
    publishedAt: new Date().toISOString()
  });
  product.publishedVersions.push(snapshot);
  product.dirty = false;
  render();
  saveWorkspace().catch(() => {});
  showToast(`Versione ${versionNumber} pubblicata come snapshot locale.`);
}

function exportPayload() {
  const product = selectedProduct();
  if (!product) return;
  const payload = buildPublishedPayload(product, product.publishedVersions.length + 1);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${normalizeCode(product.name || 'prodotto') || 'prodotto'}-configurazione.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'navigate') {
    workspace.view = target.dataset.view;
    render();
  } else if (action === 'create-product') createProduct();
  else if (action === 'open-product') openProduct(target.dataset.productId);
  else if (action === 'save-workspace') saveWorkspace().then(() => showToast('Bozza salvata in questo browser.')).catch(() => {});
  else if (action === 'add-library-attribute') addLibraryAttribute();
  else if (action === 'add-library-option') addLibraryOption(target.dataset.attributeId);
  else if (action === 'move-library-attribute') moveLibraryAttribute(target.dataset.attributeId, Number(target.dataset.direction));
  else if (action === 'move-library-option') moveLibraryOption(target.dataset.attributeId, target.dataset.optionId, Number(target.dataset.direction));
  else if (action === 'remove-library-attribute') removeLibraryAttribute(target.dataset.attributeId);
  else if (action === 'remove-library-option') removeLibraryOption(target.dataset.attributeId, target.dataset.optionId);
  else if (action === 'editor-tab') {
    if (!EDITOR_TABS.some(tab => tab.id === target.dataset.tab)) return;
    workspace.editorTab = target.dataset.tab;
    render();
  } else if (action === 'assign-attribute') {
    const select = document.getElementById('attributeToAssign');
    if (!select?.value) {
      showToast('Seleziona prima un attributo dalla libreria.', true);
      return;
    }
    assignAttribute(selectedProduct(), select.value);
  } else if (action === 'remove-product-attribute') {
    const product = selectedProduct();
    if (!product) return;
    product.attributes = product.attributes.filter(item => item.attributeId !== target.dataset.attributeId);
    product.conditions = product.conditions.filter(condition => condition.sourceAttributeId !== target.dataset.attributeId && condition.targetAttributeId !== target.dataset.attributeId);
    changeProduct(product);
  } else if (action === 'move-product-attribute') moveProductAttribute(target.dataset.attributeId, Number(target.dataset.direction));
  else if (action === 'add-option-action') addOptionAction(target.dataset.optionId);
  else if (action === 'remove-option-action') removeOptionAction(target.dataset.optionId, target.dataset.actionId);
  else if (action === 'add-condition') addCondition();
  else if (action === 'remove-condition') {
    const product = selectedProduct();
    if (!product) return;
    product.conditions = product.conditions.filter(condition => condition.id !== target.dataset.conditionId);
    changeProduct(product);
  } else if (action === 'publish-product') publishProduct();
  else if (action === 'review-glb') {
    const product = selectedProduct();
    if (!product) return;
    product.glbReviewed = true;
    changeProduct(product);
  }
  else if (action === 'export-payload') exportPayload();
});

document.addEventListener('change', event => {
  const target = event.target;
  if (target.id === 'glbInput' && target.files?.[0]) {
    uploadGlb(target.files[0]);
    target.value = '';
    return;
  }
  if (target.dataset.action === 'edit-library-attribute' || target.dataset.action === 'edit-library-option') updateLibraryField(target);
  else if (target.dataset.action === 'edit-product') {
    const product = selectedProduct();
    if (!product) return;
    product[target.dataset.field] = target.value.trim();
    product.dirty = true;
    target.value = product[target.dataset.field];
    renderHeading();
    renderContext();
    saveWorkspace().catch(() => {});
  } else if (target.dataset.action === 'toggle-product-option' || target.dataset.action === 'set-product-default') updateProductAttribute(selectedProduct(), target);
  else if (target.dataset.action === 'set-mesh-state') {
    const product = selectedProduct();
    if (!product) return;
    product.meshSettings[target.dataset.meshId] = target.value;
    changeProduct(product);
  } else if (target.dataset.action === 'edit-option-action') editOptionAction(target);
  else if (target.dataset.action === 'edit-condition') editCondition(target);
});

document.addEventListener('input', event => {
  const target = event.target;
  if (target.id === 'productSearch') {
    const search = target.value.toLowerCase();
    document.querySelectorAll('#productList .product-card').forEach(card => {
      card.hidden = !card.textContent.toLowerCase().includes(search);
    });
  } else if (target.id === 'attributeSearch') {
    const search = target.value.toLowerCase();
    document.querySelectorAll('.library-list .library-card').forEach(card => {
      card.hidden = !card.textContent.toLowerCase().includes(search);
    });
  } else if (target.id === 'meshSearch') {
    const search = target.value.toLowerCase();
    document.querySelectorAll('[data-mesh-row]').forEach(row => {
      row.hidden = !row.textContent.toLowerCase().includes(search);
    });
  }
});

document.addEventListener('dragover', event => {
  if (event.target.closest('.upload-zone')) event.preventDefault();
});

document.addEventListener('drop', event => {
  if (!event.target.closest('.upload-zone')) return;
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (file) uploadGlb(file);
});

render();
restoreWorkspace();
