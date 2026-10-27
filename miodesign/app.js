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
  let meshRows = [], meshMapping = {}, meshCompatible = true, previewOptionsByAttr = {}, meshMappingsByPath = {};
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
      const pathsByGlb = glbIds.map((glbId) => allMeshes.filter((mesh) => mesh.id_glb === glbId)
        .map((mesh) => mesh.percorso_nodo).sort());
      meshCompatible = pathsByGlb.every((paths) => JSON.stringify(paths) === JSON.stringify(pathsByGlb[0]));
      const firstGlb = glbIds[0];
      meshRows = allMeshes.filter((mesh) => mesh.id_glb === firstGlb)
        .sort((a, b) => a.percorso_nodo.localeCompare(b.percorso_nodo));
      meshRows.forEach((mesh) => {
        const matchingMeshIds = allMeshes.filter((candidate) => candidate.percorso_nodo === mesh.percorso_nodo)
          .map((candidate) => candidate.id_mesh);
        const mapping = allMappings.find((candidate) => matchingMeshIds.includes(candidate.id_mesh));
        meshMapping[mesh.percorso_nodo] = mapping?.id_attributo || '';
        if (mapping) meshMappingsByPath[mesh.percorso_nodo] = mapping.id_attributo;
      });
    }
  }

  const misuraRow = (m) => `<tr data-misura="${m?.id_misura ?? 'new'}">
      <td><input type="number" step="any" data-f="dim_x" value="${esc(m?.dim_x)}" aria-label="Larghezza"></td>
      <td><input type="number" step="any" data-f="dim_y" value="${esc(m?.dim_y)}" aria-label="Altezza"></td>
      <td><input type="number" step="any" data-f="dim_z" value="${esc(m?.dim_z)}" aria-label="Profondità"></td>
      <td><select data-f="unita_misura">${['cm', 'mm'].map((u) => `<option ${((m?.unita_misura) || 'cm') === u ? 'selected' : ''}>${u}</option>`).join('')}</select></td>
      <td>${m?.risorse_glb ? `<span class="chip">${esc(m.risorse_glb.nome_file)}</span>` : '<span class="muted">Nessun GLB</span>'}
        ${m ? '<input type="file" data-f="glb" accept=".glb,model/gltf-binary" aria-label="File GLB"><button class="small" data-act="upload-glb">Carica GLB</button>' : ''}</td>
      <td class="actions">${m
        ? `${m.id_glb ? '<button class="small danger" data-act="clear-glb">Rimuovi GLB</button> ' : ''}<button class="small" data-act="save">Salva</button> <button class="small danger" data-act="del">Elimina</button>`
        : '<button class="small primary" data-act="add">Aggiungi</button>'}</td></tr>`;

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
        <div class="shrink"><button class="small primary" data-act="save">Salva attributo</button> <button class="small danger" data-act="remove">Rimuovi</button></div>
      </div></div>`;
  };

  const assegnabili = tuttiAttributi.filter((a) => a.attivo && !assegnati.some((x) => x.id_attributo === a.id_attributo));
  const previewMeasures = misure.filter((measure) => measure.id_glb && measure.risorse_glb?.percorso_risorsa);
  const previewAttributeIds = [...new Set(Object.values(meshMappingsByPath))];

  shell(`
    <div class="page-head"><div><h1>${isNew ? 'Nuovo prodotto' : esc(prodotto.nome)}</h1>
      <span class="muted">${isNew ? 'L\'ID progressivo verrà assegnato al salvataggio.' : `ID prodotto ${id}`}</span></div></div>
    <form class="card" id="form-prodotto">
      <h2>Dati prodotto</h2>
      <div class="field"><label for="nome">Nome *</label><input id="nome" required maxlength="200" value="${esc(prodotto.nome)}"></div>
      <div class="field"><label for="descrizione">Descrizione</label><textarea id="descrizione">${esc(prodotto.descrizione)}</textarea></div>
      <div class="field"><label class="check"><input type="checkbox" id="attivo" ${prodotto.attivo ? 'checked' : ''}> Attivo nel catalogo</label></div>
      <button class="primary">${isNew ? 'Crea prodotto' : 'Salva dati'}</button> <a class="btn" href="#/prodotti">${isNew ? 'Annulla' : 'Chiudi'}</a>
    </form>
    ${isNew ? '<p class="muted">Dopo la creazione potrai definire misure e attributi.</p>' : `
    <section class="card"><h2>Misure e GLB (terne larghezza / altezza / profondità)</h2>
      <p class="muted">Ogni terna può avere un GLB dedicato. I GLB dello stesso prodotto devono contenere le stesse mesh.</p>
      <div class="table-scroll"><table><thead><tr><th>Larghezza</th><th>Altezza</th><th>Profondità</th><th>Unità</th><th>GLB oggetto</th><th></th></tr></thead>
      <tbody id="misure">${misure.map(misuraRow).join('')}${misuraRow(null)}</tbody></table></div></section>
    <section class="card"><h2>Attributi del prodotto</h2>
      ${assegnati.length ? assegnati.map(attrBlock).join('') : '<p class="muted">Nessun attributo assegnato.</p>'}
      <div class="row"><div><label for="nuovo-attr">Aggiungi attributo</label><select id="nuovo-attr">
        <option value="">— seleziona —</option>${assegnabili.map((a) => `<option value="${a.id_attributo}">${esc(a.nome)} (${esc(a.tipo_attributo)})</option>`).join('')}</select></div>
        <div class="shrink"><button id="add-attr">Assegna</button></div></div></section>
    <section class="card"><h2>Mappatura mesh</h2>
      <p class="muted">La mappatura è condivisa da tutte le misure e viene replicata sui GLB associati.</p>
      ${!misure.some((misura) => misura.id_glb) ? '<p class="empty">Associa prima un GLB a una misura.</p>' : !meshCompatible
        ? '<p class="notice">I GLB associati non hanno le stesse mesh. Correggi i file prima di salvare la mappatura.</p>'
        : meshRows.length ? `<div class="table-scroll"><table><thead><tr><th>Mesh</th><th>Percorso</th><th>Materiale originale</th><th>Attributo</th></tr></thead><tbody>
          ${meshRows.map((mesh, index) => `<tr><td>${esc(mesh.nome_mesh)}</td><td><code>${esc(mesh.percorso_nodo)}</code></td><td>${esc(mesh.materiale_base || '—')}</td>
            <td><select data-mesh-map="${index}"><option value="">— non mappata —</option>${assegnati.map((pa) => `<option value="${pa.id_attributo}" ${String(meshMapping[mesh.percorso_nodo]) === String(pa.id_attributo) ? 'selected' : ''}>${esc(pa.attributi.nome)} (${esc(pa.attributi.tipo_attributo)})</option>`).join('')}</select></td></tr>`).join('')}
          </tbody></table></div><button class="primary" id="save-mesh-map">Salva mappatura</button>`
        : '<p class="empty">Nessuna mesh disponibile nei GLB associati.</p>'}</section>
    <section class="card"><h2>Prova configurazione</h2>
      <p class="muted">Seleziona gli attributi e verifica in anteprima il materiale applicato alle mesh del GLB.</p>
      ${previewMeasures.length && previewAttributeIds.length ? `<div class="product-preview-grid">
        <div><label for="preview-measure">Modello per misura</label>
          <select id="preview-measure">${previewMeasures.map((measure) => `<option value="${measure.id_misura}">${esc(measure.dim_x)} × ${esc(measure.dim_y)} × ${esc(measure.dim_z)} ${esc(measure.unita_misura)}</option>`).join('')}</select>
          <div class="product-preview-stage" id="productPreview"></div>
          <p class="preview-status muted" id="preview-status" role="status">Caricamento del modello…</p>
        </div>
        <div class="preview-attributes"><h3>Attributi</h3>
          ${previewAttributeIds.map((attributeId) => {
            const attribute = assegnati.find((item) => item.id_attributo === attributeId);
            if (!attribute) return '';
            const allowedIds = new Set(configs.filter((config) => config.id_attributo === attributeId).map((config) => config.id_opzione));
            const options = (previewOptionsByAttr[attributeId] || []).filter((option) => allowedIds.has(option.id_opzione));
            return `<div class="field"><label for="preview-attr-${attributeId}">${esc(attribute.attributi.nome)}</label>
              <select id="preview-attr-${attributeId}" data-preview-attribute="${attributeId}">
                <option value="">— seleziona —</option>${options.map((option) => `<option value="${option.id_opzione}" ${String(option.id_opzione) === String(attribute.id_opzione_default || '') ? 'selected' : ''}>${esc(option.nome)}</option>`).join('')}
              </select></div>`;
          }).join('')}
        </div></div>`
      : '<p class="empty">Associa un GLB a una misura e mappa almeno una mesh a un attributo per avviare la prova.</p>'}</section>`}`,
    [['Anagrafica prodotti', '#/prodotti'], [isNew ? 'Nuovo prodotto' : `Prodotto ${id}`]]);

  $('#form-prodotto').onsubmit = async (e) => {
    e.preventDefault();
    const rec = { nome: $('#nome').value.trim(), descrizione: $('#descrizione').value.trim() || null, attivo: $('#attivo').checked };
    if (!rec.nome) return toast('Il nome è obbligatorio', true);
    if (isNew) {
      try {
        const created = await q(sb.from('prodotti').insert(rec).select('id_prodotto').single());
        toast('Prodotto creato');
        go(`#/prodotti/${created.id_prodotto}`);
      } catch (err) { toast(errMsg(err), true); }
    } else if (await act(() => q(sb.from('prodotti').update(rec).eq('id_prodotto', id)), 'Dati salvati')) {
      $('h1').textContent = rec.nome;
    }
  };
  if (isNew) return;

  const reload = () => viewProdotto(String(id));

  $('#misure').onclick = async (e) => {
    const action = e.target.dataset.act;
    if (!action) return;
    const tr = e.target.closest('tr');
    const mid = tr.dataset.misura;
    if (action === 'upload-glb') {
      const file = $('[data-f=glb]', tr).files[0];
      if (!file) return toast('Seleziona prima il GLB da caricare.', true);
      const otherGlbIds = [...new Set(misure.filter((measure) => String(measure.id_misura) !== mid && measure.id_glb).map((measure) => measure.id_glb))];
      if (otherGlbIds.length) {
        try {
          const existingMeshes = await q(sb.from('mesh_glb').select('id_glb, percorso_nodo').in('id_glb', otherGlbIds));
          const existingPaths = otherGlbIds.map((glbId) => existingMeshes.filter((mesh) => mesh.id_glb === glbId)
            .map((mesh) => mesh.percorso_nodo).sort());
          const reference = JSON.stringify(existingPaths[0]);
          if (existingPaths.some((paths) => JSON.stringify(paths) !== reference)) {
            return toast('I GLB già associati al prodotto non hanno le stesse mesh. Correggili prima di aggiungerne altri.', true);
          }
          const nextPaths = parseGlbMeshes(await file.arrayBuffer()).map((mesh) => mesh.percorso_nodo).sort();
          if (reference !== JSON.stringify(nextPaths)) {
            return toast('Il GLB deve contenere le stesse mesh degli altri modelli associati al prodotto.', true);
          }
        } catch (error) { return toast(errMsg(error), true); }
      }
      if (await act(async () => {
        const uploaded = await uploadGlbResource(file, 'Oggetto', `${id}/oggetti/${mid}`);
        try {
          await q(sb.from('misure').update({ id_glb: uploaded.id_glb }).eq('id_misura', mid));
        } catch (error) {
          const { error: resourceCleanupError } = await sb.from('risorse_glb').delete().eq('id_glb', uploaded.id_glb);
          const { error: storageCleanupError } = await sb.storage.from('modelli-glb').remove([uploaded.path]);
          const cleanupErrors = [resourceCleanupError, storageCleanupError].filter(Boolean).map(errMsg);
          if (cleanupErrors.length) throw new Error(`${errMsg(error)} (pulizia non riuscita: ${cleanupErrors.join('; ')})`);
          throw error;
        }
      }, 'GLB caricato e associato alla misura')) reload();
      return;
    }
    if (action === 'clear-glb') {
      if (!confirm('Rimuovere il GLB associato a questa misura?')) return;
      if (await act(() => q(sb.from('misure').update({ id_glb: null }).eq('id_misura', mid)), 'Associazione GLB rimossa')) reload();
      return;
    }
    if (action === 'del') {
      if (!confirm('Eliminare la misura e le combinazioni commerciali collegate?')) return;
      if (await act(() => q(sb.from('misure').delete().eq('id_misura', mid)), 'Misura eliminata')) reload();
      return;
    }
    const rec = { dim_x: num($('[data-f=dim_x]', tr).value), dim_y: num($('[data-f=dim_y]', tr).value), dim_z: num($('[data-f=dim_z]', tr).value), unita_misura: $('[data-f=unita_misura]', tr).value };
    if ([rec.dim_x, rec.dim_y, rec.dim_z].some((v) => v == null || v <= 0)) return toast('Inserire tre dimensioni maggiori di zero', true);
    const op = action === 'add' ? sb.from('misure').insert({ ...rec, id_prodotto: id }) : sb.from('misure').update(rec).eq('id_misura', mid);
    if (await act(() => q(op), 'Misura salvata')) reload();
  };

  $('#save-mesh-map')?.addEventListener('click', async () => {
    if (await act(async () => {
      const ids = [...new Set(misure.map((measure) => measure.id_glb).filter(Boolean))];
      const targetMeshes = await q(sb.from('mesh_glb').select('id_mesh, id_glb, percorso_nodo').in('id_glb', ids));
      const selected = meshRows.map((mesh, index) => {
        const attributeId = num($(`[data-mesh-map="${index}"]`).value);
        const attribute = assegnati.find((item) => item.id_attributo === attributeId);
        if (!attributeId) return [];
        if (!attribute) throw new Error('Un attributo selezionato non è più assegnato al prodotto.');
        return targetMeshes.filter((target) => target.percorso_nodo === mesh.percorso_nodo)
          .map((target) => ({ id_prodotto: id, id_mesh: target.id_mesh, id_attributo: attributeId, ruolo: attribute.attributi.tipo_attributo }));
      }).flat();
      const meshIds = targetMeshes.map((mesh) => mesh.id_mesh);
      if (meshIds.length) await q(sb.from('associazioni_mesh').delete().eq('id_prodotto', id).in('id_mesh', meshIds));
      if (selected.length) await q(sb.from('associazioni_mesh').insert(selected));
    }, 'Mappatura mesh salvata')) reload();
  });

  $('#add-attr').onclick = async () => {
    const aid = num($('#nuovo-attr').value);
    if (!aid) return toast('Seleziona un attributo', true);
    const ordine = assegnati.length ? Math.max(...assegnati.map((a) => a.ordine)) + 1 : 0;
    if (await act(() => q(sb.from('prodotti_attributi').insert({ id_prodotto: id, id_attributo: aid, ordine })), 'Attributo assegnato')) reload();
  };

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
      const action = e.target.dataset.act;
      if (action === 'remove') {
        if (!confirm('Rimuovere l\'attributo dal prodotto (e le relative opzioni ammesse)?')) return;
        if (await act(() => q(sb.from('prodotti_attributi').delete().eq('id_prodotto', id).eq('id_attributo', aid)), 'Attributo rimosso')) reload();
      }
      if (action === 'save') {
        const wanted = $$('[data-opt]:checked', block).map((c) => Number(c.dataset.opt));
        const had = configs.filter((c) => c.id_attributo === aid).map((c) => c.id_opzione);
        const toDel = had.filter((o) => !wanted.includes(o));
        const toAdd = wanted.filter((o) => !had.includes(o));
        const def = num($('[data-f=default]', block).value);
        const ok = await act(async () => {
          if (toDel.length) await q(sb.from('configurazioni').delete().eq('id_prodotto', id).eq('id_attributo', aid).in('id_opzione', toDel));
          if (toAdd.length) await q(sb.from('configurazioni').insert(toAdd.map((o) => ({ id_prodotto: id, id_attributo: aid, id_opzione: o }))));
          await q(sb.from('prodotti_attributi').update({
            id_opzione_default: def, ordine: num($('[data-f=ordine]', block).value) ?? 0, obbligatorio: $('[data-f=obbligatorio]', block).checked,
          }).eq('id_prodotto', id).eq('id_attributo', aid));
        }, 'Attributo salvato');
        if (ok) reload();
      }
    };
  });

  if (previewMeasures.length && previewAttributeIds.length) {
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
      for (const mesh of meshRows) {
        const attributeId = meshMappingsByPath[mesh.percorso_nodo];
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
        await applyPreview();
      } catch (error) {
        status.textContent = `Impossibile caricare l’anteprima: ${errMsg(error)}`;
        status.classList.add('error-text');
      } finally {
        measureSelect.disabled = false;
      }
    };
    measureSelect.onchange = loadSelectedMeasure;
    $$('[data-preview-attribute]').forEach((select) => {
      select.onchange = () => {
        applyPreview().catch((error) => {
          status.textContent = `Impossibile aggiornare l’anteprima: ${errMsg(error)}`;
          status.classList.add('error-text');
        });
      };
    });
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
      <td class="actions">${o ? '<button class="small" data-act="save">Salva</button> <button class="small danger" data-act="del">Elimina</button>' : '<button class="small primary" data-act="add">Aggiungi</button>'}</td></tr>`;

  const abilitate = new Set(esposte.filter((e) => e.abilitata).map((e) => e.id_opzione));
  const nextOrdine = opzioni.length ? Math.max(...opzioni.map((o) => o.ordine)) + 1 : 0;

  const opzioniSection = isNew ? '<p class="muted">Dopo la creazione potrai definire le opzioni.</p>' : derivato ? `
    <section class="card"><h2>Opzioni del derivato</h2>
      <p class="muted">Seleziona le opzioni dell'attributo padre da includere in questo attributo.</p>
      <div class="opt-grid">${padreOpzioni.map((o) => `<label class="check"><input type="checkbox" data-opt="${o.id_opzione}" ${abilitate.has(o.id_opzione) ? 'checked' : ''}> ${esc(o.nome)}${o.attiva ? '' : ' <span class="muted">(non attiva)</span>'}</label>`).join('') || '<span class="muted">L\'attributo padre non ha opzioni.</span>'}</div>
      <button class="primary" id="save-sub">Salva selezione</button></section>` : `
    <section class="card"><h2>Opzioni</h2>
      <div class="table-scroll"><table><thead><tr><th>Nome</th><th>Descrizione</th><th>${attr.tipo_attributo === 'Materiale' ? 'Materiale' : 'Visibilità'}</th><th>Ordine</th><th>Attiva</th><th></th></tr></thead>
      <tbody id="opzioni">${opzioni.map((o) => opzioneRow(o)).join('')}${opzioneRow(null, nextOrdine)}</tbody></table></div>
      ${attr.tipo_attributo === 'Materiale' ? '<div style="margin-top:.75rem"><a class="btn small" href="#/materiali/nuovo">+ Nuovo materiale</a></div>' : ''}
    </section>`;

  shell(`
    <div class="page-head"><div><h1>${isNew ? 'Nuovo attributo' : esc(attr.nome)}</h1>
      <span class="muted">${derivato ? 'Attributo derivato' : 'Attributo generale'}</span></div></div>
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
      <button class="primary">${isNew ? 'Crea attributo' : 'Salva dati'}</button> <a class="btn" href="#/attributi">${isNew ? 'Annulla' : 'Chiudi'}</a>
    </form>${opzioniSection}`, crumbs);

  // un derivato ha il tipo del padre
  $('#padre').onchange = () => {
    const t = $('#padre').selectedOptions[0].dataset.tipo;
    if (t) $('#tipo').value = t;
    $('#tipo').disabled = !!t || !isNew;
  };

  $('#form-attr').onsubmit = async (e) => {
    e.preventDefault();
    const rec = { nome: $('#nome').value.trim(), descrizione: $('#descrizione').value.trim() || null, attivo: $('#attivo').checked };
    if (!rec.nome) return toast('Il nome è obbligatorio', true);
    if (isNew) {
      rec.tipo_attributo = $('#tipo').value;
      rec.id_attributo_padre = num($('#padre').value);
      try {
        const created = await q(sb.from('attributi').insert(rec).select('id_attributo').single());
        toast('Attributo creato');
        go(`#/attributi/${created.id_attributo}`);
      } catch (err) { toast(errMsg(err), true); }
    } else if (await act(() => q(sb.from('attributi').update(rec).eq('id_attributo', id)), 'Dati salvati')) {
      $('h1').textContent = rec.nome;
    }
  };
  if (isNew) return;
  const reload = () => viewAttributo(String(id));

  if (derivato) {
    $('#save-sub').onclick = async () => {
      const wanted = $$('[data-opt]:checked').map((c) => Number(c.dataset.opt));
      const known = new Set(esposte.map((x) => x.id_opzione));
      const toRemove = [...known].filter((o) => !wanted.includes(o));
      const toAdd = wanted.filter((o) => !known.has(o));
      const ok = await act(async () => {
        if (toRemove.length) await q(sb.from('attributi_opzioni').delete().eq('id_attributo', id).in('id_opzione', toRemove));
        if (toAdd.length) await q(sb.from('attributi_opzioni').insert(toAdd.map((o) => ({ id_attributo: id, id_opzione: o }))));
      }, 'Selezione salvata');
      if (ok) reload();
    };
    return;
  }

  $('#opzioni').onclick = async (e) => {
    const action = e.target.dataset.act;
    if (!action) return;
    const tr = e.target.closest('tr');
    const oid = tr.dataset.opz;
    if (action === 'del') {
      if (!confirm('Eliminare l\'opzione? Verrà tolta anche da attributi derivati e prodotti che la usano.')) return;
      if (await act(() => q(sb.from('opzioni').delete().eq('id_opzione', oid)), 'Opzione eliminata')) reload();
      return;
    }
    const f = (n) => $(`[data-f=${n}]`, tr);
    const rec = { nome: f('nome').value.trim(), descrizione: f('descrizione').value.trim() || null, ordine: num(f('ordine').value) ?? 0, attiva: f('attiva').checked };
    if (!rec.nome) return toast('Il nome dell\'opzione è obbligatorio', true);
    if (attr.tipo_attributo === 'Materiale') rec.id_materiale = num(f('id_materiale').value);
    else rec.valore_visibilita = f('valore_visibilita').value === '' ? null : f('valore_visibilita').value === 'true';
    const op = action === 'add' ? sb.from('opzioni').insert({ ...rec, id_attributo: id }) : sb.from('opzioni').update(rec).eq('id_opzione', oid);
    if (await act(() => q(op), 'Opzione salvata')) reload();
  };

}

