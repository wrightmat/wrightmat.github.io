import { DataManager } from './DataManager.js';

const dm = new DataManager(location.origin);

const elTree = document.getElementById('tree');
const elForm = document.getElementById('form');
const elActions = document.getElementById('actions');

const views = ['fields', 'fragments', 'metadata', 'formulas'];
let currentView = 'fields';
let selection = null;

let sys = createSystem();

draw();

function createSystem(){
  return {
    id: 'sys.new',
    title: 'New System',
    version: '0.1.0',
    fields: [],
    fragments: [],
    metadata: [],
    formulas: [],
    importers: []
  };
}

function createField(type='string'){
  const field = { key: 'newField', label: '', type, required: false };
  switch(type){
    case 'group':
    case 'object':
      field.children = field.children || [];
      if(type === 'object') field.additional = null;
      break;
    case 'array':
      field.item = field.item || createField('string');
      field.minItems = field.minItems ?? 0;
      field.maxItems = field.maxItems ?? null;
      break;
    case 'boolean':
      field.default = field.default ?? false;
      break;
    default:
      break;
  }
  return field;
}

function createFragment(){
  return {
    id: 'fragment.id',
    label: 'New Fragment',
    fields: []
  };
}

function createMetadata(){
  return {
    id: 'meta.id',
    label: 'New Metadata',
    type: 'list',
    values: []
  };
}

function createFormula(){
  return {
    key: 'mod.example',
    expr: '0',
    label: ''
  };
}

function draw(){
  renderActions();
  renderTree();
  renderInspector();
}

function renderActions(){
  elActions.innerHTML = `<h3>System</h3>
    <div class="form-row"><label>System ID</label><input id="sysid" class="input" value="${sys.id}"/></div>
    <div class="form-row"><label>Title</label><input id="systitle" class="input" value="${sys.title || ''}"/></div>
    <div class="form-row"><label>Version</label><input id="sysver" class="input" value="${sys.version || ''}"/></div>
    <div class="actions">
      <button class="btn" id="save">Save</button>
      <button class="btn" id="load">Load</button>
      <button class="btn" id="new">New</button>
    </div>
    <div class="form-row"><label>View</label><div id="nav"></div></div>`;
  elActions.querySelector('#sysid').oninput = (e)=> sys.id = e.target.value;
  elActions.querySelector('#systitle').oninput = (e)=> sys.title = e.target.value;
  elActions.querySelector('#sysver').oninput = (e)=> sys.version = e.target.value;
  elActions.querySelector('#save').onclick = saveSystem;
  elActions.querySelector('#load').onclick = loadSystem;
  elActions.querySelector('#new').onclick = ()=>{ sys = createSystem(); selection = null; draw(); };
  const nav = elActions.querySelector('#nav');
  views.forEach(v=>{
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = v.charAt(0).toUpperCase() + v.slice(1);
    btn.classList.toggle('primary', currentView === v);
    btn.onclick = ()=>{ currentView = v; selection = null; draw(); };
    nav.appendChild(btn);
  });
}

function renderTree(){
  switch(currentView){
    case 'fields':
      renderFieldTree();
      break;
    case 'fragments':
      renderFragmentTree();
      break;
    case 'metadata':
      renderMetadataTree();
      break;
    case 'formulas':
      renderFormulaTree();
      break;
  }
}

function renderFieldTree(){
  elTree.innerHTML = '<h3>Fields</h3>';
  sys.fields.forEach((field, index)=> renderFieldBranch(field, ['fields', index], 0, 'fields'));
  const add = document.createElement('button');
  add.className = 'btn';
  add.textContent = 'Add field';
  add.onclick = ()=>{
    const f = createField();
    sys.fields.push(f);
    selection = { view:'fields', path:['fields', sys.fields.length-1] };
    draw();
  };
  elTree.appendChild(add);
}

