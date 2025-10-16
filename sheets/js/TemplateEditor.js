import { DataManager } from './DataManager.js';
import { initAppShell } from './ui/AppShell.js';
import { createButton } from './ui/components.js';

const dm = new DataManager(location.origin);
const shell = initAppShell({
  title: 'Template Editor',
  current: 'template',
  panes: {
    left: { title: 'Template Actions', description: 'Manage metadata, versions, and bindings.' },
    center: { title: 'Layout Canvas' },
    right: { title: 'Palette & Inspector' }
  }
});

const elPalette = shell.panes.left;
const elCanvas = shell.panes.center;
const elInspector = shell.panes.right;
shell.actionBar.innerHTML = '';
let inspectorTarget = elInspector;
const offlineStatus = shell.setStatus;

let tpl = createTemplate();
let view = 'layout';
let selection = { path: ['layout'] };

draw();

function createTemplate(){
  return {
    id: 'tpl.new',
    schema: 'sys.dnd5e',
    title: 'New Template',
    layout: { type: 'stack', children: [] },
    formulas: []
  };
}

function createLayoutNode(type){
  switch(type){
    case 'stack':
      return { type: 'stack', children: [] };
    case 'row':
      return { type: 'row', gap: 8, columns: [] };
    case 'tabs':
      return { type: 'tabs', tabs: [] };
    case 'repeater':
      return { type: 'repeater', label: 'List', bind: '@items', addLabel: 'Add', emptyText: '', template: { type: 'stack', children: [] } };
    default:
      return { type: 'stack', children: [] };
  }
}

function createFieldNode(component){
  const base = { type: 'field', component, label: component.charAt(0).toUpperCase() + component.slice(1) };
  switch(component){
    case 'input':
      return { ...base, bind: '@', inputType: 'text', placeholder: '' };
    case 'text':
      return { ...base, formula: '', text: '' };
    case 'roller':
      return { ...base, expr: '1d20 + @mod' };
    case 'toggle':
      return { ...base, bind: '@', states: ['A','B'], optionsFrom: '' };
    case 'tags':
      return { ...base, bind: '@', options: ['one','two'], multi: true, optionsFrom: '' };
    case 'clock':
      return { ...base, bind: '@', max: 6 };
    case 'timer':
      return { ...base, bind: '@timers.timer', mode: 'up' };
    default:
      return base;
  }
}

function createFormula(){
  return { key: 'derived.value', expr: '0', label: '' };
}

function draw(){
  renderPalette();
  renderCanvas();
  renderInspector();
}

function renderPalette(){
  elPalette.innerHTML = `
    <section class="panel-section">
      <p class="section-heading">Template metadata</p>
      <div class="inspector-field">
        <label for="tpl_id">Template ID</label>
        <input id="tpl_id" class="input-control" value="${tpl.id}"/>
      </div>
      <div class="inspector-field">
        <label for="tpl_title">Title</label>
        <input id="tpl_title" class="input-control" value="${tpl.title || ''}"/>
      </div>
      <div class="inspector-field">
        <label for="tpl_schema">System</label>
        <input id="tpl_schema" class="input-control" value="${tpl.schema || ''}"/>
      </div>
      <div class="toolbar" id="tpl_actions" role="group" aria-label="Template actions">
        <button class="btn" id="tpl_save">Save</button>
        <button class="btn" id="tpl_load">Load</button>
        <button class="btn" id="tpl_new">New</button>
      </div>
    </section>
    <section class="panel-section">
      <p class="section-heading">Workspace view</p>
      <div class="toolbar" id="tpl_nav" role="tablist"></div>
      <div id="layoutControls" class="stack-sm"></div>
    </section>
    <section class="panel-section">
      <p class="section-heading">Data binding</p>
      <p class="small-text">Select nodes on the canvas to edit bindings and behavior in the inspector.</p>
    </section>
  `;
  elPalette.querySelector('#tpl_id').oninput = (e)=> tpl.id = e.target.value;
  elPalette.querySelector('#tpl_title').oninput = (e)=> tpl.title = e.target.value;
  elPalette.querySelector('#tpl_schema').oninput = (e)=> tpl.schema = e.target.value;
  elPalette.querySelector('#tpl_save').onclick = saveTemplate;
  elPalette.querySelector('#tpl_load').onclick = loadTemplate;
  elPalette.querySelector('#tpl_new').onclick = ()=>{ tpl = createTemplate(); selection = { path:['layout'] }; draw(); };
  const nav = elPalette.querySelector('#tpl_nav');
  ['layout','formulas'].forEach(v=>{
    const btn = createButton({
      label: v.charAt(0).toUpperCase() + v.slice(1),
      size: 'small',
      attributes: { role: 'tab' }
    });
    if(view === v){
      btn.classList.add('primary');
      btn.setAttribute('aria-selected', 'true');
    }
    btn.onclick = ()=>{
      view = v;
      selection = v === 'layout' ? { path:['layout'] } : (tpl.formulas.length ? { path:['formulas',0] } : null);
      draw();
    };
    nav.appendChild(btn);
  });

  if(view === 'layout'){
    const host = elPalette.querySelector('#layoutControls');
    host.innerHTML = '<div class="small-text">Select a container and use the palette to add layout or field elements.</div>';
  }
}

