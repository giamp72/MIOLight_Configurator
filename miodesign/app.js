import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const configured = !SUPABASE_URL.includes('YOUR-PROJECT');
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const app = document.getElementById('app');
let session = null;
let activeProductPreview = null;
let productPreviewToken = 0;

// ---------- utilità ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, root = app) => root.querySelector(sel);
const $$ = (sel, root = app) => [...root.querySelectorAll(sel)];
const num = (v) => (v === '' || v == null ? null : Number(v));

let toastTimer;
function toast(msg, error = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), error ? 6000 : 2500);
}

function errMsg(e) {
  if (e?.code === '23503') return 'Operazione non consentita: l\'elemento è collegato ad altri dati.';
  if (e?.code === '23505') return 'Esiste già un elemento con gli stessi valori.';
  return e?.message || String(e);
}

async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

// Esegue un'azione mostrando eventuali errori; ritorna true se riuscita.
async function act(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
    return true;
  } catch (e) {
    toast(errMsg(e), true);
    return false;
  }
}

function parseGlbMeshes(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error('Il file selezionato non è un GLB valido.');
  }
  let offset = 12, document;
  while (offset + 8 <= view.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    if (offset + length > view.byteLength) throw new Error('Il file GLB è incompleto.');
    if (type === 0x4e4f534a) {
      document = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset, length)).replace(/\0+$/, '').trim());
      break;
    }
    offset += length;
  }
  if (!document?.nodes) throw new Error('Il GLB non contiene una scena valida.');

  const roots = document.scenes?.[document.scene ?? 0]?.nodes;
  const parents = new Set((document.nodes || []).flatMap((node) => node.children || []));
  const rootsToVisit = roots || document.nodes.map((_, index) => index).filter((index) => !parents.has(index));
  const meshes = [];
  const visit = (nodeIndex, parentPath) => {
    const node = document.nodes[nodeIndex];
    if (!node) return;
    const label = node.name || document.meshes?.[node.mesh]?.name || `Nodo ${nodeIndex + 1}`;
    const path = `${parentPath}/${label}[${nodeIndex}]`;
    if (node.mesh != null) {
      const mesh = document.meshes?.[node.mesh];
      const materialIndex = mesh?.primitives?.find((primitive) => primitive.material != null)?.material;
      meshes.push({
        nome_mesh: node.name || mesh?.name || label,
        percorso_nodo: path,
        indice_mesh: node.mesh,
        materiale_base: document.materials?.[materialIndex]?.name || null,
      });
    }
    (node.children || []).forEach((child) => visit(child, path));
  };
  rootsToVisit.forEach((root) => visit(root, ''));
  if (!meshes.length) throw new Error('Il GLB non contiene mesh da associare.');
  return meshes;
}

async function uploadGlbResource(file, type, folder) {
  if (!file || !file.name.toLowerCase().endsWith('.glb')) throw new Error('Seleziona un file con estensione .glb.');
  const buffer = await file.arrayBuffer();
  const meshes = type === 'Oggetto' ? parseGlbMeshes(buffer) : null;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const impronta = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${folder}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await sb.storage.from('modelli-glb').upload(path, file, {
    contentType: 'model/gltf-binary',
    upsert: false,
  });
  if (uploadError) throw uploadError;
  let resourceId;
  try {
    const resource = await q(sb.from('risorse_glb').insert({
      nome_file: file.name,
      percorso_risorsa: path,
      tipo_risorsa: type,
      impronta_file: impronta,
    }).select('id_glb').single());
    resourceId = resource.id_glb;
    if (meshes?.length) {
      await q(sb.from('mesh_glb').insert(meshes.map((mesh) => ({ ...mesh, id_glb: resource.id_glb }))));
    }
    return { ...resource, meshes, path };
  } catch (error) {
    const cleanupErrors = [];
    if (resourceId) {
      const { error: resourceCleanupError } = await sb.from('risorse_glb').delete().eq('id_glb', resourceId);
      if (resourceCleanupError) cleanupErrors.push(errMsg(resourceCleanupError));
    }
    const { error: storageCleanupError } = await sb.storage.from('modelli-glb').remove([path]);
    if (storageCleanupError) cleanupErrors.push(errMsg(storageCleanupError));
    if (cleanupErrors.length) throw new Error(`${errMsg(error)} (pulizia non riuscita: ${cleanupErrors.join('; ')})`);
    throw error;
  }
}

const go = (hash) => { location.hash = hash; };

const saveBar = (label = 'Salva tutto') => `<div class="save-bar"><span class="muted">Un solo pulsante salva tutte le modifiche della pagina.</span><button class="primary" id="save-all" type="button">${label}</button></div>`;

// Collega il pulsante unico di salvataggio: fn lancia un errore se qualcosa non va, after parte solo a salvataggio riuscito.
function bindSaveAll(fn, after) {
  const button = $('#save-all');
  button.onclick = async () => {
    button.disabled = true;
    const ok = await act(fn, 'Modifiche salvate');
    button.disabled = false;
    if (ok && after) after();
  };
}