function renderFragmentTree(){
  elTree.innerHTML = '<h3>Fragments</h3>';
  sys.fragments.forEach((frag, idx)=>{
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.classList.toggle('selected', isSelected(['fragments', idx], 'fragments'));
    row.textContent = `${frag.id} — ${frag.label}`;
    row.onclick = ()=>{ selection = { view:'fragments', path:['fragments', idx] }; draw(); };
    elTree.appendChild(row);
    (frag.fields || []).forEach((field, fieldIndex)=>{
      renderFieldBranch(field, ['fragments', idx, 'fields', fieldIndex], 1, 'fragments');
    });
  });
  const add = document.createElement('button');
  add.className = 'btn';
  add.textContent = 'Add fragment';
  add.onclick = ()=>{
    sys.fragments.push(createFragment());
    selection = { view:'fragments', path:['fragments', sys.fragments.length-1] };
    draw();
  };
  elTree.appendChild(add);
}

function renderMetadataTree(){
  elTree.innerHTML = '<h3>Metadata</h3>';
  sys.metadata.forEach((entry, idx)=>{
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.classList.toggle('selected', isSelected(['metadata', idx], 'metadata'));
    row.textContent = `${entry.id} — ${entry.type}`;
    row.onclick = ()=>{ selection = { view:'metadata', path:['metadata', idx] }; draw(); };
    elTree.appendChild(row);
  });
  const add = document.createElement('button');
  add.className = 'btn';
  add.textContent = 'Add metadata';
  add.onclick = ()=>{
    sys.metadata.push(createMetadata());
    selection = { view:'metadata', path:['metadata', sys.metadata.length-1] };
    draw();
  };
  elTree.appendChild(add);
}

function renderFormulaTree(){
  elTree.innerHTML = '<h3>Formulas</h3>';
  sys.formulas.forEach((formula, idx)=>{
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.classList.toggle('selected', isSelected(['formulas', idx], 'formulas'));
    row.textContent = `${formula.key}`;
    row.onclick = ()=>{ selection = { view:'formulas', path:['formulas', idx] }; draw(); };
    elTree.appendChild(row);
  });
  const add = document.createElement('button');
  add.className = 'btn';
  add.textContent = 'Add formula';
  add.onclick = ()=>{
    sys.formulas.push(createFormula());
    selection = { view:'formulas', path:['formulas', sys.formulas.length-1] };
    draw();
  };
  elTree.appendChild(add);
}

function renderFieldBranch(field, path, depth, origin){
  const row = document.createElement('div');
  row.className = 'tree-row';
  row.style.paddingLeft = `${depth*16}px`;
  row.classList.toggle('selected', isSelected(path, origin));
  const label = field.label || field.key || '(field)';
  row.textContent = `${label} — ${field.type}`;
  row.onclick = ()=>{ selection = { view: origin || currentView, path: [...path] }; draw(); };
  elTree.appendChild(row);
  if(field.type === 'group' || field.type === 'object'){
    (field.children || []).forEach((child, idx)=>{
      renderFieldBranch(child, [...path, 'children', idx], depth+1, origin);
    });
    if(field.type === 'object' && field.additional){
      renderFieldBranch(field.additional, [...path, 'additional'], depth+1, origin);
    }
  }
  if(field.type === 'array' && field.item){
    renderFieldBranch(field.item, [...path, 'item'], depth+1, origin);
  }
}

function renderInspector(){
  elForm.innerHTML = '<h3>Inspector</h3>';
  if(!selection || selection.view !== currentView){
    elForm.innerHTML += '<div class="small">Select an item</div>';
    return;
  }
  const target = getByPath(selection.path);
  if(currentView === 'fields' || (currentView === 'fragments' && selection.path.includes('fields'))){
    if(target && target.type){
      renderFieldInspector(target);
    }
  }else if(currentView === 'fragments'){
    renderFragmentInspector(target);
  }else if(currentView === 'metadata'){
    renderMetadataInspector(target);
  }else if(currentView === 'formulas'){
    renderFormulaInspector(target);
  }
}