function renderLayoutControls(container){
  const info = resolveSelection();
  const controls = document.createElement('div');
  controls.className = 'stack-sm';
  const heading = document.createElement('p');
  heading.className = 'section-heading';
  heading.textContent = 'Add elements';
  controls.appendChild(heading);
  if(info && info.kind === 'node'){
    const node = info.target;
    if(node.type === 'stack'){
      const layoutBar = document.createElement('div');
      layoutBar.className = 'toolbar';
      ['stack','row','tabs','repeater'].forEach(type=>{
        const btn = createButton({
          label: type,
          size: 'small',
          onClick: ()=> appendChild(info.path, createLayoutNode(type))
        });
        layoutBar.appendChild(btn);
      });
      controls.appendChild(layoutBar);
      const fieldBar = document.createElement('div');
      fieldBar.className = 'toolbar';
      ['input','text','roller','toggle','tags','clock','timer'].forEach(type=>{
        const btn = createButton({
          label: type,
          size: 'small',
          onClick: ()=> appendChild(info.path, createFieldNode(type))
        });
        fieldBar.appendChild(btn);
      });
      controls.appendChild(fieldBar);
    }
    if(node.type === 'row'){
      const rowBar = document.createElement('div');
      rowBar.className = 'toolbar';
      const btn = createButton({
        label: 'Add column',
        size: 'small',
        onClick: ()=> addColumn(info.path, createFieldNode('input'))
      });
      rowBar.appendChild(btn);
      controls.appendChild(rowBar);
    }
    if(node.type === 'tabs'){
      const tabBar = document.createElement('div');
      tabBar.className = 'toolbar';
      const btn = createButton({
        label: 'Add tab',
        size: 'small',
        onClick: ()=> addTab(info.path, createLayoutNode('stack'))
      });
      tabBar.appendChild(btn);
      controls.appendChild(tabBar);
    }
    if(node.type === 'repeater' && !node.template){
      const tmpl = createButton({
        label: 'Create template',
        size: 'small',
        onClick: ()=>{
          node.template = createLayoutNode('stack');
          selection = { path:[...info.path, 'template'] };
          draw();
        }
      });
      controls.appendChild(tmpl);
    }
  }
  if(controls.children.length === 1){
    const hint = document.createElement('div');
    hint.className = 'small-text';
    hint.textContent = 'Select a stack, row, tabs, or repeater to add elements.';
    controls.appendChild(hint);
  }
  container.appendChild(controls);
}

function renderCanvas(){
  if(view === 'layout'){
    elCanvas.innerHTML = '<section class="panel-section"><p class="section-heading">Layout</p></section>';
    const tree = document.createElement('div');
    tree.className = 'tree-list';
    tree.setAttribute('role', 'tree');
    elCanvas.appendChild(tree);
    renderNodeOutline(tpl.layout, ['layout'], 0, tree);
  }else{
    elCanvas.innerHTML = '<section class="panel-section"><p class="section-heading">Formulas</p></section>';
    const list = document.createElement('div');
    list.className = 'tree-list';
    elCanvas.appendChild(list);
    tpl.formulas.forEach((f, idx)=>{
      const row = document.createElement('div');
      row.className = 'tree-row';
      row.classList.toggle('selected', isSelected(['formulas', idx]));
      row.textContent = `${f.key}`;
      row.onclick = ()=>{ selection = { path:['formulas', idx] }; draw(); };
      list.appendChild(row);
    });
    const add = createButton({
      label: 'Add formula',
      onClick: ()=>{
        tpl.formulas.push(createFormula());
        selection = { path:['formulas', tpl.formulas.length-1] };
        draw();
      }
    });
    elCanvas.appendChild(add);
  }
}

