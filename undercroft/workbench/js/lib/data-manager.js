const DEFAULT_STORAGE_PREFIX = "undercroft.workbench";
const GLOBAL_SCOPE = typeof globalThis !== "undefined" ? globalThis : {};

function normalizeBaseUrl(url = "") {
  if (!url) {
    return "";
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function safeJsonParse(value, fallback) {
  if (typeof value !== "string" || !value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn("DataManager: Failed to parse JSON", error);
    return fallback;
  }
}

export class DataManager {
  constructor({
    baseUrl = "",
    storage = "localStorage" in GLOBAL_SCOPE ? GLOBAL_SCOPE.localStorage : null,
    fetchImpl = typeof GLOBAL_SCOPE.fetch === "function" ? GLOBAL_SCOPE.fetch.bind(GLOBAL_SCOPE) : null,
    storagePrefix = DEFAULT_STORAGE_PREFIX,
  } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.storage = storage;
    this.fetchImpl = fetchImpl;
    this.storagePrefix = storagePrefix;
    this._listCache = new Map();
    this._ownedCache = new Map();
    this._sessionKey = `${this.storagePrefix}:session`;
    this._bucketPrefix = `${this.storagePrefix}:bucket:`;
    this._session = this._loadSession();
  }

  setBaseUrl(url) {
    this.baseUrl = normalizeBaseUrl(url);
  }

  _requireFetch() {
    if (!this.fetchImpl) {
      throw new Error("DataManager requires a fetch implementation in this environment");
    }
    return this.fetchImpl;
  }

  _requireStorage() {
    if (!this.storage) {
      throw new Error("DataManager requires a storage implementation in this environment");
    }
    return this.storage;
  }

  _url(path) {
    if (!this.baseUrl) {
      throw new Error("DataManager baseUrl is not configured");
    }
    if (!path.startsWith("/")) {
      return `${this.baseUrl}/${path}`;
    }
    return `${this.baseUrl}${path}`;
  }

  _loadSession() {
    try {
      const stored = this._requireStorage().getItem(this._sessionKey);
      return safeJsonParse(stored, null);
    } catch (error) {
      console.warn("DataManager: Unable to load session", error);
      return null;
    }
  }

  _persistSession(session) {
    const storage = this._requireStorage();
    if (!session) {
      storage.removeItem(this._sessionKey);
      this._session = null;
      return;
    }
    storage.setItem(this._sessionKey, JSON.stringify(session));
    this._session = session;
  }

  get session() {
    return this._session;
  }

  isAuthenticated() {
    return Boolean(this._session && this._session.token);
  }

  setSession(session) {
    this._persistSession(session);
  }

  refreshSessionUser(user) {
    if (!this._session || !this._session.token) {
      return null;
    }
    const nextUser = user ? { ...(this._session.user || {}), ...user } : this._session.user;
    const nextSession = { token: this._session.token, user: nextUser };
    this._persistSession(nextSession);
    return nextUser;
  }

  clearSession() {
    this._persistSession(null);
    this._listCache.clear();
    this._ownedCache.clear();
  }

  _bucketKey(bucket) {
    if (!bucket) {
      throw new Error("Bucket name is required");
    }
    return `${this._bucketPrefix}${bucket}`;
  }

  listLocal(bucket) {
    try {
      const stored = this._requireStorage().getItem(this._bucketKey(bucket));
      const records = safeJsonParse(stored, {});
      return typeof records === "object" && records ? records : {};
    } catch (error) {
      console.warn("DataManager: Unable to load local bucket", bucket, error);
      return {};
    }
  }

  _writeLocal(bucket, records) {
    this._requireStorage().setItem(this._bucketKey(bucket), JSON.stringify(records));
  }

  saveLocal(bucket, id, payload) {
    if (!id) {
      throw new Error("Record id is required");
    }
    const records = this.listLocal(bucket);
    records[id] = payload;
    this._writeLocal(bucket, records);
    return { id, payload };
  }

  removeLocal(bucket, id) {
    const records = this.listLocal(bucket);
    if (id in records) {
      delete records[id];
      this._writeLocal(bucket, records);
    }
  }

  getLocal(bucket, id) {
    const records = this.listLocal(bucket);
    return records[id];
  }

  listLocalEntries(bucket) {
    const records = this.listLocal(bucket);
    return Object.entries(records).map(([id, payload]) => ({ id, payload }));
  }

  async _request(path, { method = "GET", body = undefined, auth = true } = {}) {
    const fetchImpl = this._requireFetch();
    const headers = { "Accept": "application/json" };
    let payload;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    if (auth && this.isAuthenticated()) {
      headers["Authorization"] = `Bearer ${this._session.token}`;
    }
    const response = await fetchImpl(this._url(path), {
      method,
      headers,
      body: payload,
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        console.warn("DataManager: Failed to parse response", error);
      }
    }
    if (!response.ok) {
      const message = data && data.error ? data.error : response.statusText;
      const error = new Error(message || `Request failed with status ${response.status}`);
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data;
  }

  async register(credentials) {
    const session = await this._request("/auth/register", {
      method: "POST",
      body: credentials,
      auth: false,
    });
    if (session && session.token) {
      this._persistSession({ token: session.token, user: session.user });
    }
    return session;
  }

  async verifyRegistration(payload) {
    const session = await this._request("/auth/verify", {
      method: "POST",
      body: payload,
      auth: false,
    });
    if (session && session.token) {
      this._persistSession({ token: session.token, user: session.user });
    }
    return session;
  }

  async login(credentials) {
    const session = await this._request("/auth/login", {
      method: "POST",
      body: credentials,
      auth: false,
    });
    if (session && session.token) {
      this._persistSession({ token: session.token, user: session.user });
    }
    return session;
  }

  async logout() {
    if (!this.isAuthenticated()) {
      return { ok: true };
    }
    try {
      const result = await this._request("/auth/logout", {
        method: "POST",
        body: {},
        auth: true,
      });
      return result;
    } finally {
      this.clearSession();
    }
  }

  async list(bucket, { refresh = false, includeLocal = true } = {}) {
    const cacheKey = `${bucket}`;
    if (!refresh && this._listCache.has(cacheKey)) {
      return this._listCache.get(cacheKey);
    }
    let remote = null;
    try {
      remote = await this._request(`/list/${bucket}`, { method: "GET", auth: true });
    } catch (error) {
      console.warn(`DataManager: Failed to list ${bucket} from server`, error);
    }
    const local = includeLocal ? this.listLocalEntries(bucket) : [];
    const payload = { remote, local };
    this._listCache.set(cacheKey, payload);
    return payload;
  }

  _emit(eventName, detail = {}) {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
      return;
    }
    try {
      window.dispatchEvent(new CustomEvent(eventName, { detail }));
    } catch (error) {
      console.warn("DataManager: failed to dispatch event", eventName, error);
    }
  }

  async get(bucket, id, { preferLocal = true } = {}) {
    if (preferLocal) {
      const local = this.getLocal(bucket, id);
      if (local !== undefined) {
        return { source: "local", payload: local };
      }
    }
    const payload = await this._request(`/content/${bucket}/${id}`, { method: "GET", auth: true });
    return { source: "remote", payload };
  }

  async save(bucket, id, payload, { mode = "auto" } = {}) {
    if (!id) {
      throw new Error("Record id is required");
    }
    if (mode === "local" || (mode === "auto" && !this.isAuthenticated())) {
      this.saveLocal(bucket, id, payload);
      this._listCache.delete(`${bucket}`);
      this._ownedCache.clear();
      this._emit("workbench:content-saved", { bucket, id, payload, source: "local" });
      return { source: "local", id, payload };
    }
    const result = await this._request(`/content/${bucket}/${id}`, {
      method: "POST",
      body: payload,
      auth: true,
    });
    this.saveLocal(bucket, id, payload);
    this._listCache.delete(`${bucket}`);
    this._ownedCache.clear();
    this._emit("workbench:content-saved", { bucket, id, payload, source: "remote", response: result });
    return { source: "remote", response: result, id, payload };
  }

  async delete(bucket, id, { mode = "auto" } = {}) {
    if (!id) {
      throw new Error("Record id is required");
    }
    const shouldTargetRemote = mode === "remote" || (mode === "auto" && this.isAuthenticated());
    if (shouldTargetRemote) {
      await this._request(`/content/${bucket}/${id}/delete`, {
        method: "POST",
        body: {},
        auth: true,
      });
    }
    this.removeLocal(bucket, id);
    this._listCache.delete(`${bucket}`);
    this._ownedCache.clear();
    this._emit("workbench:content-deleted", { bucket, id, source: shouldTargetRemote ? "remote" : "local" });
    return { source: shouldTargetRemote ? "remote" : "local", id };
  }

  async promote(bucket, id) {
    if (!this.isAuthenticated()) {
      throw new Error("Cannot promote without an active session");
    }
    const localPayload = this.getLocal(bucket, id);
    if (localPayload === undefined) {
      throw new Error(`No local payload found for ${bucket}/${id}`);
    }
    return this.save(bucket, id, localPayload, { mode: "remote" });
  }

  async listUsers() {
    return this._request("/auth/users", { method: "GET", auth: true });
  }

  async updateUserTier(username, tier) {
    return this._request("/auth/upgrade", {
      method: "POST",
      body: { username, tier },
      auth: true,
    });
  }

  async deleteUser(username) {
    return this._request("/auth/users/delete", {
      method: "POST",
      body: { username },
      auth: true,
    });
  }

  async updateEmail({ email, password }) {
    const result = await this._request("/auth/profile/email", {
      method: "POST",
      body: { email, password },
      auth: true,
    });
    if (result && result.user) {
      this.refreshSessionUser(result.user);
    }
    return result;
  }

  async updatePassword({ current_password, new_password }) {
    return this._request("/auth/profile/password", {
      method: "POST",
      body: { current_password, new_password },
      auth: true,
    });
  }

  async toggleVisibility(bucket, id, makePublic) {
    const query = makePublic ? "" : "?public=false";
    const result = await this._request(`/content/${bucket}/${id}/public${query}`, {
      method: "POST",
      body: {},
      auth: true,
    });
    this._listCache.delete(`${bucket}`);
    this._ownedCache.clear();
    this._emit("workbench:content-visibility", { bucket, id, public: Boolean(result?.public) });
    return result;
  }

  async listOwnedContent({ username = "", refresh = false } = {}) {
    const key = username ? username.toLowerCase() : "__self__";
    if (!refresh && this._ownedCache.has(key)) {
      return this._ownedCache.get(key);
    }
    const query = username ? `?username=${encodeURIComponent(username)}` : "";
    const payload = await this._request(`/content/owned${query}`, {
      method: "GET",
      auth: true,
    });
    this._ownedCache.set(key, payload);
    return payload;
  }
}

export default DataManager;