function renderFieldInspector(field){
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-row"><label>Key</label><input id="field_key" class="input" value="${field.key}"/></div>
    <div class="form-row"><label>Label</label><input id="field_label" class="input" value="${field.label || ''}"/></div>
    <div class="form-row"><label>Description</label><textarea id="field_desc" class="input" rows="2">${field.description || ''}</textarea></div>
    <div class="form-row"><label>Type</label>
      <select id="field_type" class="input">
        ${['string','integer','number','boolean','array','object','group'].map(t=>`<option value="${t}" ${field.type===t?'selected':''}>${t}</option>`).join('')}
      </select>
    </div>
    <div class="form-row"><label><input type="checkbox" id="field_required" ${field.required?'checked':''}/> Required</label></div>
  `;
  form.querySelector('#field_key').oninput = (e)=> field.key = e.target.value;
  form.querySelector('#field_label').oninput = (e)=> field.label = e.target.value;
  form.querySelector('#field_desc').oninput = (e)=> field.description = e.target.value;
  form.querySelector('#field_type').onchange = (e)=>{ replaceField(field, e.target.value); draw(); };
  form.querySelector('#field_required').onchange = (e)=> field.required = e.target.checked;
  elForm.appendChild(form);

  if(field.type === 'string'){
    addStringOptions(field);
  }
  if(field.type === 'integer' || field.type === 'number'){
    addNumericOptions(field);
  }
  if(field.type === 'array'){
    addArrayOptions(field);
  }
  if(field.type === 'object'){
    addObjectOptions(field);
  }
  if(field.type === 'group' || field.type === 'object'){
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = 'Add child field';
    btn.onclick = ()=>{
      field.children = field.children || [];
      field.children.push(createField());
      selection = { view: currentView, path: [...selection.path, 'children', field.children.length-1] };
      draw();
    };
    elForm.appendChild(btn);
  }

  const metadataOptions = document.createElement('div');
  metadataOptions.className = 'form-row';
  metadataOptions.innerHTML = `<label>Options from metadata</label>
    <select id="field_meta" class="input">
      <option value="">(none)</option>
      ${(sys.metadata || []).map(entry=>`<option value="${entry.id}" ${field.optionsFrom===entry.id?'selected':''}>${entry.id}</option>`).join('')}
    </select>`;
  metadataOptions.querySelector('#field_meta').onchange = (e)=>{
    field.optionsFrom = e.target.value || undefined;
  };
  elForm.appendChild(metadataOptions);

  const fragRow = document.createElement('div');
  fragRow.className = 'form-row';
  fragRow.innerHTML = `<label>Merge fragment</label>
    <select id="field_fragment" class="input">
      <option value="">(none)</option>
      ${(sys.fragments || []).map(f=>`<option value="${f.id}" ${field.fragment===f.id?'selected':''}>${f.id}</option>`).join('')}
    </select>`;
  fragRow.querySelector('#field_fragment').onchange = (e)=>{
    field.fragment = e.target.value || undefined;
  };
  elForm.appendChild(fragRow);

  if(typeof selection.path[selection.path.length-1] === 'number'){
    const moveRow = document.createElement('div');
    moveRow.className = 'actions';
    const up = document.createElement('button'); up.className='btn small'; up.textContent='Move up';
    const down = document.createElement('button'); down.className='btn small'; down.textContent='Move down';
    up.onclick = ()=> moveSelected(-1);
    down.onclick = ()=> moveSelected(1);
    moveRow.appendChild(up); moveRow.appendChild(down);
    elForm.appendChild(moveRow);
  }

  if(selection.path[selection.path.length-1] !== 'item' && selection.path[selection.path.length-1] !== 'additional'){
    const del = document.createElement('button');
    del.className = 'btn danger';
    del.textContent = 'Delete field';
    del.onclick = ()=>{ removeAt(selection.path); };
    elForm.appendChild(del);
  }
}

function addStringOptions(field){
  const row = document.createElement('div');
  row.className = 'form-row';
  row.innerHTML = `<label>Enum values</label><textarea id="field_enum" class="input" rows="3">${(field.enum||[]).join('\n')}</textarea>`;
  row.querySelector('#field_enum').oninput = (e)=>{
    const values = e.target.value.split('\n').map(v=>v.trim()).filter(Boolean);
    field.enum = values.length ? values : undefined;
  };
  elForm.appendChild(row);
}

function addNumericOptions(field){
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="form-row"><label>Minimum</label><input type="number" id="field_min" class="input" value="${field.minimum ?? ''}"/></div>
    <div class="form-row"><label>Maximum</label><input type="number" id="field_max" class="input" value="${field.maximum ?? ''}"/></div>
  `;
  wrap.querySelector('#field_min').oninput = (e)=>{
    field.minimum = e.target.value === '' ? undefined : Number(e.target.value);
  };
  wrap.querySelector('#field_max').oninput = (e)=>{
    field.maximum = e.target.value === '' ? undefined : Number(e.target.value);
  };
  elForm.appendChild(wrap);
}