function renderNodeOutline(node, path, depth, host){
  const container = host || elCanvas;
  const row = document.createElement('div');
  row.className = 'tree-row';
  row.style.paddingLeft = `${depth*14}px`;
  row.classList.toggle('selected', isSelected(path));
  row.textContent = describeNode(node);
  row.onclick = ()=>{ selection = { path: [...path] }; draw(); };
  container.appendChild(row);
  if(node.type === 'stack'){
    (node.children || []).forEach((child, idx)=> renderNodeOutline(child, [...path, 'children', idx], depth+1, container));
  }
  if(node.type === 'row'){
    (node.columns || []).forEach((col, idx)=>{
      const colPath = [...path, 'columns', idx];
      const colRow = document.createElement('div');
      colRow.className = 'tree-row';
      colRow.style.paddingLeft = `${(depth+1)*14}px`;
      colRow.classList.toggle('selected', isSelected(colPath));
      colRow.textContent = `Column span ${col.span || 1}`;
      colRow.onclick = ()=>{ selection = { path: colPath }; draw(); };
      container.appendChild(colRow);
      if(col.node){
        renderNodeOutline(col.node, [...colPath, 'node'], depth+2, container);
      }
    });
  }
  if(node.type === 'tabs'){
    (node.tabs || []).forEach((tab, idx)=>{
      const tabPath = [...path, 'tabs', idx];
      const tabRow = document.createElement('div');
      tabRow.className = 'tree-row';
      tabRow.style.paddingLeft = `${(depth+1)*14}px`;
      tabRow.classList.toggle('selected', isSelected(tabPath));
      tabRow.textContent = `Tab ${tab.label || idx+1}`;
      tabRow.onclick = ()=>{ selection = { path: tabPath }; draw(); };
      container.appendChild(tabRow);
      if(tab.node){
        renderNodeOutline(tab.node, [...tabPath, 'node'], depth+2, container);
      }
    });
  }
  if(node.type === 'repeater' && node.template){
    renderNodeOutline(node.template, [...path, 'template'], depth+1, container);
  }
}

function renderInspector(){
  if(selection && !(selection.path.length === 1 && selection.path[0] === 'layout')){
    shell.showPane('right');
  }
  elInspector.innerHTML = `
    <section class="panel-section">
      <p class="section-heading">Palette</p>
      <div id="paletteControls" class="stack-sm"></div>
    </section>
    <section class="panel-section">
      <p class="section-heading">Inspector</p>
      <div id="inspectorContent" class="stack-md"></div>
    </section>
  `;
  inspectorTarget = elInspector.querySelector('#inspectorContent');
  const paletteTarget = elInspector.querySelector('#paletteControls');

  if(view === 'layout'){
    paletteTarget.innerHTML = '';
    renderLayoutControls(paletteTarget);
  }else{
    paletteTarget.innerHTML = '<div class="small-text">Palette tools are available in layout view.</div>';
  }

  if(!selection){
    const msg = document.createElement('div');
    msg.className = 'small-text';
    msg.textContent = 'Select an element to edit its properties.';
    inspectorTarget.appendChild(msg);
    return;
  }
  if(view === 'layout'){
    const info = resolveSelection();
    if(!info){
      const msg = document.createElement('div');
      msg.className = 'small-text';
      msg.textContent = 'Select an element to edit its properties.';
      inspectorTarget.appendChild(msg);
      return;
    }
    switch(info.kind){
      case 'node':
        renderNodeInspector(info);
        break;
      case 'column':
        renderColumnInspector(info);
        break;
      case 'tab':
        renderTabInspector(info);
        break;
      default:
        const fallback = document.createElement('div');
        fallback.className = 'small-text';
        fallback.textContent = 'Select an element to edit its properties.';
        inspectorTarget.appendChild(fallback);
    }
  }else{
    const target = getByPath(selection.path);
    if(target){
      renderFormulaInspector(target);
    }
  }
}

