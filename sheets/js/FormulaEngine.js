// Very small safe-ish expression eval
// Supports: + - * / % ( ) min max floor ceil round clamp sum avg mod ?:
const clone = (value) => (typeof structuredClone === 'function'
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value)));

export class FormulaEngine{
  constructor(systemIndex){
    this.systemIndex = systemIndex || {};
    this.funcs = {
      min: Math.min,
      max: Math.max,
      floor: Math.floor,
      ceil: Math.ceil,
      round: Math.round,
      mod: (a,b)=>a%b,
      clamp: (x,a,b)=>Math.min(Math.max(x,a),b),
      sum: (arr)=> (arr||[]).reduce((a,b)=>a+(+b||0),0),
      avg: (arr)=> {
        const s=(arr||[]).reduce((a,b)=>a+(+b||0),0);
        return (arr&&arr.length)? s/arr.length : 0;
      }
    };
    this.dependencies = new Map();
  }
  eval(expr, ctx){
    if(expr==null || expr==="") return "";
    const scope = this.buildScope(ctx);
    scope.__read = (path)=> this.#readPath(scope.thisCtx, path);
    const src = this.rewrite(expr);
    const fn = new Function(
      ...Object.keys(scope),
      ...Object.keys(this.funcs),
      `return (${src});`
    );
    return fn(...Object.values(scope), ...Object.values(this.funcs));
  }
  buildScope(ctx){
    return ctx || {};
  }
  rewrite(expr){
    return expr.replace(/@([a-zA-Z0-9_$.]+)/g, (_,p)=>`__read('${p}')`);
  }
  collectRefs(expr){
    const refs = new Set();
    if(!expr) return refs;
    expr.replace(/@([a-zA-Z0-9_$.]+)/g, (_,p)=>{ refs.add(p); return ''; });
    return Array.from(refs);
  }
  analyze(formulas){
    this.dependencies.clear();
    (formulas||[]).forEach(f=>{
      const refs = this.collectRefs(f.expr);
      this.dependencies.set(f.key, refs);
    });
    return new Map(this.dependencies);
  }
  applyFormulas(formulas, ctx){
    const working = clone(ctx || {});
    const entries = (formulas||[]).map(f=>(
      { key:f.key, expr:f.expr, deps:this.collectRefs(f.expr), applied:false }
    ));
    this.analyze(formulas);
    const safety = entries.length ? entries.length * 5 : 5;
    let guard = 0;
    while(entries.some(e=>!e.applied) && guard < safety){
      guard++;
      let progress = false;
      for(const entry of entries){
        if(entry.applied || !entry.expr) continue;
        const ready = entry.deps.every(dep=> this.#hasPath(working, dep));
        if(!ready) continue;
        try{
          const value = this.eval(entry.expr, { thisCtx: working });
          this.#writePath(working, entry.key, value);
          entry.applied = true;
          progress = true;
        }catch{}
      }
      if(!progress) break;
    }
    return working;
  }
  #readPath(ctx, ref){
    if(!ref) return undefined;
    const parts = ref.split('.');
    let node = ctx;
    for(const part of parts){
      if(node==null || typeof node !== 'object') return undefined;
      node = node[part];
    }
    return node;
  }
  #hasPath(ctx, ref){
    return this.#readPath(ctx, ref) !== undefined;
  }
  #writePath(ctx, key, value){
    if(!key) return;
    const parts = key.split('.');
    let node = ctx;
    for(let i=0;i<parts.length-1;i++){
      const part = parts[i];
      if(typeof node[part] !== 'object' || node[part] === null){
        node[part] = {};
      }
      node = node[part];
    }
    node[parts[parts.length-1]] = value;
  }
}
