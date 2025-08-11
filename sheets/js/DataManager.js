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
  async register(email, username, password){
    const r = await fetch(`${this.baseUrl}/auth/register`, {method:'POST', headers:this.headers(), body:JSON.stringify({email, username, password})});
    return await r.json();
  }
  async login(username_or_email, password){
    const r = await fetch(`${this.baseUrl}/auth/login`, {method:'POST', headers:this.headers(), body:JSON.stringify({username_or_email, password})});
    return await r.json();
  }
  async list(bucket){ const r = await fetch(`${this.baseUrl}/list/${bucket}`); return await r.json(); }
  async read(bucket, id){ const r = await fetch(`${this.baseUrl}/content/${bucket}/${id}`); return await r.json(); }
  async save(bucket, id, obj){
    const r = await fetch(`${this.baseUrl}/content/${bucket}/${id}`, {method:'POST', headers:this.headers(), body:JSON.stringify(obj)});
    return await r.json();
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