function renderNodeInspector(info){
  const node = info.target;
  if(node.type === 'stack'){
    const wrap = document.createElement('div');
    wrap.className = 'inspector-group';
    wrap.innerHTML = `<div class="form-row"><label>Gap (px)</label><input type="number" id="stack_gap" class="input" value="${node.gap ?? 8}"/></div>`;
    wrap.querySelector('#stack_gap').oninput = (e)=>{ node.gap = Number(e.target.value || 0); refreshCanvas(); };
    inspectorTarget.appendChild(wrap);
  }
  if(node.type === 'row'){
    const wrap = document.createElement('div');
    wrap.className = 'inspector-group';
    wrap.innerHTML = `<div class="form-row"><label>Gap (px)</label><input type="number" id="row_gap" class="input" value="${node.gap ?? 8}"/></div>`;
    wrap.querySelector('#row_gap').oninput = (e)=>{ node.gap = Number(e.target.value || 0); refreshCanvas(); };
    inspectorTarget.appendChild(wrap);
  }
  if(node.type === 'tabs'){
    const wrap = document.createElement('div');
    wrap.className = 'inspector-group';
    wrap.innerHTML = `<div class="small">Tabs contain tab entries. Select a tab to edit.</div>`;
    inspectorTarget.appendChild(wrap);
  }
  if(node.type === 'repeater'){
    const wrap = document.createElement('div');
    wrap.className = 'inspector-group';
    wrap.innerHTML = `
      <div class="form-row"><label>Label</label><input id="rep_label" class="input" value="${node.label || ''}"/></div>
      <div class="form-row"><label>Bind</label><input id="rep_bind" class="input" value="${node.bind || ''}"/></div>
      <div class="form-row"><label>Add Button</label><input id="rep_add" class="input" value="${node.addLabel || ''}"/></div>
      <div class="form-row"><label>Empty Text</label><input id="rep_empty" class="input" value="${node.emptyText || ''}"/></div>`;
    wrap.querySelector('#rep_label').oninput = (e)=>{ node.label = e.target.value; refreshCanvas(); };
    wrap.querySelector('#rep_bind').oninput = (e)=>{ node.bind = e.target.value; refreshCanvas(); };
    wrap.querySelector('#rep_add').oninput = (e)=>{ node.addLabel = e.target.value; refreshCanvas(); };
    wrap.querySelector('#rep_empty').oninput = (e)=> node.emptyText = e.target.value;
    inspectorTarget.appendChild(wrap);
    const clearBtn = createButton({
      label: 'Clear template',
      size: 'small',
      onClick: ()=>{
        node.template = undefined;
        selection = { path: info.path };
        draw();
      }
    });
    inspectorTarget.appendChild(clearBtn);
  }
  if(node.type === 'field'){
    renderFieldNodeInspector(node);
  }
  const path = info.path;
  if(canRemove(path)){
    const del = createButton({
      label: 'Delete',
      variant: 'danger',
      onClick: ()=> removePath(path)
    });
    inspectorTarget.appendChild(del);
  }
  if(canReorder(path)){
    const move = document.createElement('div');
    move.className = 'actions';
    const up = createButton({ label: 'Move up', size: 'small', onClick: ()=> moveEntry(path, -1) });
    const down = createButton({ label: 'Move down', size: 'small', onClick: ()=> moveEntry(path, 1) });
    move.appendChild(up); move.appendChild(down);
    inspectorTarget.appendChild(move);
  }
}

function renderFieldNodeInspector(node){
  const wrap = document.createElement('div');
  wrap.className = 'inspector-group';
  wrap.innerHTML = `
    <div class="form-row"><label>Label</label><input id="field_label" class="input" value="${node.label || ''}"/></div>
    <div class="form-row"><label>Bind</label><input id="field_bind" class="input" value="${node.bind || ''}"/></div>
  `;
  wrap.querySelector('#field_label').oninput = (e)=>{ node.label = e.target.value; refreshCanvas(); };
  wrap.querySelector('#field_bind').oninput = (e)=> node.bind = e.target.value;
  inspectorTarget.appendChild(wrap);
  switch(node.component){
    case 'input':
      renderInputInspector(node);
      break;
    case 'text':
      renderTextInspector(node);
      break;
    case 'roller':
      renderRollerInspector(node);
      break;
    case 'toggle':
      renderToggleInspector(node);
      break;
    case 'tags':
      renderTagsInspector(node);
      break;
    case 'clock':
      renderClockInspector(node);
      break;
    case 'timer':
      renderTimerInspector(node);
      break;
  }
}