// ---------- layout ----------
function shell(content, crumbs = []) {
  const trail = [['Menu', '#/'], ...crumbs]
    .map(([label, href]) => (href ? `<a href="${href}">${esc(label)}</a>` : esc(label)))
    .join(' › ');
  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#/">MIODESIGN<small>MANUTENZIONE DATI</small></a>
      <div class="topbar-right"><span class="muted">${esc(session?.user?.email)}</span>
        <button class="small" id="logout">Esci</button></div>
    </header>
    <main>${crumbs.length ? `<div class="crumbs">${trail}</div>` : ''}${content}</main>`;
  $('#logout').onclick = () => sb.auth.signOut();
}

// ---------- login ----------
function viewLogin() {
  app.innerHTML = `
    <div class="login-wrap"><form class="card login-card" id="login">
      <h1>MIODesign</h1><p class="muted">Accedi per gestire i dati di prodotto.</p>
      ${configured ? '' : '<p class="notice">Configura SUPABASE_URL e SUPABASE_ANON_KEY in <code>config.js</code>.</p>'}
      <div class="field"><label for="email">Email</label><input id="email" type="email" required autocomplete="username"></div>
      <div class="field"><label for="password">Password</label><input id="password" type="password" required autocomplete="current-password"></div>
      <button class="primary" style="width:100%" ${configured ? '' : 'disabled'}>Accedi</button>
    </form></div>`;
  $('#login').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#password').value });
    if (error) toast(error.message === 'Invalid login credentials' ? 'Credenziali non valide.' : error.message, true);
  };
}

// ---------- menu ----------
function viewMenu() {
  shell(`
    <div class="page-head"><div><h1>Menu</h1><span class="muted">Seleziona l'area da gestire.</span></div></div>
    <div class="menu-grid">
      <a class="menu-tile" href="#/prodotti"><strong>Anagrafica prodotti</strong><span class="muted">Consulta, crea, modifica ed elimina i prodotti, con misure e attributi assegnati.</span></a>
      <a class="menu-tile" href="#/attributi"><strong>Anagrafica attributi / opzioni</strong><span class="muted">Gestisci gli attributi (generali e derivati) e le relative opzioni.</span></a>
      <a class="menu-tile" href="#/materiali"><strong>Anagrafica materiali</strong><span class="muted">Definisci i materiali e associa il relativo GLB.</span></a>
    </div>`);
}

// ---------- prodotti: elenco ----------
async function viewProdotti() {
  shell('<div class="empty">Caricamento…</div>', [['Anagrafica prodotti']]);
  const [prodotti, misure] = await Promise.all([
    q(sb.from('prodotti').select('*').order('id_prodotto')),
    q(sb.from('misure').select('id_prodotto')),
  ]);
  const nMisure = {};
  misure.forEach((m) => (nMisure[m.id_prodotto] = (nMisure[m.id_prodotto] || 0) + 1));

  const draw = (filter = '') => {
    const f = filter.toLowerCase();
    const rows = prodotti.filter((p) => !f || `${p.id_prodotto} ${p.nome} ${p.descrizione || ''}`.toLowerCase().includes(f));
    $('#rows').innerHTML = rows.length
      ? rows.map((p) => `<tr>
          <td>${p.id_prodotto}</td><td><a href="#/prodotti/${p.id_prodotto}"><strong>${esc(p.nome)}</strong></a></td>
          <td class="muted">${esc(p.descrizione)}</td><td>${nMisure[p.id_prodotto] || 0}</td>
          <td><span class="badge ${p.attivo ? 'ok' : 'no'}">${p.attivo ? 'Attivo' : 'Non attivo'}</span></td>
          <td class="actions"><a class="btn small" href="#/prodotti/${p.id_prodotto}">Modifica</a>
            <button class="small danger" data-del="${p.id_prodotto}">Elimina</button></td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">Nessun prodotto.</td></tr>';
  };

  shell(`
    <div class="page-head"><div><h1>Anagrafica prodotti</h1><span class="muted">${prodotti.length} prodotti</span></div>
      <div class="row"><input class="search" id="search" placeholder="Cerca…"><a class="btn primary shrink" href="#/prodotti/nuovo">+ Nuovo prodotto</a></div></div>
    <div class="card table-scroll"><table><thead><tr><th>ID</th><th>Nome</th><th>Descrizione</th><th>Misure</th><th>Stato</th><th></th></tr></thead>
    <tbody id="rows"></tbody></table></div>`, [['Anagrafica prodotti']]);
  draw();
  $('#search').oninput = (e) => draw(e.target.value);
  $('#rows').onclick = async (e) => {
    const id = e.target.dataset.del;
    if (!id) return;
    const p = prodotti.find((x) => x.id_prodotto == id);
    if (!confirm(`Eliminare il prodotto "${p.nome}" con misure, attributi e combinazioni collegate?`)) return;
    if (await act(() => q(sb.from('prodotti').delete().eq('id_prodotto', id)), 'Prodotto eliminato')) viewProdotti();
  };
}

