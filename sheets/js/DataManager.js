export class DataManager{
  constructor(baseUrl){
    this.baseUrl = baseUrl.replace(/\/$/,''); 
  }
  get token(){ return localStorage.getItem('token') || ''; }
  headers(json=true){
    const h = {};
    if(json) h['Content-Type'] = 'application/json';
    if(this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }
  localKey(bucket, id){
    return `sheets:${bucket}:${id}`;
  }
  readLocal(bucket, id){
    const raw = localStorage.getItem(this.localKey(bucket, id));
    if(!raw) return null;
    try{
      return JSON.parse(raw);
    }catch(err){
      console.warn('Failed to parse local payload', bucket, id, err);
      return null;
    }
  }
  saveLocal(bucket, id, payload){
    try{
      localStorage.setItem(this.localKey(bucket, id), JSON.stringify(payload));
      return { ok: true, local: true, id };
    }catch(err){
      console.warn('Local save failed', err);
      return { ok: false, error: 'Local storage full?' };
    }
  }
  async register(email, username, password){
    const r = await fetch(`${this.baseUrl}/auth/register`, {method:'POST', headers:this.headers(), body:JSON.stringify({email, username, password})});
    return await r.json();
  }
  async login(username_or_email, password){
    const r = await fetch(`${this.baseUrl}/auth/login`, {method:'POST', headers:this.headers(), body:JSON.stringify({username_or_email, password})});
    return await r.json();
  }
  async list(bucket){
    try{
      const r = await fetch(`${this.baseUrl}/list/${bucket}`);
      return await r.json();
    }catch(err){
      console.warn('List request failed', bucket, err);
      return { error: 'List unavailable', items: [] };
    }
  }
  async read(bucket, id){
    try{
      const r = await fetch(`${this.baseUrl}/content/${bucket}/${id}`);
      if(r.ok){
        return await r.json();
      }
      try{
        const data = await r.json();
        data.status = r.status;
        return data;
      }catch(err){
        return { error: r.statusText || 'Request failed', status: r.status };
      }
    }catch(err){
      console.warn('Read request failed', bucket, id, err);
      return { error: 'Network unavailable' };
    }
  }
  async save(bucket, id, obj){
    if(!this.token){
      return this.saveLocal(bucket, id, obj);
    }
    let r;
    try{
      r = await fetch(`${this.baseUrl}/content/${bucket}/${id}`, {method:'POST', headers:this.headers(), body:JSON.stringify(obj)});
    }catch(err){
      console.warn('Save request failed, using local fallback', bucket, id, err);
      return this.saveLocal(bucket, id, obj);
    }
    if(r.ok){
      return await r.json();
    }
    const status = r.status;
    let payload = null;
    try{ payload = await r.json(); }
    catch(err){ payload = { error: r.statusText || 'Request failed' }; }
    if(status === 401 || status === 403){
      const fallback = this.saveLocal(bucket, id, obj);
      return { ...fallback, error: payload?.error, status };
    }
    return { error: payload?.error || 'Save failed', status };
  }
  async del(bucket, id){
    const r = await fetch(`${this.baseUrl}/content/${bucket}/${id}/delete`, {method:'POST', headers:this.headers()});
    return await r.json();
  }
  async setPublic(bucket, id, flag=true){
    const r = await fetch(`${this.baseUrl}/content/${bucket}/${id}/public?public=${flag}`, {method:'POST', headers:this.headers(false)});
    return await r.json();
  }
  async share(ctype, content_id, userId, perm='view'){
    const r = await fetch(`${this.baseUrl}/shares`, {method:'POST', headers:this.headers(), body:JSON.stringify({content_type: ctype, content_id, shared_with_user_id: userId, permissions: perm})});
    return await r.json();
  }
  async importer(systemId, importerId, payload, dryRun=true){
    const r = await fetch(`${this.baseUrl}/import/${systemId}/${importerId}`, {method:'POST', headers:this.headers(), body:JSON.stringify({payload, dryRun})});
    return await r.json();
  }
}