function renderInputInspector(node){
  const wrap = document.createElement('div');
  wrap.className = 'inspector-group';
  wrap.innerHTML = `
    <div class="form-row"><label>Input type</label>
      <select id="field_input_type" class="input">
        ${['text','number','date'].map(t=>`<option value="${t}" ${node.inputType===t?'selected':''}>${t}</option>`).join('')}
      </select>
    </div>
    <div class="form-row"><label>Placeholder</label><input id="field_placeholder" class="input" value="${node.placeholder || ''}"/></div>
    <div class="form-row"><label>Min</label><input type="number" id="field_min" class="input" value="${node.min ?? ''}"/></div>
    <div class="form-row"><label>Max</label><input type="number" id="field_max" class="input" value="${node.max ?? ''}"/></div>`;
  wrap.querySelector('#field_input_type').onchange = (e)=> node.inputType = e.target.value;
  wrap.querySelector('#field_placeholder').oninput = (e)=> node.placeholder = e.target.value;
  wrap.querySelector('#field_min').oninput = (e)=> node.min = e.target.value === '' ? undefined : Number(e.target.value);
  wrap.querySelector('#field_max').oninput = (e)=> node.max = e.target.value === '' ? undefined : Number(e.target.value);
  inspectorTarget.appendChild(wrap);
}

function renderTextInspector(node){
  const wrap = document.createElement('div');
  wrap.className = 'inspector-group';
  wrap.innerHTML = `
    <div class="form-row"><label>Formula</label><input id="field_formula" class="input" value="${node.formula || ''}"/></div>
    <div class="form-row"><label>Fallback text</label><input id="field_text" class="input" value="${node.text || ''}"/></div>`;
  wrap.querySelector('#field_formula').oninput = (e)=> node.formula = e.target.value;
  wrap.querySelector('#field_text').oninput = (e)=> node.text = e.target.value;
  inspectorTarget.appendChild(wrap);
}

function renderRollerInspector(node){
  const wrap = document.createElement('div');
  wrap.className = 'inspector-group';
  wrap.innerHTML = `<div class="form-row"><label>Expression</label><input id="field_expr" class="input" value="${node.expr || ''}"/></div>`;
  wrap.querySelector('#field_expr').oninput = (e)=> node.expr = e.target.value;
  inspectorTarget.appendChild(wrap);
}

function renderToggleInspector(node){
  const wrap = document.createElement('div');
  wrap.className = 'inspector-group';
  wrap.innerHTML = `
    <div class="form-row"><label>States (one per line)</label><textarea id="field_states" class="input" rows="3">${(node.states || []).join('\n')}</textarea></div>
    <div class="form-row"><label>Options from metadata</label><input id="field_options_from" class="input" value="${node.optionsFrom || ''}"/></div>`;
  wrap.querySelector('#field_states').oninput = (e)=> node.states = e.target.value.split('\n').map(v=>v.trim()).filter(Boolean);
  wrap.querySelector('#field_options_from').oninput = (e)=> node.optionsFrom = e.target.value;
  inspectorTarget.appendChild(wrap);
}

function renderTagsInspector(node){
  const wrap = document.createElement('div');
  wrap.className = 'inspector-group';
  wrap.innerHTML = `
    <div class="form-row"><label>Options (one per line)</label><textarea id="field_options" class="input" rows="3">${(node.options || []).join('\n')}</textarea></div>
    <div class="form-row"><label>Metadata source</label><input id="field_options_from" class="input" value="${node.optionsFrom || ''}"/></div>
    <div class="form-row"><label><input type="checkbox" id="field_multi" ${node.multi?'checked':''}/> Multi-select</label></div>`;
  wrap.querySelector('#field_options').oninput = (e)=> node.options = e.target.value.split('\n').map(v=>v.trim()).filter(Boolean);
  wrap.querySelector('#field_options_from').oninput = (e)=> node.optionsFrom = e.target.value;
  wrap.querySelector('#field_multi').onchange = (e)=> node.multi = e.target.checked;
  inspectorTarget.appendChild(wrap);
}