function addArrayOptions(field){
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="form-row"><label>Min items</label><input type="number" id="field_min_items" class="input" value="${field.minItems ?? ''}"/></div>
    <div class="form-row"><label>Max items</label><input type="number" id="field_max_items" class="input" value="${field.maxItems ?? ''}"/></div>
    <div class="form-row"><label>Fragment</label>
      <select id="field_fragment" class="input">
        <option value="">(none)</option>
        ${(sys.fragments || []).map(f=>`<option value="${f.id}" ${field.itemFragment===f.id?'selected':''}>${f.id}</option>`).join('')}
      </select>
    </div>
  `;
  wrap.querySelector('#field_min_items').oninput = (e)=> field.minItems = e.target.value === '' ? undefined : Number(e.target.value);
  wrap.querySelector('#field_max_items').oninput = (e)=> field.maxItems = e.target.value === '' ? undefined : Number(e.target.value);
  wrap.querySelector('#field_fragment').onchange = (e)=> field.itemFragment = e.target.value || undefined;
  elForm.appendChild(wrap);
  if(!field.item){
    field.item = createField('string');
  }
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = 'Edit item schema';
  btn.onclick = ()=>{
    selection = { view: currentView, path: [...selection.path, 'item'] };
    draw();
  };
  elForm.appendChild(btn);
}

function addObjectOptions(field){
  const wrap = document.createElement('div');
  const checked = field.additional ? 'checked' : '';
  wrap.innerHTML = `<label><input type="checkbox" id="field_additional" ${checked}/> Allow additional keys</label>`;
  wrap.querySelector('#field_additional').onchange = (e)=>{
    if(e.target.checked){
      field.additional = field.additional || createField('string');
    }else{
      field.additional = undefined;
    }
    draw();
  };
  elForm.appendChild(wrap);
  if(field.additional){
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = 'Edit additional schema';
    btn.onclick = ()=>{
      selection = { view: currentView, path: [...selection.path, 'additional'] };
      draw();
    };
    elForm.appendChild(btn);
  }
}

function renderFragmentInspector(fragment){
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-row"><label>Fragment ID</label><input id="frag_id" class="input" value="${fragment.id}"/></div>
    <div class="form-row"><label>Label</label><input id="frag_label" class="input" value="${fragment.label || ''}"/></div>
  `;
  form.querySelector('#frag_id').oninput = (e)=> fragment.id = e.target.value;
  form.querySelector('#frag_label').oninput = (e)=> fragment.label = e.target.value;
  elForm.appendChild(form);
  const btn = document.createElement('button');
  btn.className = 'btn danger';
  btn.textContent = 'Delete fragment';
  btn.onclick = ()=>{ removeAt(selection.path); };
  elForm.appendChild(btn);
}

