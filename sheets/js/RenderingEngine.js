import { FormulaEngine } from './FormulaEngine.js';
import { DiceEngine } from './DiceEngine.js';

export class RenderingEngine{
  constructor(system, template, character, hooks={}){
    this.system = system;
    this.template = template;
    this.character = character;
    this.hooks = hooks;
    this.formulas = new FormulaEngine();
    this.dice = new DiceEngine();
  }
  mount(container, mode='runtime'){
    container.innerHTML='';
    const ctx = this.buildCtx();
    (this.template.content||[]).forEach(el=>{
      container.appendChild(this.renderElement(el, ctx));
    });
  }
  buildCtx(){
    const data = (this.character && this.character.data) ? this.character.data : this.character || {};
    // Precompute system formulas into ctx.mod.*, etc. (simple pass)
    const ctx = JSON.parse(JSON.stringify(data));
    // crude mod precompute if system has formulas
    (this.system.formulas||[]).forEach(f=>{
      try{
        const val = this.formulas.eval(f.expr, {thisCtx: ctx});
        const path = f.key.split('.');
        let node = ctx;
        for(let i=0;i<path.length-1;i++){ node[path[i]] = node[path[i]]||{}; node = node[path[i]]; }
        node[path[path.length-1]] = val;
      }catch(e){}
    });
    return ctx;
  }
  renderElement(el, ctx){
    if(el.visible){
      try{ if(!this.formulas.eval(el.visible, {thisCtx: ctx})) return document.createComment('hidden'); }catch{}
    }
    const wrap = document.createElement('div'); wrap.className='card';
    const label = el.label ? `<div class="small">${el.label}</div>` : '';
    switch(el.el){
      case 'input': {
        const inp = document.createElement('input');
        inp.type = (el.input||'text');
        inp.value = this.readBind(ctx, el.bind) ?? '';
        inp.onchange = (e)=> this.writeBind(el.bind, e.target.value);
        wrap.innerHTML = label; wrap.appendChild(inp); return wrap;
      }
      case 'text': {
        const p = document.createElement('div');
        let txt = '';
        if(el.formula){ try{ txt = this.formulas.eval(el.formula, {thisCtx: ctx}); }catch{ txt='?'; } }
        wrap.innerHTML = label; p.textContent = txt; wrap.appendChild(p); return wrap;
      }
      case 'roller': {
        const btn = document.createElement('button'); btn.className='btn'; btn.textContent= el.label || 'Roll';
        btn.onclick = ()=>{
          const expr = (el.expr||'1d20').replace(/@([a-z0-9_$.]+)/ig,(m,p)=>{
            const v = this.readBind(ctx, '@'+p); return (typeof v==='number'? v : 0);
          });
          const res = this.dice.roll(expr);
          alert(`${expr} = ${res.total}`);
        };
        wrap.appendChild(btn); return wrap;
      }
      case 'container': {
        const c = document.createElement('div');
        if(el.children){ el.children.forEach(ch=> c.appendChild(this.renderElement(ch, ctx))); }
        wrap.appendChild(c); return wrap;
      }
      case 'tabs': {
        const tabs = document.createElement('div');
        const bar = document.createElement('div'); bar.className='tabbar';
        const pane = document.createElement('div');
        const setTab = (idx)=>{
          pane.innerHTML=''; (el.tabs[idx].content||[]).forEach(ch=> pane.appendChild(this.renderElement(ch, ctx)));
          [...bar.children].forEach((b,i)=> b.classList.toggle('active', i===idx));
        };
        (el.tabs||[]).forEach((t,i)=>{
          const b=document.createElement('button'); b.textContent=t.label; b.onclick=()=>setTab(i); bar.appendChild(b);
        });
        tabs.appendChild(bar); tabs.appendChild(pane); wrap.appendChild(tabs); setTab(0); return wrap;
      }
      case 'list': {
        const box = document.createElement('div');
        const arr = this.readBind(ctx, el.bind) || [];
        arr.forEach((item, idx)=>{
          const row = document.createElement('div'); row.className='grid3';
          (el.item?.content||[]).forEach(ch=>{
            const inst = JSON.parse(JSON.stringify(ch));
            if(inst.bind?.startsWith('item.')) inst.bind = el.bind + '.' + inst.bind.slice(5);
            row.appendChild(this.renderElement(inst, ctx));
          });
          box.appendChild(row);
        });
        // controls
        const add = document.createElement('button'); add.className='btn small'; add.textContent='Add';
        add.onclick = ()=>{
          const arr = this.ensureArrayPath(el.bind);
          arr.push({});
          location.reload();
        };
        if(el.allowAdd!==false) box.appendChild(add);
        wrap.appendChild(box); return wrap;
      }
      case 'toggle': {
        const sel = document.createElement('select');
        (el.states||[]).forEach(s=>{
          const o = document.createElement('option'); o.value=s; o.textContent=s; sel.appendChild(o);
        });
        sel.value = this.readBind(ctx, el.bind) ?? (el.states?.[0]||"");
        sel.onchange = ()=> this.writeBind(el.bind, sel.value);
        wrap.innerHTML = label; wrap.appendChild(sel); return wrap;
      }
      case 'tags': {
        const options = Array.isArray(el.options)? el.options : [];
        const current = new Set(this.readBind(ctx, el.bind) || []);
        const box = document.createElement('div');
        options.forEach(opt=>{
          const b = document.createElement('button'); b.className='btn small'; b.textContent=opt;
          b.classList.toggle('primary', current.has(opt));
          b.onclick = ()=>{ if(current.has(opt)) current.delete(opt); else current.add(opt);
            this.writeBind(el.bind, Array.from(current)); b.classList.toggle('primary'); };
          box.appendChild(b);
        });
        wrap.innerHTML = label; wrap.appendChild(box); return wrap;
      }
      case 'clock': {
        const max = el.max || 6;
        const val = this.readBind(ctx, el.bind) || 0;
        const b = document.createElement('div'); b.textContent = `Clock: ${val}/${max}`;
        wrap.innerHTML = label; wrap.appendChild(b); return wrap;
      }
      case 'timer': {
        const state = this.character?.state?.timers || {};
        const path = el.bind || '@timers.timer';
        const row = document.createElement('div');
        const out = document.createElement('span'); out.style.marginRight='8px';
        let running=false, accum=0, startedAt=null;
        const cur = this.readStateTimer(path);
        if(cur){ running = cur.running; accum = cur.accum; startedAt = cur.startedAt; }
        const tick = ()=>{
          const now = Date.now();
          const ms = accum + (running && startedAt ? (now - startedAt) : 0);
          out.textContent = msFormat(ms);
        };
        const msFormat = (ms)=>{
          const s = Math.floor(ms/1000); const m = Math.floor(s/60); const h = Math.floor(m/60);
          return `${String(h).padStart(2,'0')}:${String(m%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
        };
        const i = setInterval(tick, 500); tick();
        const btnStart = document.createElement('button'); btnStart.className='btn small'; btnStart.textContent='Start/Pause';
        btnStart.onclick = ()=>{
          if(!running){ running=true; startedAt=Date.now(); }
          else { running=false; accum = accum + (Date.now()-startedAt); startedAt=null; }
          this.writeStateTimer(path, {running, accum, startedAt});
        };
        const btnReset = document.createElement('button'); btnReset.className='btn small'; btnReset.textContent='Reset';
        btnReset.onclick = ()=>{ running=false; accum=0; startedAt=null; this.writeStateTimer(path, {running,accum,startedAt}); tick(); };
        row.appendChild(out); row.appendChild(btnStart); row.appendChild(btnReset);
        wrap.innerHTML = label; wrap.appendChild(row); return wrap;
      }
      default:
        wrap.textContent = `[${el.el}] not implemented`; return wrap;
    }
  }
  readBind(ctx, bind){
    if(!bind || !bind.startsWith('@')) return null;
    const path = bind.slice(1).split('.'); let node = ctx;
    for(const k of path){ if(node==null) return null; node = node[k]; }
    return node;
  }
  ensureArrayPath(bind){
    const ch = this.character;
    const path = bind.slice(1).split('.');
    let node = ch.data; for(let i=0;i<path.length;i++){ const k=path[i]; if(!node[k]) node[k]=(i===path.length-1? [] : {}); node=node[k]; }
    return node;
  }
  writeBind(bind, value){
    if(!this.character) return;
    if(!bind || !bind.startsWith('@')) return;
    const path = bind.slice(1).split('.');
    let node = this.character.data || (this.character.data={});
    for(let i=0;i<path.length-1;i++){ const k=path[i]; node[k] = node[k] || {}; node = node[k]; }
    node[path[path.length-1]] = value;
    // NOTE: persist is caller's job
  }
  readStateTimer(bind){
    const ch = this.character;
    const key = bind.slice(1).split('.').slice(1).join('.'); // drop 'timers.'
    const t = (ch.state && ch.state.timers) ? ch.state.timers[key] : null;
    return t || null;
  }
  writeStateTimer(bind, obj){
    const ch = this.character;
    const key = bind.slice(1).split('.').slice(1).join('.');
    if(!ch.state) ch.state = {}; if(!ch.state.timers) ch.state.timers = {};
    ch.state.timers[key] = obj;
  }
}