function renderClockInspector(node){
  const wrap = document.createElement('div');
  wrap.className = 'inspector-group';
  wrap.innerHTML = `<div class="form-row"><label>Max ticks</label><input type="number" id="field_max" class="input" value="${node.max ?? 6}"/></div>`;
  wrap.querySelector('#field_max').oninput = (e)=> node.max = Number(e.target.value || 0);
  inspectorTarget.appendChild(wrap);
}

function renderTimerInspector(node){
  const wrap = document.createElement('div');
  wrap.className = 'inspector-group';
  wrap.innerHTML = `<div class="form-row"><label>Mode</label>
    <select id="field_mode" class="input">
      ${['up','down'].map(m=>`<option value="${m}" ${node.mode===m?'selected':''}>${m}</option>`).join('')}
    </select></div>`;
  wrap.querySelector('#field_mode').onchange = (e)=> node.mode = e.target.value;
  inspectorTarget.appendChild(wrap);
}

function renderColumnInspector(info){
  const column = info.target;
  const wrap = document.createElement('div');
  wrap.className = 'inspector-group';
  wrap.innerHTML = `<div class="form-row"><label>Span</label><input type="number" id="col_span" class="input" value="${column.span || 1}"/></div>`;
  wrap.querySelector('#col_span').oninput = (e)=>{ column.span = Number(e.target.value || 1); refreshCanvas(); };
  inspectorTarget.appendChild(wrap);
  const actions = document.createElement('div');
  actions.className = 'actions';
  const remove = createButton({ label: 'Delete column', variant: 'danger', onClick: ()=> removePath(info.path) });
  const up = createButton({ label: 'Move up', size: 'small', onClick: ()=> moveEntry(info.path, -1) });
  const down = createButton({ label: 'Move down', size: 'small', onClick: ()=> moveEntry(info.path, 1) });
  actions.appendChild(remove); actions.appendChild(up); actions.appendChild(down);
  inspectorTarget.appendChild(actions);
}

function renderTabInspector(info){
  const tab = info.target;
  const wrap = document.createElement('div');
  wrap.className = 'inspector-group';
  wrap.innerHTML = `<div class="form-row"><label>Label</label><input id="tab_label" class="input" value="${tab.label || ''}"/></div>`;
  wrap.querySelector('#tab_label').oninput = (e)=>{ tab.label = e.target.value; refreshCanvas(); };
  inspectorTarget.appendChild(wrap);
  const actions = document.createElement('div');
  actions.className = 'actions';
  const remove = createButton({ label: 'Delete tab', variant: 'danger', onClick: ()=> removePath(info.path) });
  const up = createButton({ label: 'Move up', size: 'small', onClick: ()=> moveEntry(info.path, -1) });
  const down = createButton({ label: 'Move down', size: 'small', onClick: ()=> moveEntry(info.path, 1) });
  actions.appendChild(remove); actions.appendChild(up); actions.appendChild(down);
  inspectorTarget.appendChild(actions);
}

function renderFormulaInspector(formula){
  const wrap = document.createElement('div');
  wrap.className = 'inspector-group';
  wrap.innerHTML = `
    <div class="form-row"><label>Key</label><input id="formula_key" class="input" value="${formula.key}"/></div>
    <div class="form-row"><label>Label</label><input id="formula_label" class="input" value="${formula.label || ''}"/></div>
    <div class="form-row"><label>Expression</label><textarea id="formula_expr" class="input" rows="3">${formula.expr || ''}</textarea></div>`;
  wrap.querySelector('#formula_key').oninput = (e)=> formula.key = e.target.value;
  wrap.querySelector('#formula_label').oninput = (e)=> formula.label = e.target.value;
  wrap.querySelector('#formula_expr').oninput = (e)=> formula.expr = e.target.value;
  inspectorTarget.appendChild(wrap);
  const actions = document.createElement('div');
  actions.className = 'actions';
  const remove = createButton({ label: 'Delete formula', variant: 'danger', onClick: ()=> removePath(selection.path) });
  actions.appendChild(remove);
  inspectorTarget.appendChild(actions);
}

