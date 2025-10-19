const DEFAULT_STORAGE_PREFIX = "undercroft.workbench";
const GLOBAL_SCOPE = typeof globalThis !== "undefined" ? globalThis : {};

const ROLE_ORDER = ["free", "player", "gm", "master", "creator", "admin"];
const ANONYMOUS_SCOPE = "anonymous";
const ROLE_LABELS = {
  free: "Free",
  player: "Player",
  gm: "GM",
  master: "Master",
  creator: "Creator",
  admin: "Admin",
};

const WRITE_ROLE_REQUIREMENTS = {
  characters: "free",
  templates: "gm",
  systems: "creator",
};

function normalizeTier(tier) {
  return tier ? String(tier).trim().toLowerCase() : "";
}

function roleRank(role) {
  const normalized = normalizeTier(role);
  return ROLE_ORDER.indexOf(normalized);
}

function formatTierLabel(tier) {
  const normalized = normalizeTier(tier);
  if (!normalized) {
    return "";
  }
  if (ROLE_LABELS[normalized]) {
    return ROLE_LABELS[normalized];
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function normalizeUsername(username) {
  return typeof username === "string" ? username.trim().toLowerCase() : "";
}

function computeScopeKey(session) {
  const user = session?.user;
  if (!user) {
    return ANONYMOUS_SCOPE;
  }
  const username = normalizeUsername(user.username);
  const rawId = user.id;
  const idPart = rawId === undefined || rawId === null ? "" : String(rawId);
  if (!username && !idPart) {
    return ANONYMOUS_SCOPE;
  }
  return [username || "user", idPart].filter(Boolean).join("#");
}

function snapshotOwner(user, tier) {
  if (!user) {
    return null;
  }
  const username = typeof user.username === "string" ? user.username : "";
  const id = user.id === undefined || user.id === null ? null : user.id;
  const normalizedTier = normalizeTier(tier || user.tier);
  if (!username && (id === null || id === undefined) && !normalizedTier) {
    return null;
  }
  return {
    id,
    username,
    tier: normalizedTier,
  };
}

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
    this._legacyBucketPrefix = `${this.storagePrefix}:bucket`;
    this._session = this._loadSession();
    this._scope = computeScopeKey(this._session);
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
      this._scope = computeScopeKey(null);
      this._listCache.clear();
      this._ownedCache.clear();
      return;
    }
    storage.setItem(this._sessionKey, JSON.stringify(session));
    this._session = session;
    this._scope = computeScopeKey(session);
    this._listCache.clear();
    this._ownedCache.clear();
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

  getUserTier(defaultTier = "free") {
    const sessionTier = this._session?.user?.tier;
    const normalized = normalizeTier(sessionTier);
    if (normalized) {
      return normalized;
    }
    const fallback = normalizeTier(defaultTier);
    return fallback || "free";
  }

  getRequiredTier(bucket) {
    const requirement = WRITE_ROLE_REQUIREMENTS[bucket];
    return requirement ? normalizeTier(requirement) : "";
  }

  describeRequiredWriteTier(bucket) {
    const requirement = this.getRequiredTier(bucket);
    return requirement ? this.describeTier(requirement) : "";
  }

  hasWriteAccess(bucket) {
    const requirement = this.getRequiredTier(bucket);
    return this.meetsTier(requirement);
  }

  meetsTier(requiredTier) {
    const requirement = normalizeTier(requiredTier);
    if (!requirement) {
      return true;
    }
    const requiredRank = roleRank(requirement);
    if (requiredRank < 0) {
      return true;
    }
    const userRank = roleRank(this.getUserTier());
    return userRank >= requiredRank;
  }

  describeTier(tier) {
    return formatTierLabel(tier);
  }

  canSyncToServer(bucket) {
    return Boolean(this.baseUrl) && this.isAuthenticated() && this.hasWriteAccess(bucket);
  }

  clearSession() {
    this._persistSession(null);
    this._listCache.clear();
    this._ownedCache.clear();
  }

  _bucketKey(bucket, scope = this._scope) {
    if (!bucket) {
      throw new Error("Bucket name is required");
    }
    const activeScope = scope || ANONYMOUS_SCOPE;
    return `${this._bucketPrefix}${bucket}:${activeScope}`;
  }

  _legacyBucketKey(bucket) {
    if (!bucket) {
      throw new Error("Bucket name is required");
    }
    return `${this._legacyBucketPrefix}${bucket}`;
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

  _readLegacyRecords(bucket) {
    try {
      const stored = this._requireStorage().getItem(this._legacyBucketKey(bucket));
      const records = safeJsonParse(stored, {});
      return typeof records === "object" && records ? records : {};
    } catch (error) {
      console.warn("DataManager: Unable to load legacy bucket", bucket, error);
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
    const owner = snapshotOwner(this._session?.user, this.getUserTier());
    const existing = records[id];
    const createdAt =
      existing && typeof existing === "object" && existing.createdAt ? existing.createdAt : new Date().toISOString();
    records[id] = {
      payload,
      owner,
      scope: this._scope,
      createdAt,
      updatedAt: new Date().toISOString(),
    };
    this._writeLocal(bucket, records);
    this._purgeLegacyRecord(bucket, id);
    return { id, payload };
  }

  removeLocal(bucket, id) {
    const records = this.listLocal(bucket);
    if (id in records) {
      delete records[id];
      this._writeLocal(bucket, records);
    }
    this._purgeLegacyRecord(bucket, id);
  }

  getLocal(bucket, id) {
    const records = this.listLocal(bucket);
    const entry = records[id];
    if (entry !== undefined) {
      return this._normalizeLocalEntry(entry, { fallbackScope: this._scope }).payload;
    }
    if (this._scope === ANONYMOUS_SCOPE) {
      const legacyRecords = this._readLegacyRecords(bucket);
      if (legacyRecords && legacyRecords[id] !== undefined) {
        return this._normalizeLocalEntry(legacyRecords[id], { fallbackScope: "legacy" }).payload;
      }
    }
    return undefined;
  }

  listLocalEntries(bucket) {
    const records = this.listLocal(bucket);
    const entries = [];
    const seen = new Set();
    Object.entries(records).forEach(([id, raw]) => {
      const normalized = this._normalizeLocalEntry(raw, { fallbackScope: this._scope });
      entries.push({ id, payload: normalized.payload, owner: normalized.owner, scope: normalized.scope });
      seen.add(id);
    });
    if (this._scope === ANONYMOUS_SCOPE) {
      const legacyRecords = this._readLegacyRecords(bucket);
      Object.entries(legacyRecords).forEach(([id, raw]) => {
        if (seen.has(id)) {
          return;
        }
        const normalized = this._normalizeLocalEntry(raw, { fallbackScope: "legacy" });
        entries.push({ id, payload: normalized.payload, owner: normalized.owner, scope: normalized.scope });
      });
    }
    return entries;
  }

  _normalizeLocalEntry(entry, { fallbackScope = null } = {}) {
    if (!entry || typeof entry !== "object") {
      return { payload: entry, owner: null, scope: fallbackScope, createdAt: null, updatedAt: null };
    }
    if (Object.prototype.hasOwnProperty.call(entry, "payload")) {
      const owner = entry.owner && typeof entry.owner === "object" ? { ...entry.owner } : null;
      if (owner) {
        owner.username = typeof owner.username === "string" ? owner.username : "";
        owner.tier = normalizeTier(owner.tier);
        if (owner.id === undefined) {
          owner.id = null;
        }
      }
      const scope = typeof entry.scope === "string" && entry.scope ? entry.scope : fallbackScope;
      const createdAt = typeof entry.createdAt === "string" ? entry.createdAt : null;
      const updatedAt = typeof entry.updatedAt === "string" ? entry.updatedAt : null;
      return { payload: entry.payload, owner, scope, createdAt, updatedAt };
    }
    return { payload: entry, owner: null, scope: fallbackScope, createdAt: null, updatedAt: null };
  }

  _purgeLegacyRecord(bucket, id) {
    if (!id) {
      return;
    }
    try {
      const storage = this._requireStorage();
      const legacyKey = this._legacyBucketKey(bucket);
      const stored = storage.getItem(legacyKey);
      if (!stored) {
        return;
      }
      const records = safeJsonParse(stored, {});
      if (!records || typeof records !== "object" || !Object.prototype.hasOwnProperty.call(records, id)) {
        return;
      }
      delete records[id];
      storage.setItem(legacyKey, JSON.stringify(records));
    } catch (error) {
      console.warn("DataManager: Unable to purge legacy record", bucket, id, error);
    }
  }

  localEntryBelongsToCurrentUser(entry) {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    if (!this.isAuthenticated()) {
      return true;
    }
    const owner = entry.owner;
    if (!owner || typeof owner !== "object") {
      return false;
    }
    const sessionUser = this._session?.user;
    if (!sessionUser) {
      return false;
    }
    if (owner.id !== undefined && owner.id !== null && sessionUser.id !== undefined && sessionUser.id !== null) {
      if (String(owner.id) === String(sessionUser.id)) {
        return true;
      }
    }
    if (owner.username && sessionUser.username) {
      if (owner.username.toLowerCase() === sessionUser.username.toLowerCase()) {
        return true;
      }
    }
    return false;
  }

  adoptLegacyRecords(bucket, ids = []) {
    if (!Array.isArray(ids) || !ids.length) {
      return [];
    }
    if (!this.isAuthenticated()) {
      return [];
    }
    let storage;
    try {
      storage = this._requireStorage();
    } catch (error) {
      console.warn("DataManager: Unable to adopt legacy records", bucket, error);
      return [];
    }
    const legacyKey = this._legacyBucketKey(bucket);
    const legacyRaw = storage.getItem(legacyKey);
    if (!legacyRaw) {
      return [];
    }
    const legacyRecords = safeJsonParse(legacyRaw, {});
    if (!legacyRecords || typeof legacyRecords !== "object") {
      return [];
    }
    const scopedRecords = this.listLocal(bucket);
    const adopted = [];
    const owner = snapshotOwner(this._session?.user, this.getUserTier());
    let legacyMutated = false;
    ids.forEach((rawId) => {
      const id = typeof rawId === "string" ? rawId.trim() : String(rawId || "").trim();
      if (!id || !Object.prototype.hasOwnProperty.call(legacyRecords, id)) {
        return;
      }
      const normalized = this._normalizeLocalEntry(legacyRecords[id], { fallbackScope: "legacy" });
      scopedRecords[id] = {
        payload: normalized.payload,
        owner,
        scope: this._scope,
        createdAt: normalized.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      adopted.push({ id, payload: normalized.payload, owner });
      delete legacyRecords[id];
      legacyMutated = true;
    });
    if (adopted.length) {
      this._writeLocal(bucket, scopedRecords);
    }
    if (legacyMutated) {
      storage.setItem(legacyKey, JSON.stringify(legacyRecords));
    }
    return adopted;
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
      remote = this._normalizeListPayload(remote);
    } catch (error) {
      console.warn(`DataManager: Failed to list ${bucket} from server`, error);
    }
    const local = includeLocal ? this.listLocalEntries(bucket) : [];
    const payload = { remote, local };
    this._listCache.set(cacheKey, payload);
    return payload;
  }

  _normalizeListPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return payload;
    }
    const result = { ...payload };
    const aggregated = [];
    const seen = new Set();
    const addEntries = (entries) => {
      if (!Array.isArray(entries)) {
        return;
      }
      entries.forEach((entry) => {
        if (!entry || typeof entry !== "object") {
          return;
        }
        const entryId = entry.id;
        if (entryId && seen.has(entryId)) {
          return;
        }
        if (entryId) {
          seen.add(entryId);
        }
        aggregated.push(entry);
      });
    };
    ["owned", "shared", "items"].forEach((key) => addEntries(result[key]));
    result.items = aggregated;
    return result;
  }

  collectListEntries(payload, keys = ["items", "owned", "shared", "public"]) {
    if (!payload || typeof payload !== "object") {
      return [];
    }
    const groups = Array.isArray(keys) && keys.length ? keys : ["items", "owned", "shared", "public"];
    const seen = new Set();
    const entries = [];
    const coerceId = (value) => {
      if (typeof value === "string") {
        return value.trim();
      }
      if (value === null || value === undefined) {
        return "";
      }
      return String(value).trim();
    };
    groups.forEach((key) => {
      const group = payload[key];
      if (!Array.isArray(group)) {
        return;
      }
      group.forEach((entry) => {
        if (!entry || typeof entry !== "object") {
          return;
        }
        const id = coerceId(entry.id);
        if (!id || seen.has(id)) {
          return;
        }
        seen.add(id);
        entries.push({ ...entry, id });
      });
    });
    return entries;
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

  async get(bucket, id, { preferLocal = true, shareToken = "" } = {}) {
    const token = shareToken ? String(shareToken) : "";
    if (preferLocal && !token) {
      const local = this.getLocal(bucket, id);
      if (local !== undefined) {
        return { source: "local", payload: local };
      }
    }
    const query = token ? `?share=${encodeURIComponent(token)}` : "";
    const payload = await this._request(`/content/${bucket}/${id}${query}`, { method: "GET", auth: true });
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

  async updateContentOwner(bucket, id, username) {
    if (!username) {
      throw new Error("Username is required");
    }
    const result = await this._request(`/content/${bucket}/${id}/owner`, {
      method: "POST",
      body: { username },
      auth: true,
    });
    this._listCache.delete(`${bucket}`);
    this._ownedCache.clear();
    return result;
  }

  async listOwnedContent({ username = "", scope = "", refresh = false } = {}) {
    const normalizedScope = scope === "all" ? "all" : "";
    const key = normalizedScope === "all"
      ? "__all__"
      : username
        ? username.toLowerCase()
        : "__self__";
    if (!refresh && this._ownedCache.has(key)) {
      return this._ownedCache.get(key);
    }
    const params = new URLSearchParams();
    if (normalizedScope === "all") {
      params.set("scope", "all");
    } else if (username) {
      params.set("username", username);
    }
    const query = params.toString();
    const payload = await this._request(`/content/owned${query ? `?${query}` : ""}`, {
      method: "GET",
      auth: true,
    });
    this._ownedCache.set(key, payload);
    return payload;
  }

  async listBuiltins() {
    return this._request("/content/builtins", { method: "GET" });
  }

  async listShares(contentType, contentId) {
    if (!contentType || !contentId) {
      throw new Error("contentType and contentId are required");
    }
    return this._request(`/shares/${contentType}/${contentId}`, { method: "GET", auth: true });
  }

  async shareWithUser({ contentType, contentId, username, permissions = "view" } = {}) {
    if (!contentType || !contentId || !username) {
      throw new Error("contentType, contentId, and username are required");
    }
    const result = await this._request("/shares", {
      method: "POST",
      body: {
        content_type: contentType,
        content_id: contentId,
        username,
        permissions,
      },
      auth: true,
    });
    this._emit("workbench:content-share", {
      bucket: contentType,
      id: contentId,
      username,
      permissions,
      action: "grant",
    });
    return result;
  }

  async revokeShare({ contentType, contentId, username } = {}) {
    if (!contentType || !contentId || !username) {
      throw new Error("contentType, contentId, and username are required");
    }
    const result = await this._request("/shares/revoke", {
      method: "POST",
      body: {
        content_type: contentType,
        content_id: contentId,
        username,
      },
      auth: true,
    });
    this._emit("workbench:content-share", {
      bucket: contentType,
      id: contentId,
      username,
      action: "revoke",
    });
    return result;
  }

  async listEligibleShareUsers({ contentType, contentId } = {}) {
    if (!contentType || !contentId) {
      throw new Error("contentType and contentId are required");
    }
    try {
      return await this._request(`/shares/${contentType}/${contentId}/eligible`, {
        method: "GET",
        auth: true,
      });
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && error.status === 404) {
        const params = new URLSearchParams({
          content_type: contentType,
          content_id: contentId,
        });
        return this._request(`/shares/eligible?${params.toString()}`, { method: "GET", auth: true });
      }
      throw error;
    }
  }

  async createShareLink({ contentType, contentId, permissions = "view" } = {}) {
    if (!contentType || !contentId) {
      throw new Error("contentType and contentId are required");
    }
    let result;
    try {
      result = await this._request(`/shares/${contentType}/${contentId}/link`, {
        method: "POST",
        body: { permissions },
        auth: true,
      });
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && error.status === 404) {
        result = await this._request("/shares/link", {
          method: "POST",
          body: {
            content_type: contentType,
            content_id: contentId,
            permissions,
          },
          auth: true,
        });
      } else {
        throw error;
      }
    }
    this._emit("workbench:content-share-link", {
      bucket: contentType,
      id: contentId,
      action: "created",
    });
    return result;
  }

  async revokeShareLink({ contentType, contentId } = {}) {
    if (!contentType || !contentId) {
      throw new Error("contentType and contentId are required");
    }
    let result;
    try {
      result = await this._request(`/shares/${contentType}/${contentId}/link/revoke`, {
        method: "POST",
        body: {},
        auth: true,
      });
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && error.status === 404) {
        result = await this._request("/shares/link/revoke", {
          method: "POST",
          body: {
            content_type: contentType,
            content_id: contentId,
          },
          auth: true,
        });
      } else {
        throw error;
      }
    }
    this._emit("workbench:content-share-link", {
      bucket: contentType,
      id: contentId,
      action: "revoked",
    });
    return result;
  }
}

export default DataManager;
