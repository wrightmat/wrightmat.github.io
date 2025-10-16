import { FormulaEngine } from './FormulaEngine.js';
import { DiceEngine } from './DiceEngine.js';
import { CharacterStore } from './CharacterStore.js';
import { createButton } from './ui/components.js';

const clone = (value) => (typeof structuredClone === 'function'
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value)));

export class RenderingEngine{
  constructor(system, template, source, hooks={}){
    this.system = system || { metadata: [], formulas: [] };
    this.template = template || { layout: { type: 'stack', children: [] }, formulas: [] };
    if(source && typeof source.subscribe === 'function'){
      this.store = source;
    }else{
      this.store = new CharacterStore(source || { data:{}, state:{ timers:{}, log:[] } });
    }
    this.hooks = hooks;
    this.formulas = new FormulaEngine();
    this.dice = new DiceEngine();
    this.container = null;
    this.mode = 'runtime';
    this.unsubscribe = null;
  }
  mount(container, mode='runtime'){
    this.container = container;
    this.mode = mode;
    this.render();
    if(this.unsubscribe) this.unsubscribe();
    this.unsubscribe = this.store.subscribe(()=> this.render());
  }
  dispose(){
    if(this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
    if(this._timers){
      this._timers.forEach(clearInterval);
      this._timers = [];
    }
  }
  updateTemplate(template){
    this.template = template;
    this.render();
  }
  buildCtx(){
    const base = this.store.getData();
    let ctx = clone(base);
    ctx = this.formulas.applyFormulas(this.system.formulas, ctx);
    ctx = this.formulas.applyFormulas(this.template.formulas, ctx);
    return ctx;
  }
  render(){
    if(!this.container) return;
    if(this._timers){
      this._timers.forEach(clearInterval);
    }
    this._timers = [];
    this.container.innerHTML = '';
    const ctx = this.buildCtx();
    const root = this.template.layout || { type:'stack', children:[] };
    const el = this.renderNode(root, ctx, {});
    if(el) this.container.appendChild(el);
  }
  renderNode(node, ctx, locals){
    if(!node) return null;
    switch(node.type){
      case 'stack':
        return this.renderStack(node, ctx, locals);
      case 'row':
        return this.renderRow(node, ctx, locals);
      case 'tabs':
        return this.renderTabs(node, ctx, locals);
      case 'repeater':
        return this.renderRepeater(node, ctx, locals);
      case 'field':
        return this.renderField(node, ctx, locals);
      default:
        return this.renderUnknown(node);
    }
  }
  renderStack(node, ctx, locals){
    const wrap = document.createElement('div');
    wrap.className = 'stack-block';
    (node.children || []).forEach((child, idx)=>{
      const el = this.renderNode(child, ctx, locals);
      if(el) wrap.appendChild(el);
    });
    return wrap;
  }
  renderRow(node, ctx, locals){
    const row = document.createElement('div');
    row.className = 'row-block';
    row.style.display = 'flex';
    row.style.gap = `${node.gap ?? 8}px`;
    const columns = node.columns || [];
    columns.forEach(col=>{
      const colWrap = document.createElement('div');
      colWrap.style.flex = String(col.span || 1);
      const child = this.renderNode(col.node, ctx, locals);
      if(child) colWrap.appendChild(child);
      row.appendChild(colWrap);
    });
    return row;
  }
  renderTabs(node, ctx, locals){
    const wrap = document.createElement('div');
    wrap.className = 'tab-card';
    const bar = document.createElement('div');
    bar.className = 'tab-strip';
    const pane = document.createElement('div');
    pane.className = 'tab-pane';
    const tabs = node.tabs || [];
    const setTab = (idx)=>{
      pane.innerHTML = '';
      const tab = tabs[idx];
      if(tab && tab.node){
        const child = this.renderNode(tab.node, ctx, locals);
        if(child) pane.appendChild(child);
      }
      [...bar.children].forEach((btn, i)=> btn.classList.toggle('active', i===idx));
    };
    tabs.forEach((tab, idx)=>{
      const btn = createButton({
        label: tab.label || `Tab ${idx+1}`,
        size: 'small',
        onClick: ()=> setTab(idx)
      });
      bar.appendChild(btn);
    });
    wrap.appendChild(bar);
    wrap.appendChild(pane);
    setTab(0);
    return wrap;
  }
  renderRepeater(node, ctx, locals){
    const resolvedBind = this.resolveBind(node.bind, locals);
    const values = this.readBind(ctx, resolvedBind) || [];
    const wrap = document.createElement('div');
    wrap.className = 'repeater-card';
    if(node.label){
      const title = document.createElement('div');
      title.className = 'small-text';
      title.textContent = node.label;
      wrap.appendChild(title);
    }
    const body = document.createElement('div');
    body.className = 'stack-md';
    values.forEach((item, index)=>{
      const itemLocals = { ...locals, itemPath: `${resolvedBind.slice(1)}.${index}` };
      const row = document.createElement('div');
      row.className = 'repeater-row';
      const child = this.renderNode(node.template, ctx, itemLocals);
      if(child) row.appendChild(child);
      if(this.mode === 'runtime'){
        const del = createButton({
          label: 'Remove',
          size: 'small',
          onClick: ()=> this.store.removeAt(resolvedBind, index)
        });
        row.appendChild(del);
      }
      body.appendChild(row);
    });
    wrap.appendChild(body);
    if(this.mode === 'runtime'){
      const add = createButton({
        label: node.addLabel || 'Add',
        size: 'small',
        onClick: ()=>{
          this.store.transaction(draft=>{
            const list = this.ensureListDraft(draft, resolvedBind);
            list.push(node.initialItem ? clone(node.initialItem) : {});
          });
        }
      });
      wrap.appendChild(add);
    }
    if(values.length===0 && node.emptyText){
      const empty = document.createElement('div');
      empty.className = 'small';
      empty.textContent = node.emptyText;
      body.appendChild(empty);
    }
    return wrap;
  }
  renderField(node, ctx, locals){
    const resolvedBind = this.resolveBind(node.bind, locals);
    const wrap = document.createElement('div');
    wrap.className = 'list-card stack-sm';
    if(node.label){
      const label = document.createElement('div');
      label.className = 'small-text uppercase';
      label.textContent = node.label;
      wrap.appendChild(label);
    }
    switch(node.component){
      case 'input': {
        const input = document.createElement('input');
        input.type = node.inputType || 'text';
        const current = this.readBind(ctx, resolvedBind);
        input.value = current ?? '';
        if(node.placeholder) input.placeholder = node.placeholder;
        if(node.min != null) input.min = node.min;
        if(node.max != null) input.max = node.max;
        input.oninput = (e)=>{
          const val = (input.type === 'number') ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value;
          this.store.write(resolvedBind, val);
        };
        wrap.appendChild(input);
        return wrap;
      }
      case 'text': {
        const div = document.createElement('div');
        let value = '';
        if(node.formula){
          try{
            value = this.formulas.eval(node.formula, { thisCtx: ctx });
          }catch{
            value = '?';
          }
        }else if(node.text){
          value = node.text;
        }else if(resolvedBind){
          value = this.readBind(ctx, resolvedBind) ?? '';
        }
        div.textContent = value;
        wrap.appendChild(div);
        return wrap;
      }
      case 'roller': {
        const btn = createButton({
          label: node.label || 'Roll',
          onClick: ()=>{
            const expr = (node.expr || '1d20').replace(/@([a-zA-Z0-9_$.]+)/g, (_,p)=>{
              const val = this.readPath(ctx, p);
              return Number(val) || 0;
            });
            const result = this.dice.roll(expr);
            if(this.hooks.log){
              this.hooks.log(`${expr} = ${result.total}`);
            }
          }
        });
        wrap.appendChild(btn);
        return wrap;
      }
      case 'toggle': {
        const select = document.createElement('select');
        select.className = 'input-control';
        const options = this.resolveOptions(node);
        options.forEach(opt=>{
          const optEl = document.createElement('option');
          if(typeof opt === 'object'){
            optEl.value = opt.value;
            optEl.textContent = opt.label ?? opt.value;
          }else{
            optEl.value = opt;
            optEl.textContent = opt;
          }
          select.appendChild(optEl);
        });
        const current = this.readBind(ctx, resolvedBind);
        if(current != null) select.value = current;
        select.onchange = ()=> this.store.write(resolvedBind, select.value);
        wrap.appendChild(select);
        return wrap;
      }
      case 'tags': {
        const options = this.resolveOptions(node);
        const current = new Set(this.readBind(ctx, resolvedBind) || []);
        const box = document.createElement('div');
        box.className = 'toolbar';
        options.forEach(opt=>{
          const value = typeof opt === 'object' ? opt.value : opt;
          const label = typeof opt === 'object' ? opt.label ?? opt.value : opt;
          const btn = createButton({
            label,
            size: 'small',
            onClick: ()=>{
              if(current.has(value)) current.delete(value); else current.add(value);
              this.store.write(resolvedBind, Array.from(current));
            }
          });
          if(current.has(value)) btn.classList.add('primary');
          box.appendChild(btn);
        });
        wrap.appendChild(box);
        return wrap;
      }
      case 'clock': {
        const max = node.max || 6;
        const val = Number(this.readBind(ctx, resolvedBind)) || 0;
        const bar = document.createElement('div');
        bar.className = 'badge';
        bar.textContent = `${val}/${max}`;
        if(this.mode === 'runtime'){
          const controls = document.createElement('div');
          controls.className = 'toolbar';
          const dec = createButton({
            label: '-',
            size: 'small',
            ariaLabel: 'Decrease clock',
            onClick: ()=> this.store.write(resolvedBind, Math.max(0, val-1))
          });
          const inc = createButton({
            label: '+',
            size: 'small',
            ariaLabel: 'Increase clock',
            onClick: ()=> this.store.write(resolvedBind, Math.min(max, val+1))
          });
          controls.appendChild(dec); controls.appendChild(inc);
          wrap.appendChild(controls);
        }
        wrap.appendChild(bar);
        return wrap;
      }
      case 'timer': {
        const row = document.createElement('div');
        row.className = 'flex-row gap-sm';
        const out = document.createElement('span');
        out.className = 'badge';
        let timer = this.store.readTimer(resolvedBind);
        if(!timer) timer = { running:false, accum:0, startedAt:null };
        const tick = ()=>{
          const now = Date.now();
          const elapsed = timer.accum + (timer.running && timer.startedAt ? (now - timer.startedAt) : 0);
          out.textContent = this.formatMs(elapsed);
        };
        tick();
        const interval = setInterval(tick, 500);
        this._timers.push(interval);
        const toggle = createButton({
          label: 'Start/Pause',
          size: 'small',
          onClick: ()=>{
            if(timer.running){
              timer = { running:false, accum: timer.accum + (Date.now() - timer.startedAt), startedAt:null };
            }else{
              timer = { running:true, accum: timer.accum, startedAt: Date.now() };
            }
            this.store.updateTimer(resolvedBind, timer);
          }
        });
        const reset = createButton({
          label: 'Reset',
          size: 'small',
          onClick: ()=>{
            timer = { running:false, accum:0, startedAt:null };
            this.store.updateTimer(resolvedBind, timer);
            tick();
          }
        });
        row.appendChild(out);
        row.appendChild(toggle);
        row.appendChild(reset);
        wrap.appendChild(row);
        return wrap;
      }
      default:
        return this.renderUnknown(node);
    }
  }
  renderUnknown(node){
    const wrap = document.createElement('div');
    wrap.className = 'list-card';
    wrap.textContent = `[${node.type || node.component}]`;
    return wrap;
  }
  resolveBind(bind, locals){
    if(!bind) return null;
    if(locals?.itemPath){
      return bind.replace(/^@item/, `@${locals.itemPath}`);
    }
    return bind;
  }
  renderUnknown(node){
    const wrap = document.createElement('div');
    wrap.className = 'card';
    wrap.textContent = `[${node.type || node.component}]`;
    return wrap;
  }
  resolveBind(bind, locals){
    if(!bind) return null;
    if(locals?.itemPath){
      return bind.replace(/^@item/, `@${locals.itemPath}`);
    }
    return bind;
  }
  readBind(ctx, bind){
    if(!bind || !bind.startsWith('@')) return null;
    const parts = bind.slice(1).split('.');
    let node = ctx;
    for(const part of parts){
      if(node==null || typeof node !== 'object') return null;
      node = node[part];
    }
    return node;
  }
  ensureListDraft(draft, bind){
    const parts = bind.slice(1).split('.');
    let node = draft;
    for(let i=0;i<parts.length;i++){
      const key = parts[i];
      if(i === parts.length-1){
        if(!Array.isArray(node[key])) node[key] = [];
        return node[key];
      }
      if(typeof node[key] !== 'object' || node[key] === null){
        node[key] = {};
      }
      node = node[key];
    }
    return [];
  }
  resolveOptions(node){
    if(node.optionsFrom){
      const entry = (this.system.metadata || []).find(m=>m.id === node.optionsFrom);
      if(entry){
        if(Array.isArray(entry.values)) return entry.values;
      }
    }
    return node.options || node.states || [];
  }
  readPath(ctx, path){
    const parts = path.split('.');
    let node = ctx;
    for(const part of parts){
      if(node==null || typeof node !== 'object') return 0;
      node = node[part];
    }
    return node ?? 0;
  }
  formatMs(ms){
    const totalSeconds = Math.floor(ms/1000);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds/60) % 60;
    const hours = Math.floor(totalSeconds/3600);
    return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
  }
}