function appendChild(path, node){
  const target = getByPath(path);
  if(!target) return;
  if(target.type === 'stack'){
    target.children = target.children || [];
    target.children.push(node);
    selection = { path: [...path, 'children', target.children.length-1] };
  }else if(target.type === 'repeater'){
    target.template = node;
    selection = { path: [...path, 'template'] };
  }
  draw();
}

function addColumn(path, node){
  const target = getByPath(path);
  if(!target) return;
  target.columns = target.columns || [];
  target.columns.push({ span: 1, node });
  selection = { path: [...path, 'columns', target.columns.length-1, 'node'] };
  draw();
}

function addTab(path, node){
  const target = getByPath(path);
  if(!target) return;
  target.tabs = target.tabs || [];
  target.tabs.push({ label: `Tab ${target.tabs.length+1}`, node });
  selection = { path: [...path, 'tabs', target.tabs.length-1, 'node'] };
  draw();
}

function removePath(path){
  const parentPath = path.slice(0, -1);
  const key = path[path.length -1];
  const parent = getByPath(parentPath);
  if(Array.isArray(parent)){
    parent.splice(Number(key), 1);
    if(parent.length){
      const next = Math.min(parent.length-1, Number(key));
      selection = { path: [...parentPath, next] };
    }else{
      selection = parentPath.length > 1 ? { path: parentPath.slice(0, -1) } : null;
    }
  }else if(parent && typeof parent === 'object'){
    delete parent[key];
    selection = { path: parentPath };
  }
  draw();
}

function moveEntry(path, delta){
  const parentPath = path.slice(0, -1);
  const key = path[path.length -1];
  const parent = getByPath(parentPath);
  if(!Array.isArray(parent)) return;
  const target = Number(key) + delta;
  if(target < 0 || target >= parent.length) return;
  const tmp = parent[target];
  parent[target] = parent[key];
  parent[key] = tmp;
  selection = { path: [...parentPath, target] };
  draw();
}

function canRemove(path){
  if(path.length === 1) return false;
  const parent = getByPath(path.slice(0, -1));
  return Array.isArray(parent);
}

function canReorder(path){
  const parent = getByPath(path.slice(0, -1));
  return Array.isArray(parent);
}

function describeNode(node){
  if(!node) return '(empty)';
  if(node.type === 'field') return `${node.component} — ${node.label || ''}`;
  return node.type;
}

function resolveSelection(){
  if(!selection) return null;
  const path = selection.path;
  const target = getByPath(path);
  const last = path[path.length -1];
  const prev = path.length > 1 ? path[path.length -2] : null;
  if(path[0] === 'formulas'){
    return { kind: 'formula', target, path };
  }
  if(prev === 'columns' && typeof last === 'number'){
    return { kind: 'column', target, path };
  }
  if(prev === 'tabs' && typeof last === 'number'){
    return { kind: 'tab', target, path };
  }
  if(last === 'node'){
    return { kind: 'node', target, path };
  }
  if(target && target.type){
    return { kind: 'node', target, path };
  }
  return null;
}

function isSelected(path){
  if(!selection) return false;
  if(selection.path.length !== path.length) return false;
  return selection.path.every((seg, idx)=> seg === path[idx]);
}

function getByPath(path){
  let node = tpl;
  for(const segment of path){
    if(node == null) return undefined;
    node = node[segment];
  }
  return node;
}

function refreshCanvas(){
  if(view === 'layout'){
    renderCanvas();
  }
}

async function saveTemplate(){
  const res = await dm.save('templates', tpl.id, tpl);
  if(res?.ok){
    offlineStatus(res.local ? 'Template saved locally' : 'Template saved', res.local ? 'info' : 'success');
    setTimeout(()=> shell.clearStatus(), 1600);
  }else{
    offlineStatus(res?.error || 'Save failed', 'danger');
  }
}

async function loadTemplate(){
  const id = prompt('Template ID to load?', tpl.id);
  if(!id) return;
  const payload = await loadTemplateResource(id);
  if(!payload){
    offlineStatus('Template not found', 'danger');
    return;
  }
  tpl = payload;
  selection = { path:['layout'] };
  draw();
  shell.clearStatus();
}

async function loadTemplateResource(id){
  const payload = await dm.read('templates', id);
  if(payload && !payload.error) return payload;
  const local = dm.readLocal('templates', id);
  if(local) return local;
  return null;
}