function renderMetadataInspector(entry){
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-row"><label>Metadata ID</label><input id="meta_id" class="input" value="${entry.id}"/></div>
    <div class="form-row"><label>Label</label><input id="meta_label" class="input" value="${entry.label || ''}"/></div>
    <div class="form-row"><label>Type</label>
      <select id="meta_type" class="input">
        ${['list','map'].map(t=>`<option value="${t}" ${entry.type===t?'selected':''}>${t}</option>`).join('')}
      </select>
    </div>
    <div class="form-row"><label>Values</label><textarea id="meta_values" class="input" rows="4">${formatValues(entry.values)}</textarea></div>
    <div class="form-row"><label>Source (optional)</label><input id="meta_source" class="input" value="${entry.source || ''}" placeholder="/path/to.json"/></div>
  `;
  form.querySelector('#meta_id').oninput = (e)=> entry.id = e.target.value;
  form.querySelector('#meta_label').oninput = (e)=> entry.label = e.target.value;
  form.querySelector('#meta_type').onchange = (e)=> entry.type = e.target.value;
  form.querySelector('#meta_values').oninput = (e)=>{
    const values = e.target.value.split('\n').map(v=>v.trim()).filter(Boolean);
    entry.values = values;
  };
  form.querySelector('#meta_source').oninput = (e)=> entry.source = e.target.value;
  elForm.appendChild(form);
  const btn = document.createElement('button');
  btn.className = 'btn danger';
  btn.textContent = 'Delete metadata';
  btn.onclick = ()=>{ removeAt(selection.path); };
  elForm.appendChild(btn);
}

function renderFormulaInspector(formula){
  const form = document.createElement('div');
  form.innerHTML = `
    <div class="form-row"><label>Key</label><input id="formula_key" class="input" value="${formula.key}"/></div>
    <div class="form-row"><label>Label</label><input id="formula_label" class="input" value="${formula.label || ''}"/></div>
    <div class="form-row"><label>Expression</label><textarea id="formula_expr" class="input" rows="3">${formula.expr || ''}</textarea></div>
  `;
  form.querySelector('#formula_key').oninput = (e)=> formula.key = e.target.value;
  form.querySelector('#formula_label').oninput = (e)=> formula.label = e.target.value;
  form.querySelector('#formula_expr').oninput = (e)=> formula.expr = e.target.value;
  elForm.appendChild(form);
  const btn = document.createElement('button');
  btn.className = 'btn danger';
  btn.textContent = 'Delete formula';
  btn.onclick = ()=>{ removeAt(selection.path); };
  elForm.appendChild(btn);
}

function replaceField(field, type){
  const preserve = { key: field.key, label: field.label, description: field.description, required: field.required, optionsFrom: field.optionsFrom };
  Object.keys(field).forEach(k=> delete field[k]);
  Object.assign(field, preserve, createField(type));
}

function getByPath(path){
  let node = sys;
  for(const segment of path){
    node = node?.[segment];
    if(node === undefined) return undefined;
  }
  return node;
}

function removeAt(path){
  const parentPath = path.slice(0, -1);
  const key = path[path.length -1];
  const parent = getByPath(parentPath);
  if(Array.isArray(parent)){
    parent.splice(Number(key), 1);
  }else if(parent && typeof parent === 'object'){
    delete parent[key];
  }
  selection = null;
  draw();
}

function moveSelected(delta){
  if(!selection) return;
  const path = selection.path;
  const last = path[path.length -1];
  if(typeof last !== 'number') return;
  const parentPath = path.slice(0, -1);
  const parent = getByPath(parentPath);
  if(!Array.isArray(parent)) return;
  const targetIndex = last + delta;
  if(targetIndex < 0 || targetIndex >= parent.length) return;
  const tmp = parent[targetIndex];
  parent[targetIndex] = parent[last];
  parent[last] = tmp;
  selection = { view: selection.view, path: [...parentPath, targetIndex] };
  draw();
}

function formatValues(values){
  if(!Array.isArray(values)) return '';
  return values.join('\n');
}

function isSelected(path, origin){
  if(!selection) return false;
  if(origin && selection.view !== origin) return false;
  if(selection.path.length !== path.length) return false;
  return selection.path.every((seg, idx)=> seg === path[idx]);
}

async function saveSystem(){
  const token = localStorage.getItem('token');
  if(!token){ alert('Login first'); return; }
  const res = await dm.save('systems', sys.id, sys);
  alert(JSON.stringify(res));
}

async function loadSystem(){
  const id = prompt('System ID to load?', sys.id);
  if(!id) return;
  const loaded = await dm.read('systems', id);
  sys = loaded;
  selection = null;
  draw();
}