// ---------- materiali ----------
async function viewMateriali(idParam) {
  const isNew = idParam === 'nuovo';
  shell('<div class="empty">Caricamento…</div>', [['Anagrafica materiali']]);
  const [materiali, risorse] = await Promise.all([
    q(sb.from('materiali').select('*').order('nome')),
    q(sb.from('risorse_glb').select('id_glb, nome_file').eq('tipo_risorsa', 'Materiale').order('nome_file')),
  ]);
  const resourceOptions = (selectedId) => `<option value="">— nessun GLB —</option>${risorse.map((resource) =>
    `<option value="${resource.id_glb}" ${String(resource.id_glb) === String(selectedId || '') ? 'selected' : ''}>${esc(resource.nome_file)}</option>`).join('')}`;
  const materialRow = (material) => `<tr data-material="${material?.id_materiale ?? 'new'}">
    <td><input data-f="nome" maxlength="150" value="${esc(material?.nome)}" placeholder="Nome materiale" aria-label="Nome materiale"></td>
    <td><input data-f="descrizione" value="${esc(material?.descrizione)}" placeholder="Descrizione" aria-label="Descrizione"></td>
    <td><input data-f="rif" maxlength="200" value="${esc(material?.rif_materiale_interno)}" placeholder="Riferimento interno" aria-label="Riferimento interno"></td>
    <td><select data-f="glb" aria-label="GLB del materiale">${resourceOptions(material?.id_glb)}</select>
      <input type="file" data-f="file" accept=".glb,model/gltf-binary" aria-label="Carica GLB materiale"></td>
    <td class="actions"><button class="small primary" data-act="save">${material ? 'Salva' : 'Crea'}</button>
      ${material ? `<button class="small danger" data-act="delete">Elimina</button>` : ''}</td></tr>`;

  shell(`
    <div class="page-head"><div><h1>Anagrafica materiali</h1><span class="muted">${materiali.length} materiali · associa un GLB dedicato a ciascun materiale</span></div>
      <a class="btn primary shrink" href="#/materiali/nuovo">+ Nuovo materiale</a></div>
    <section class="card table-scroll"><table><thead><tr><th>Nome</th><th>Descrizione</th><th>Riferimento interno</th><th>GLB</th><th></th></tr></thead>
      <tbody id="materials">${materiali.map(materialRow).join('')}${isNew ? materialRow(null) : ''}</tbody></table></section>
    <p class="muted">Il file caricato viene archiviato in Supabase Storage; il GLB può essere sostituito scegliendone uno nuovo oppure rimosso selezionando “nessun GLB”.</p>`,
  [['Anagrafica materiali']]);

  $('#materials').onclick = async (event) => {
    const action = event.target.dataset.act;
    if (!action) return;
    const row = event.target.closest('tr');
    const materialId = row.dataset.material;
    if (action === 'delete') {
      const material = materiali.find((item) => String(item.id_materiale) === materialId);
      if (!confirm(`Eliminare il materiale "${material.nome}"? Le opzioni collegate resteranno senza materiale.`)) return;
      if (await act(() => q(sb.from('materiali').delete().eq('id_materiale', materialId)), 'Materiale eliminato')) viewMateriali();
      return;
    }

    const nome = $('[data-f=nome]', row).value.trim();
    if (!nome) return toast('Il nome del materiale è obbligatorio.', true);
    const file = $('[data-f=file]', row).files[0];
    if (file) {
      let uploaded;
      try {
        uploaded = await uploadGlbResource(file, 'Materiale', `materiali/${materialId === 'new' ? crypto.randomUUID() : materialId}`);
      } catch (error) { return toast(errMsg(error), true); }
      const resourceId = uploaded.id_glb;
      const rec = {
        nome,
        descrizione: $('[data-f=descrizione]', row).value.trim() || null,
        rif_materiale_interno: $('[data-f=rif]', row).value.trim() || null,
        id_glb: resourceId,
      };
      try {
        if (materialId === 'new') await q(sb.from('materiali').insert(rec));
        else await q(sb.from('materiali').update(rec).eq('id_materiale', materialId));
        toast(materialId === 'new' ? 'Materiale creato' : 'Materiale salvato');
        return viewMateriali();
      } catch (error) {
        const { error: resourceCleanupError } = await sb.from('risorse_glb').delete().eq('id_glb', resourceId);
        const { error: storageCleanupError } = await sb.storage.from('modelli-glb').remove([uploaded.path]);
        const cleanupErrors = [resourceCleanupError, storageCleanupError].filter(Boolean).map(errMsg);
        return toast(cleanupErrors.length ? `${errMsg(error)} (pulizia non riuscita: ${cleanupErrors.join('; ')})` : errMsg(error), true);
      }
    }

    const rec = {
      nome,
      descrizione: $('[data-f=descrizione]', row).value.trim() || null,
      rif_materiale_interno: $('[data-f=rif]', row).value.trim() || null,
      id_glb: num($('[data-f=glb]', row).value),
    };
    const operation = materialId === 'new'
      ? sb.from('materiali').insert(rec)
      : sb.from('materiali').update(rec).eq('id_materiale', materialId);
    if (await act(() => q(operation), materialId === 'new' ? 'Materiale creato' : 'Materiale salvato')) viewMateriali();
  };
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