// ---------- prodotti: scheda ----------
async function viewProdotto(idParam) {
  const previewToken = ++productPreviewToken;
  activeProductPreview?.dispose();
  activeProductPreview = null;
  const isNew = idParam === 'nuovo';
  const id = isNew ? null : Number(idParam);
  shell('<div class="empty">Caricamento…</div>', [['Anagrafica prodotti', '#/prodotti'], [isNew ? 'Nuovo prodotto' : `Prodotto ${id}`]]);

  let prodotto = { nome: '', descrizione: '', attivo: true };
  let misure = [], assegnati = [], configs = [], tuttiAttributi = [], opzioniPerAttr = [];
  let meshRows = [], meshMappingsById = {}, previewOptionsByAttr = {};
  if (!isNew) {
    const [p, m, pa, cf, attrs] = await Promise.all([
      q(sb.from('prodotti').select('*').eq('id_prodotto', id).maybeSingle()),
      q(sb.from('misure').select('*, risorse_glb(id_glb, nome_file, percorso_risorsa)').eq('id_prodotto', id).order('id_misura')),
      q(sb.from('prodotti_attributi').select('*, attributi(nome, tipo_attributo)').eq('id_prodotto', id).order('ordine')),
      q(sb.from('configurazioni').select('id_attributo, id_opzione').eq('id_prodotto', id)),
      q(sb.from('attributi').select('id_attributo, nome, tipo_attributo, attivo').order('nome')),
    ]);
    if (!p) { toast('Prodotto non trovato', true); return go('#/prodotti'); }
    prodotto = p; misure = m; assegnati = pa; configs = cf; tuttiAttributi = attrs;
    const ids = assegnati.map((a) => a.id_attributo);
    if (ids.length) {
      const ao = await q(sb.from('attributi_opzioni').select('id_attributo, abilitata, opzioni(id_opzione, nome, attiva, ordine, id_materiale, valore_visibilita, materiali(id_materiale, nome, id_glb, risorse_glb(percorso_risorsa)))').in('id_attributo', ids));
      ao.filter((r) => r.abilitata && r.opzioni).forEach((r) => (opzioniPerAttr[r.id_attributo] ||= []).push(r.opzioni));
      Object.values(opzioniPerAttr).forEach((l) => l.sort((a, b) => a.ordine - b.ordine || a.nome.localeCompare(b.nome)));
      previewOptionsByAttr = opzioniPerAttr;
    }
    const glbIds = [...new Set(misure.map((misura) => misura.id_glb).filter(Boolean))];
    if (glbIds.length) {
      const [allMeshes, allMappings] = await Promise.all([
        q(sb.from('mesh_glb').select('id_mesh, id_glb, nome_mesh, percorso_nodo, indice_mesh, materiale_base').in('id_glb', glbIds)),
        q(sb.from('associazioni_mesh').select('id_mesh, id_attributo, ruolo').eq('id_prodotto', id)),
      ]);
      meshRows = allMeshes;
      allMappings.forEach((mapping) => { meshMappingsById[mapping.id_mesh] = mapping.id_attributo; });
    }
  }

  const misuraRow = (m) => `<tr data-misura="${m?.id_misura ?? 'new'}" data-glb="${m?.id_glb ?? ''}">
      <td><input type="number" step="any" data-f="dim_x" value="${esc(m?.dim_x)}" aria-label="Larghezza"></td>
      <td><input type="number" step="any" data-f="dim_y" value="${esc(m?.dim_y)}" aria-label="Altezza"></td>
      <td><input type="number" step="any" data-f="dim_z" value="${esc(m?.dim_z)}" aria-label="Profondità"></td>
      <td><select data-f="unita_misura">${['cm', 'mm'].map((u) => `<option ${((m?.unita_misura) || 'cm') === u ? 'selected' : ''}>${u}</option>`).join('')}</select></td>
      <td><span data-glb-name>${m?.risorse_glb ? `<span class="chip">${esc(m.risorse_glb.nome_file)}</span>` : '<span class="muted">Nessun GLB</span>'}</span>
        <label class="upload-button small">Carica GLB<input type="file" data-f="glb" accept=".glb,model/gltf-binary" aria-label="Carica GLB oggetto"></label><span class="upload-status muted" data-upload-status></span></td>
      <td class="actions">${m ? '<button class="small danger" data-act="clear-glb">Rimuovi GLB</button> <button class="small danger" data-act="del">Elimina</button>' : ''}</td></tr>`;

  const attrBlock = (pa) => {
    const opts = opzioniPerAttr[pa.id_attributo] || [];
    const sel = new Set(configs.filter((c) => c.id_attributo === pa.id_attributo).map((c) => c.id_opzione));
    return `<div class="attr-block" data-attr="${pa.id_attributo}">
      <h3>${esc(pa.attributi.nome)} <span class="badge">${esc(pa.attributi.tipo_attributo)}</span></h3>
      <label>Opzioni ammesse per questo prodotto</label>
      <div class="opt-grid">${opts.length ? opts.map((o) => `<label class="check"><input type="checkbox" data-opt="${o.id_opzione}" ${sel.has(o.id_opzione) ? 'checked' : ''}> ${esc(o.nome)}${o.attiva ? '' : ' <span class="muted">(non attiva)</span>'}</label>`).join('') : '<span class="muted">L\'attributo non ha opzioni.</span>'}</div>
      <div class="row">
        <div><label>Default</label><select data-f="default"><option value="">— nessuno —</option>${opts.filter((o) => sel.has(o.id_opzione)).map((o) => `<option value="${o.id_opzione}" ${pa.id_opzione_default === o.id_opzione ? 'selected' : ''}>${esc(o.nome)}</option>`).join('')}</select></div>
        <div><label>Ordine</label><input type="number" data-f="ordine" value="${pa.ordine}"></div>
        <label class="check shrink"><input type="checkbox" data-f="obbligatorio" ${pa.obbligatorio ? 'checked' : ''}> Obbligatorio</label>
        <div class="shrink"><button class="small danger" type="button" data-act="remove">Rimuovi</button></div>
      </div></div>`;
  };

  const assegnabili = tuttiAttributi.filter((a) => a.attivo && !assegnati.some((x) => x.id_attributo === a.id_attributo));
  const previewMeasures = misure.filter((measure) => measure.id_glb && measure.risorse_glb?.percorso_risorsa);
  const meshesForMeasure = (measureId) => {
    const measure = previewMeasures.find((item) => String(item.id_misura) === String(measureId));
    return measure ? meshRows.filter((mesh) => mesh.id_glb === measure.id_glb)
      .sort((a, b) => a.percorso_nodo.localeCompare(b.percorso_nodo)) : [];
  };
  const mappedAttributeIds = (measureId) => [...new Set(meshesForMeasure(measureId)
    .map((mesh) => meshMappingsById[mesh.id_mesh]).filter(Boolean))];
  const meshMappingSection = () => {
    if (!previewMeasures.length) return '<p class="empty">Associa prima un GLB a una misura.</p>';
    const selectedId = String(previewMeasures[0].id_misura);
    const rows = meshesForMeasure(selectedId);
    return `<label for="mapping-measure">Misura / GLB</label>
      <select id="mapping-measure">${previewMeasures.map((measure) => `<option value="${measure.id_misura}">${esc(measure.dim_x)} × ${esc(measure.dim_y)} × ${esc(measure.dim_z)} ${esc(measure.unita_misura)} · ${esc(measure.risorse_glb.nome_file)}</option>`).join('')}</select>
      <div id="mesh-map-rows">${rows.length ? `<div class="table-scroll"><table><thead><tr><th>Mesh</th><th>Percorso</th><th>Materiale originale</th><th>Attributo</th></tr></thead><tbody>
        ${rows.map((mesh) => `<tr data-mesh-id="${mesh.id_mesh}"><td>${esc(mesh.nome_mesh)}</td><td><code>${esc(mesh.percorso_nodo)}</code></td><td>${esc(mesh.materiale_base || '—')}</td>
          <td><select data-mesh-map><option value="">— non mappata —</option>${assegnati.map((pa) => `<option value="${pa.id_attributo}" ${String(meshMappingsById[mesh.id_mesh] || '') === String(pa.id_attributo) ? 'selected' : ''}>${esc(pa.attributi.nome)} (${esc(pa.attributi.tipo_attributo)})</option>`).join('')}</select></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="empty">Nessuna mesh nel GLB di questa misura.</p>'}</div>`;
  };
  const previewAttributesMarkup = (measureId) => {
    const attributeIds = mappedAttributeIds(measureId);
    if (!attributeIds.length) return '<p class="muted">Nessun attributo mappato su questo GLB.</p>';
    return attributeIds.map((attributeId) => {
      const attribute = assegnati.find((item) => item.id_attributo === attributeId);
      if (!attribute) return '';
      const allowedIds = new Set(configs.filter((config) => config.id_attributo === attributeId).map((config) => config.id_opzione));
      const options = (previewOptionsByAttr[attributeId] || []).filter((option) => allowedIds.has(option.id_opzione));
      return `<div class="field"><label for="preview-attr-${attributeId}">${esc(attribute.attributi.nome)}</label>
        <select id="preview-attr-${attributeId}" data-preview-attribute="${attributeId}">
          <option value="">— seleziona —</option>${options.map((option) => `<option value="${option.id_opzione}" ${String(option.id_opzione) === String(attribute.id_opzione_default || '') ? 'selected' : ''}>${esc(option.nome)}</option>`).join('')}
        </select></div>`;
    }).join('');
  };

  shell(`
    <div class="page-head"><div><h1>${isNew ? 'Nuovo prodotto' : esc(prodotto.nome)}</h1>
      <span class="muted">${isNew ? 'L\'ID progressivo verrà assegnato al salvataggio.' : `ID prodotto ${id}`}</span></div><a class="btn" href="#/prodotti">Chiudi</a></div>
    <form class="card" id="form-prodotto">
      <h2>Dati prodotto</h2>
      <div class="field"><label for="nome">Nome *</label><input id="nome" required maxlength="200" value="${esc(prodotto.nome)}"></div>
      <div class="field"><label for="descrizione">Descrizione</label><textarea id="descrizione">${esc(prodotto.descrizione)}</textarea></div>
      <div class="field"><label class="check"><input type="checkbox" id="attivo" ${prodotto.attivo ? 'checked' : ''}> Attivo nel catalogo</label></div>
    </form>
    ${isNew ? '<p class="muted">Dopo la creazione potrai definire misure e attributi.</p>' : `
    <section class="card"><h2>Misure e GLB (terne larghezza / altezza / profondità)</h2>
      <p class="muted">Ogni terna può avere un GLB indipendente, con mesh e mappatura attributi proprie.</p>
      <div class="table-scroll"><table><thead><tr><th>Larghezza</th><th>Altezza</th><th>Profondità</th><th>Unità</th><th>GLB oggetto</th><th></th></tr></thead>
      <tbody id="misure">${misure.map(misuraRow).join('')}${misuraRow(null)}</tbody></table></div></section>
    <section class="card"><h2>Attributi del prodotto</h2>
      ${assegnati.length ? assegnati.map(attrBlock).join('') : '<p class="muted">Nessun attributo assegnato.</p>'}
      <div class="row"><div><label for="nuovo-attr">Aggiungi attributo</label><select id="nuovo-attr">
        <option value="">— seleziona —</option>${assegnabili.map((a) => `<option value="${a.id_attributo}">${esc(a.nome)} (${esc(a.tipo_attributo)})</option>`).join('')}</select></div>
        </div><p class="muted">L'attributo selezionato viene assegnato al salvataggio.</p></section>
    <section class="card"><h2>Mappatura mesh</h2>
      <p class="muted">Ogni GLB ha la propria mappatura, indipendente dagli altri GLB del prodotto.</p>
      ${meshMappingSection()}</section>
    <section class="card"><h2>Prova configurazione</h2>
      <p class="muted">Seleziona gli attributi e verifica in anteprima il materiale applicato alle mesh del GLB.</p>
      ${previewMeasures.length ? `<div class="product-preview-grid">
        <div><label for="preview-measure">Modello per misura</label>
          <select id="preview-measure">${previewMeasures.map((measure) => `<option value="${measure.id_misura}">${esc(measure.dim_x)} × ${esc(measure.dim_y)} × ${esc(measure.dim_z)} ${esc(measure.unita_misura)}</option>`).join('')}</select>
          <div class="product-preview-stage" id="productPreview"></div>
          <p class="preview-status muted" id="preview-status" role="status">Caricamento del modello…</p>
        </div>
        <div class="preview-attributes"><h3>Attributi del GLB</h3><div id="preview-attributes">${previewAttributesMarkup(previewMeasures[0].id_misura)}</div></div></div>`
      : '<p class="empty">Associa un GLB a una misura per avviare la prova.</p>'}</section>`}
    ${saveBar(isNew ? 'Crea prodotto' : 'Salva tutto')}`,
    [['Anagrafica prodotti', '#/prodotti'], [isNew ? 'Nuovo prodotto' : `Prodotto ${id}`]]);

  const originalMappings = { ...meshMappingsById };
  let createdId = null;

  const saveProduct = async () => {
    const rec = { nome: $('#nome').value.trim(), descrizione: $('#descrizione').value.trim() || null, attivo: $('#attivo').checked };
    if (!rec.nome) throw new Error('Il nome è obbligatorio');
    if (isNew) {
      createdId = (await q(sb.from('prodotti').insert(rec).select('id_prodotto').single())).id_prodotto;
      return;
    }

    const measureOps = $$('#misure tr').flatMap((tr) => {
      const mid = tr.dataset.misura;
      const rec = { dim_x: num($('[data-f=dim_x]', tr).value), dim_y: num($('[data-f=dim_y]', tr).value), dim_z: num($('[data-f=dim_z]', tr).value), unita_misura: $('[data-f=unita_misura]', tr).value, id_glb: num(tr.dataset.glb) };
      const dims = [rec.dim_x, rec.dim_y, rec.dim_z];
      if (mid === 'new' && dims.every((v) => v == null) && !rec.id_glb) return [];
      if (dims.some((v) => v == null || v <= 0)) throw new Error('Inserire tre dimensioni maggiori di zero per ogni misura');
      return [mid === 'new' ? () => q(sb.from('misure').insert({ ...rec, id_prodotto: id })) : () => q(sb.from('misure').update(rec).eq('id_misura', mid))];
    });

    const mappingChanges = [...new Set([...Object.keys(originalMappings), ...Object.keys(meshMappingsById)])]
      .filter((meshId) => (originalMappings[meshId] ?? null) !== (meshMappingsById[meshId] ?? null));
    const mappingRows = mappingChanges.filter((meshId) => meshMappingsById[meshId]).map((meshId) => {
      const attribute = assegnati.find((item) => item.id_attributo === meshMappingsById[meshId]);
      if (!attribute) throw new Error('Un attributo mappato non è più assegnato al prodotto.');
      return { id_prodotto: id, id_mesh: Number(meshId), id_attributo: attribute.id_attributo, ruolo: attribute.attributi.tipo_attributo };
    });

    await q(sb.from('prodotti').update(rec).eq('id_prodotto', id));
    for (const op of measureOps) await op();

    for (const block of $$('.attr-block')) {
      const aid = Number(block.dataset.attr);
      const wanted = $$('[data-opt]:checked', block).map((c) => Number(c.dataset.opt));
      const had = configs.filter((c) => c.id_attributo === aid).map((c) => c.id_opzione);
      const toDel = had.filter((o) => !wanted.includes(o));
      const toAdd = wanted.filter((o) => !had.includes(o));
      if (toDel.length) await q(sb.from('configurazioni').delete().eq('id_prodotto', id).eq('id_attributo', aid).in('id_opzione', toDel));
      if (toAdd.length) await q(sb.from('configurazioni').insert(toAdd.map((o) => ({ id_prodotto: id, id_attributo: aid, id_opzione: o }))));
      await q(sb.from('prodotti_attributi').update({
        id_opzione_default: num($('[data-f=default]', block).value), ordine: num($('[data-f=ordine]', block).value) ?? 0, obbligatorio: $('[data-f=obbligatorio]', block).checked,
      }).eq('id_prodotto', id).eq('id_attributo', aid));
    }

    const newAttribute = num($('#nuovo-attr').value);
    if (newAttribute) {
      const ordine = assegnati.length ? Math.max(...assegnati.map((a) => a.ordine)) + 1 : 0;
      await q(sb.from('prodotti_attributi').insert({ id_prodotto: id, id_attributo: newAttribute, ordine }));
    }

    if (mappingChanges.length) {
      await q(sb.from('associazioni_mesh').delete().eq('id_prodotto', id).in('id_mesh', mappingChanges.map(Number)));
      if (mappingRows.length) await q(sb.from('associazioni_mesh').insert(mappingRows));
    }
  };
  const reload = () => viewProdotto(String(id ?? createdId));
  bindSaveAll(saveProduct, () => (isNew ? go(`#/prodotti/${createdId}`) : reload()));
  $('#form-prodotto').onsubmit = (e) => { e.preventDefault(); $('#save-all').click(); };
  if (isNew) return;

  const uploadMeasureGlb = async (input) => {
    const file = input.files[0];
    if (!file) return;
    const tr = input.closest('tr');
    const status = $('[data-upload-status]', tr);
    input.disabled = true;
    status.textContent = 'Caricamento…';
    try {
      const resource = await uploadGlbResource(file, 'Oggetto', `${id}/oggetti/${tr.dataset.misura}`);
      tr.dataset.glb = resource.id_glb;
      $('[data-glb-name]', tr).innerHTML = `<span class="chip">${esc(file.name)}</span>`;
      status.textContent = 'Caricato: premi Salva tutto per associarlo';
    } catch (error) {
      status.textContent = '';
      toast(errMsg(error), true);
    }
    input.disabled = false;
    input.value = '';
  };

  $('#misure').addEventListener('change', (e) => {
    if (e.target.matches('[data-f=glb]')) uploadMeasureGlb(e.target);
  });

  $('#misure').onclick = async (e) => {
    const action = e.target.dataset.act;
    if (!action) return;
    const tr = e.target.closest('tr');
    const mid = tr.dataset.misura;
    if (action === 'clear-glb') {
      tr.dataset.glb = '';
      $('[data-glb-name]', tr).innerHTML = '<span class="muted">Nessun GLB</span>';
      $('[data-upload-status]', tr).textContent = 'Rimosso: premi Salva tutto per confermare';
      return;
    }
    if (action === 'del') {
      if (!confirm('Eliminare la misura e le combinazioni commerciali collegate?')) return;
      if (await act(() => q(sb.from('misure').delete().eq('id_misura', mid)), 'Misura eliminata')) reload();
    }
  };

  const bindMeshMapping = () => {
    const selector = $('#mapping-measure');
    const container = $('#mesh-map-rows');
    if (!selector || !container) return;
    const draw = () => {
      const rows = meshesForMeasure(selector.value);
      container.innerHTML = rows.length ? `<div class="table-scroll"><table><thead><tr><th>Mesh</th><th>Percorso</th><th>Materiale originale</th><th>Attributo</th></tr></thead><tbody>
        ${rows.map((mesh) => `<tr data-mesh-id="${mesh.id_mesh}"><td>${esc(mesh.nome_mesh)}</td><td><code>${esc(mesh.percorso_nodo)}</code></td><td>${esc(mesh.materiale_base || '—')}</td>
          <td><select data-mesh-map><option value="">— non mappata —</option>${assegnati.map((pa) => `<option value="${pa.id_attributo}" ${String(meshMappingsById[mesh.id_mesh] || '') === String(pa.id_attributo) ? 'selected' : ''}>${esc(pa.attributi.nome)} (${esc(pa.attributi.tipo_attributo)})</option>`).join('')}</select></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="empty">Nessuna mesh nel GLB di questa misura.</p>';
    };
    container.addEventListener('change', (e) => {
      if (!e.target.matches('[data-mesh-map]')) return;
      const meshId = e.target.closest('[data-mesh-id]').dataset.meshId;
      const attributeId = num(e.target.value);
      if (attributeId) meshMappingsById[meshId] = attributeId;
      else delete meshMappingsById[meshId];
    });
    selector.onchange = draw;
    draw();
  };
  bindMeshMapping();

  $$('.attr-block').forEach((block) => {
    const aid = Number(block.dataset.attr);
    // il default può essere scelto solo fra le opzioni spuntate
    block.addEventListener('change', (e) => {
      if (!e.target.dataset.opt) return;
      const def = $('[data-f=default]', block);
      const current = def.value;
      const checked = $$('[data-opt]:checked', block).map((c) => c.dataset.opt);
      def.innerHTML = '<option value="">— nessuno —</option>' + checked.map((v) => `<option value="${v}">${esc(e.target.closest('.opt-grid').querySelector(`[data-opt="${v}"]`).parentElement.textContent.trim())}</option>`).join('');
      def.value = checked.includes(current) ? current : '';
    });
    block.onclick = async (e) => {
      if (e.target.dataset.act !== 'remove') return;
      if (!confirm('Rimuovere l\'attributo dal prodotto (e le relative opzioni ammesse)?')) return;
      if (await act(() => q(sb.from('prodotti_attributi').delete().eq('id_prodotto', id).eq('id_attributo', aid)), 'Attributo rimosso')) reload();
    };
  });

  if (previewMeasures.length) {
    const stage = $('#productPreview');
    const status = $('#preview-status');
    const measureSelect = $('#preview-measure');
    const signedUrls = new Map();
    let previewViewer = null;
    const signedUrlFor = async (path) => {
      const cached = signedUrls.get(path);
      if (cached && cached.expiresAt > Date.now()) return cached.url;
      try {
        const { data, error } = await sb.storage.from('modelli-glb').createSignedUrl(path, 300);
        if (error) throw error;
        signedUrls.set(path, { url: data.signedUrl, expiresAt: Date.now() + 4 * 60 * 1000 });
        return data.signedUrl;
      } catch (error) {
        signedUrls.delete(path);
        throw error;
      }
    };
    const optionFor = (attributeId) => {
      const optionId = $(`[data-preview-attribute="${attributeId}"]`).value;
      return (previewOptionsByAttr[attributeId] || []).find((option) => String(option.id_opzione) === optionId);
    };
    let applyRevision = 0;
    const applyPreview = async () => {
      if (!previewViewer || previewToken !== productPreviewToken) return;
      const revision = ++applyRevision;
      const messages = [];
      const entries = [];
      const measureId = measureSelect.value;
      for (const mesh of meshesForMeasure(measureId)) {
        const attributeId = meshMappingsById[mesh.id_mesh];
        if (!attributeId) continue;
        const option = optionFor(attributeId);
        if (!option) continue;
        const attribute = assegnati.find((item) => item.id_attributo === attributeId);
        if (attribute?.attributi.tipo_attributo === 'Materiale') {
          if (!option.materiali?.id_glb || !option.materiali.risorse_glb?.percorso_risorsa) {
            messages.push(`${attribute.attributi.nome}: ${option.nome} non ha un GLB materiale associato.`);
            entries.push({ path: mesh.percorso_nodo });
            continue;
          }
          const url = await signedUrlFor(option.materiali.risorse_glb.percorso_risorsa);
          const material = await previewViewer.loadMaterial(option.id_materiale, url);
          entries.push({ path: mesh.percorso_nodo, material });
        } else if (option.valore_visibilita !== null) {
          entries.push({ path: mesh.percorso_nodo, visible: option.valore_visibilita });
        }
      }
      if (revision !== applyRevision || previewToken !== productPreviewToken) return;
      previewViewer.applyConfiguration(entries);
      status.textContent = messages.length ? messages.join(' ') : 'Anteprima aggiornata.';
      status.classList.toggle('error-text', messages.length > 0);
    };
    const loadSelectedMeasure = async () => {
      const selectedMeasure = previewMeasures.find((measure) => String(measure.id_misura) === measureSelect.value);
      if (!selectedMeasure) return;
      applyRevision += 1;
      measureSelect.disabled = true;
      status.textContent = 'Caricamento del modello…';
      status.classList.remove('error-text');
      try {
        const url = await signedUrlFor(selectedMeasure.risorse_glb.percorso_risorsa);
        if (previewToken !== productPreviewToken) return;
        const { createProductPreview } = await import('./product-preview.js');
        if (!previewViewer) {
          previewViewer = createProductPreview(stage);
          activeProductPreview = previewViewer;
        }
        await previewViewer.loadProduct(url);
        if (previewToken !== productPreviewToken) return;
        $('#preview-attributes').innerHTML = previewAttributesMarkup(selectedMeasure.id_misura);
        bindPreviewAttributes();
        await applyPreview();
      } catch (error) {
        status.textContent = `Impossibile caricare l’anteprima: ${errMsg(error)}`;
        status.classList.add('error-text');
      } finally {
        measureSelect.disabled = false;
      }
    };
    const bindPreviewAttributes = () => {
      $$('[data-preview-attribute]', $('#preview-attributes')).forEach((select) => {
        select.onchange = () => {
        applyPreview().catch((error) => {
          status.textContent = `Impossibile aggiornare l’anteprima: ${errMsg(error)}`;
          status.classList.add('error-text');
        });
        };
      });
    };
    measureSelect.onchange = loadSelectedMeasure;
    bindPreviewAttributes();
    loadSelectedMeasure();
  }
}

// ---------- attributi: elenco ----------
async function viewAttributi() {
  shell('<div class="empty">Caricamento…</div>', [['Anagrafica attributi / opzioni']]);
  const [attributi, ao] = await Promise.all([
    q(sb.from('attributi').select('*').order('nome')),
    q(sb.from('attributi_opzioni').select('id_attributo, abilitata, opzioni(nome, attiva, ordine)')),
  ]);
  const byAttr = {};
  ao.filter((r) => r.abilitata && r.opzioni).forEach((r) => (byAttr[r.id_attributo] ||= []).push(r.opzioni));
  const nome = (id) => attributi.find((a) => a.id_attributo === id)?.nome ?? '';

  const draw = (filter = '') => {
    const f = filter.toLowerCase();
    const rows = attributi.filter((a) => !f || `${a.nome} ${(byAttr[a.id_attributo] || []).map((o) => o.nome).join(' ')}`.toLowerCase().includes(f));
    $('#rows').innerHTML = rows.length ? rows.map((a) => {
      const opts = (byAttr[a.id_attributo] || []).sort((x, y) => x.ordine - y.ordine || x.nome.localeCompare(y.nome));
      return `<tr>
        <td><a href="#/attributi/${a.id_attributo}"><strong>${esc(a.nome)}</strong></a><div class="muted">${esc(a.descrizione)}</div></td>
        <td>${esc(a.tipo_attributo)}</td>
        <td>${a.id_attributo_padre ? `Derivato da <em>${esc(nome(a.id_attributo_padre))}</em>` : 'Generale'}</td>
        <td>${opts.map((o) => `<span class="chip ${o.attiva ? '' : 'off'}">${esc(o.nome)}</span>`).join('') || '<span class="muted">—</span>'}</td>
        <td><span class="badge ${a.attivo ? 'ok' : 'no'}">${a.attivo ? 'Attivo' : 'Non attivo'}</span></td>
        <td class="actions"><a class="btn small" href="#/attributi/${a.id_attributo}">Modifica</a> <button class="small danger" data-del="${a.id_attributo}">Elimina</button></td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty">Nessun attributo.</td></tr>';
  };

  shell(`
    <div class="page-head"><div><h1>Anagrafica attributi / opzioni</h1><span class="muted">${attributi.length} attributi</span></div>
      <div class="row"><input class="search" id="search" placeholder="Cerca…"><a class="btn primary shrink" href="#/attributi/nuovo">+ Nuovo attributo</a></div></div>
    <div class="card table-scroll"><table><thead><tr><th>Attributo</th><th>Tipo</th><th>Origine</th><th>Opzioni</th><th>Stato</th><th></th></tr></thead>
    <tbody id="rows"></tbody></table></div>`, [['Anagrafica attributi / opzioni']]);
  draw();
  $('#search').oninput = (e) => draw(e.target.value);
  $('#rows').onclick = async (e) => {
    const id = e.target.dataset.del;
    if (!id) return;
    if (!confirm(`Eliminare l'attributo "${nome(Number(id))}" e tutte le sue opzioni?`)) return;
    if (await act(() => q(sb.from('attributi').delete().eq('id_attributo', id)), 'Attributo eliminato')) viewAttributi();
  };
}

// ---------- attributi: scheda ----------
async function viewAttributo(idParam) {
  const isNew = idParam === 'nuovo';
  const id = isNew ? null : Number(idParam);
  const crumbs = [['Anagrafica attributi / opzioni', '#/attributi'], [isNew ? 'Nuovo attributo' : `Attributo ${id}`]];
  shell('<div class="empty">Caricamento…</div>', crumbs);

  let attr = { nome: '', descrizione: '', tipo_attributo: 'Materiale', id_attributo_padre: null, attivo: true };
  let opzioni = [], materiali = [], generali = [], padreOpzioni = [], esposte = [];
  const [mat, gen] = await Promise.all([
    q(sb.from('materiali').select('id_materiale, nome').order('nome')),
    q(sb.from('attributi').select('id_attributo, nome, tipo_attributo').is('id_attributo_padre', null).order('nome')),
  ]);
  materiali = mat; generali = gen;
  if (!isNew) {
    const a = await q(sb.from('attributi').select('*').eq('id_attributo', id).maybeSingle());
    if (!a) { toast('Attributo non trovato', true); return go('#/attributi'); }
    attr = a;
    if (attr.id_attributo_padre) {
      [padreOpzioni, esposte] = await Promise.all([
        q(sb.from('opzioni').select('id_opzione, nome, attiva, ordine').eq('id_attributo', attr.id_attributo_padre).order('ordine').order('nome')),
        q(sb.from('attributi_opzioni').select('id_opzione, abilitata').eq('id_attributo', id)),
      ]);
    } else {
      opzioni = await q(sb.from('opzioni').select('*').eq('id_attributo', id).order('ordine').order('nome'));
    }
  }
  const derivato = !!attr.id_attributo_padre;

  const effetto = (o) => attr.tipo_attributo === 'Materiale'
    ? `<select data-f="id_materiale"><option value="">— nessun materiale —</option>${materiali.map((m) => `<option value="${m.id_materiale}" ${o?.id_materiale === m.id_materiale ? 'selected' : ''}>${esc(m.nome)}</option>`).join('')}</select>`
    : `<select data-f="valore_visibilita"><option value="">— non definito —</option><option value="true" ${o?.valore_visibilita === true ? 'selected' : ''}>Mostra</option><option value="false" ${o?.valore_visibilita === false ? 'selected' : ''}>Nascondi</option></select>`;

  const opzioneRow = (o, next = 0) => `<tr data-opz="${o?.id_opzione ?? 'new'}">
      <td><input data-f="nome" maxlength="150" value="${esc(o?.nome)}" placeholder="Nuova opzione" aria-label="Nome"></td>
      <td><input data-f="descrizione" value="${esc(o?.descrizione)}" aria-label="Descrizione"></td>
      <td>${effetto(o)}</td>
      <td style="width:80px"><input type="number" data-f="ordine" value="${o ? o.ordine : next}" aria-label="Ordine"></td>
      <td><input type="checkbox" data-f="attiva" ${!o || o.attiva ? 'checked' : ''} aria-label="Attiva"></td>
      <td class="actions">${o ? '<button class="small danger" type="button" data-act="del">Elimina</button>' : ''}</td></tr>`;

  const abilitate = new Set(esposte.filter((e) => e.abilitata).map((e) => e.id_opzione));
  const nextOrdine = opzioni.length ? Math.max(...opzioni.map((o) => o.ordine)) + 1 : 0;

  const opzioniSection = isNew ? '<p class="muted">Dopo la creazione potrai definire le opzioni.</p>' : derivato ? `
    <section class="card"><h2>Opzioni del derivato</h2>
      <p class="muted">Seleziona le opzioni dell'attributo padre da includere in questo attributo.</p>
      <div class="opt-grid">${padreOpzioni.map((o) => `<label class="check"><input type="checkbox" data-opt="${o.id_opzione}" ${abilitate.has(o.id_opzione) ? 'checked' : ''}> ${esc(o.nome)}${o.attiva ? '' : ' <span class="muted">(non attiva)</span>'}</label>`).join('') || '<span class="muted">L\'attributo padre non ha opzioni.</span>'}</div>
</section>` : `
    <section class="card"><h2>Opzioni</h2>
      <div class="table-scroll"><table><thead><tr><th>Nome</th><th>Descrizione</th><th>${attr.tipo_attributo === 'Materiale' ? 'Materiale' : 'Visibilità'}</th><th>Ordine</th><th>Attiva</th><th></th></tr></thead>
      <tbody id="opzioni">${opzioni.map((o) => opzioneRow(o)).join('')}${opzioneRow(null, nextOrdine)}</tbody></table></div>
      ${attr.tipo_attributo === 'Materiale' ? '<div style="margin-top:.75rem"><a class="btn small" href="#/materiali/nuovo">+ Nuovo materiale</a></div>' : ''}
    </section>`;

  shell(`
    <div class="page-head"><div><h1>${isNew ? 'Nuovo attributo' : esc(attr.nome)}</h1>
      <span class="muted">${derivato ? 'Attributo derivato' : 'Attributo generale'}</span></div><a class="btn" href="#/attributi">Chiudi</a></div>
    <form class="card" id="form-attr">
      <h2>Dati attributo</h2>
      <div class="row">
        <div class="field"><label for="nome">Nome *</label><input id="nome" required maxlength="150" value="${esc(attr.nome)}"></div>
        <div class="field"><label for="tipo">Tipo</label><select id="tipo" ${isNew ? '' : 'disabled'}>
          ${['Materiale', 'Visibilità'].map((t) => `<option ${attr.tipo_attributo === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div class="field"><label for="padre">Deriva da</label><select id="padre" ${isNew ? '' : 'disabled'}>
          <option value="">— nessuno (attributo generale) —</option>
          ${generali.map((g) => `<option value="${g.id_attributo}" data-tipo="${esc(g.tipo_attributo)}" ${attr.id_attributo_padre === g.id_attributo ? 'selected' : ''}>${esc(g.nome)}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label for="descrizione">Descrizione</label><textarea id="descrizione">${esc(attr.descrizione)}</textarea></div>
      <div class="field"><label class="check"><input type="checkbox" id="attivo" ${attr.attivo ? 'checked' : ''}> Attivo</label></div>
    </form>${opzioniSection}${saveBar(isNew ? 'Crea attributo' : 'Salva tutto')}`, crumbs);

  // un derivato ha il tipo del padre
  $('#padre').onchange = () => {
    const t = $('#padre').selectedOptions[0].dataset.tipo;
    if (t) $('#tipo').value = t;
    $('#tipo').disabled = !!t || !isNew;
  };

  let createdId = null;
  const saveAttribute = async () => {
    const rec = { nome: $('#nome').value.trim(), descrizione: $('#descrizione').value.trim() || null, attivo: $('#attivo').checked };
    if (!rec.nome) throw new Error('Il nome è obbligatorio');
    if (isNew) {
      rec.tipo_attributo = $('#tipo').value;
      rec.id_attributo_padre = num($('#padre').value);
      createdId = (await q(sb.from('attributi').insert(rec).select('id_attributo').single())).id_attributo;
      return;
    }

    const optionOps = derivato ? [] : $$('#opzioni tr').flatMap((tr) => {
      const oid = tr.dataset.opz;
      const f = (n) => $(`[data-f=${n}]`, tr);
      const opt = { nome: f('nome').value.trim(), descrizione: f('descrizione').value.trim() || null, ordine: num(f('ordine').value) ?? 0, attiva: f('attiva').checked };
      if (oid === 'new' && !opt.nome && !f('descrizione').value.trim()) return [];
      if (!opt.nome) throw new Error('Il nome dell\'opzione è obbligatorio');
      if (attr.tipo_attributo === 'Materiale') opt.id_materiale = num(f('id_materiale').value);
      else opt.valore_visibilita = f('valore_visibilita').value === '' ? null : f('valore_visibilita').value === 'true';
      return [oid === 'new' ? () => q(sb.from('opzioni').insert({ ...opt, id_attributo: id })) : () => q(sb.from('opzioni').update(opt).eq('id_opzione', oid))];
    });

    await q(sb.from('attributi').update(rec).eq('id_attributo', id));
    for (const op of optionOps) await op();

    if (derivato) {
      const wanted = $$('[data-opt]:checked').map((c) => Number(c.dataset.opt));
      const known = new Set(esposte.map((x) => x.id_opzione));
      const toRemove = [...known].filter((o) => !wanted.includes(o));
      const toAdd = wanted.filter((o) => !known.has(o));
      if (toRemove.length) await q(sb.from('attributi_opzioni').delete().eq('id_attributo', id).in('id_opzione', toRemove));
      if (toAdd.length) await q(sb.from('attributi_opzioni').insert(toAdd.map((o) => ({ id_attributo: id, id_opzione: o }))));
    }
  };
  const reload = () => viewAttributo(String(id ?? createdId));
  bindSaveAll(saveAttribute, () => (isNew ? go(`#/attributi/${createdId}`) : reload()));
  $('#form-attr').onsubmit = (e) => { e.preventDefault(); $('#save-all').click(); };
  if (isNew || derivato) return;

  $('#opzioni').onclick = async (e) => {
    if (e.target.dataset.act !== 'del') return;
    const oid = e.target.closest('tr').dataset.opz;
    if (!confirm('Eliminare l\'opzione? Verrà tolta anche da attributi derivati e prodotti che la usano.')) return;
    if (await act(() => q(sb.from('opzioni').delete().eq('id_opzione', oid)), 'Opzione eliminata')) reload();
  };
}

// ---------- materiali ----------
async function viewMateriali(idParam) {
  const focusNew = idParam === 'nuovo';
  shell('<div class="empty">Caricamento…</div>', [['Anagrafica materiali']]);
  const [materiali, risorse] = await Promise.all([
    q(sb.from('materiali').select('*').order('nome')),
    q(sb.from('risorse_glb').select('id_glb, nome_file').eq('tipo_risorsa', 'Materiale').order('nome_file')),
  ]);
  const resourceOptions = (selectedId) => `<option value="">— nessun GLB —</option>${risorse.map((resource) =>
    `<option value="${resource.id_glb}" ${String(resource.id_glb) === String(selectedId || '') ? 'selected' : ''}>${esc(resource.nome_file)}</option>`).join('')}`;
  const materialRow = (material) => `<tr data-material="${material?.id_materiale ?? 'new'}">
    <td><input data-f="nome" maxlength="150" value="${esc(material?.nome)}" placeholder="${material ? 'Nome materiale' : 'Nuovo materiale: nome'}" aria-label="Nome materiale"></td>
    <td><input data-f="descrizione" value="${esc(material?.descrizione)}" placeholder="Descrizione" aria-label="Descrizione"></td>
    <td><input data-f="rif" maxlength="200" value="${esc(material?.rif_materiale_interno)}" placeholder="Riferimento interno" aria-label="Riferimento interno"></td>
    <td><select data-f="glb" aria-label="GLB del materiale">${resourceOptions(material?.id_glb)}</select>
      <label class="upload-button small">Carica GLB<input type="file" data-f="file" accept=".glb,model/gltf-binary" aria-label="Carica GLB materiale"></label>
      <span class="upload-status muted" data-upload-status></span></td>
    <td class="actions">${material ? '<button class="small danger" type="button" data-act="delete">Elimina</button>' : ''}</td></tr>`;

  shell(`
    <div class="page-head"><div><h1>Anagrafica materiali</h1><span class="muted">${materiali.length} materiali · associa un GLB dedicato a ciascun materiale</span></div>
      <button class="btn primary shrink" type="button" id="new-material">+ Nuovo materiale</button></div>
    <section class="card table-scroll"><table><thead><tr><th>Nome</th><th>Descrizione</th><th>Riferimento interno</th><th>GLB</th><th></th></tr></thead>
      <tbody id="materials">${materiali.map(materialRow).join('')}${materialRow(null)}</tbody></table></section>
    <p class="muted">L'ultima riga vuota serve per creare un nuovo materiale. Il file caricato viene archiviato in Supabase Storage; per sostituirlo carica un nuovo GLB, per rimuoverlo scegli “nessun GLB”.</p>
    ${saveBar()}`,
  [['Anagrafica materiali']]);

  const newRow = $('#materials tr[data-material=new]');
  const focusNewRow = () => {
    newRow.scrollIntoView({ block: 'center' });
    $('[data-f=nome]', newRow).focus();
  };
  $('#new-material').onclick = focusNewRow;
  if (focusNew) focusNewRow();

  const uploadMaterialGlb = async (input) => {
    const file = input.files[0];
    if (!file) return;
    const row = input.closest('tr');
    const materialId = row.dataset.material;
    const status = $('[data-upload-status]', row);
    input.disabled = true;
    status.textContent = 'Caricamento…';
    try {
      const uploaded = await uploadGlbResource(file, 'Materiale', `materiali/${materialId === 'new' ? crypto.randomUUID() : materialId}`);
      const select = $('[data-f=glb]', row);
      select.add(new Option(file.name, uploaded.id_glb, true, true));
      status.textContent = 'Caricato: premi Salva tutto per associarlo';
    } catch (error) {
      status.textContent = '';
      toast(errMsg(error), true);
    }
    input.disabled = false;
    input.value = '';
  };
  $('#materials').addEventListener('change', (event) => {
    if (event.target.matches('[data-f=file]')) uploadMaterialGlb(event.target);
  });

  $('#materials').onclick = async (event) => {
    if (event.target.dataset.act !== 'delete') return;
    const materialId = event.target.closest('tr').dataset.material;
    const material = materiali.find((item) => String(item.id_materiale) === materialId);
    if (!confirm(`Eliminare il materiale "${material.nome}"? Le opzioni collegate resteranno senza materiale.`)) return;
    if (await act(() => q(sb.from('materiali').delete().eq('id_materiale', materialId)), 'Materiale eliminato')) viewMateriali();
  };

  const saveMaterials = async () => {
    const ops = $$('#materials tr').flatMap((row) => {
      const materialId = row.dataset.material;
      const rec = {
        nome: $('[data-f=nome]', row).value.trim(),
        descrizione: $('[data-f=descrizione]', row).value.trim() || null,
        rif_materiale_interno: $('[data-f=rif]', row).value.trim() || null,
        id_glb: num($('[data-f=glb]', row).value),
      };
      if (materialId === 'new' && !rec.nome && !rec.descrizione && !rec.rif_materiale_interno && !rec.id_glb) return [];
      if (!rec.nome) throw new Error('Il nome del materiale è obbligatorio.');
      return [materialId === 'new' ? () => q(sb.from('materiali').insert(rec)) : () => q(sb.from('materiali').update(rec).eq('id_materiale', materialId))];
    });
    for (const op of ops) await op();
  };
  bindSaveAll(saveMaterials, () => (location.hash === '#/materiali/nuovo' ? go('#/materiali') : viewMateriali()));
}

// ---------- routing ----------
async function route() {
  if (!session) return viewLogin();
  const [a, b] = location.hash.replace(/^#\/?/, '').split('/');
  try {
    if (!a) return viewMenu();
    if (a === 'prodotti') return b ? await viewProdotto(b) : await viewProdotti();
    if (a === 'attributi') return b ? await viewAttributo(b) : await viewAttributi();
    if (a === 'materiali') return await viewMateriali(b);
    go('#/');
  } catch (e) {
    toast(errMsg(e), true);
  }
}

window.addEventListener('hashchange', () => {
  productPreviewToken += 1;
  activeProductPreview?.dispose();
  activeProductPreview = null;
  route();
});
if (sb) {
  const { data } = await sb.auth.getSession();
  session = data.session;
  sb.auth.onAuthStateChange((event, s) => {
    const changed = (s?.user?.id ?? null) !== (session?.user?.id ?? null);
    session = s;
    if (changed) { if (!s) go('#/'); route(); }
  });
}
route();
