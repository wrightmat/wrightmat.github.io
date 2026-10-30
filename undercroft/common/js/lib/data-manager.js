const DEFAULT_STORAGE_PREFIX = "undercroft";
export const DEFAULT_SESSION_KEY = "undercroft.session";

// For plain fetch() calls outside DataManager that hit routes requiring a login.
export function sessionAuthHeaders() {
  try {
    const token = JSON.parse(globalThis.localStorage?.getItem(DEFAULT_SESSION_KEY))?.token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch (error) {
    return {};
  }
}
// Same "shared, unprefixed" trick as the session key — every tool's
// DataManager instance uses its own storagePrefix for local content, but
// login state (and now the active campaign selection) has to be visible
// identically across every tool without re-picking it per page.
const DEFAULT_ACTIVE_GROUP_KEY = "undercroft.activeGroup";
const DEFAULT_ACTIVE_THREAD_KEY = "undercroft.activeThread";
const GLOBAL_SCOPE = typeof globalThis !== "undefined" ? globalThis : {};

// Exported (not just used internally by getRequiredTier/hasWriteAccess below)
// so account.js can derive its own owner-tier check from the exact same data
// instead of keeping a second, independently-drifting copy — see that file's
// tierMeetsOwnerRequirement.
export const ROLE_ORDER = ["free", "player", "gm", "creator", "admin"];
const ANONYMOUS_SCOPE = "anonymous";
const ROLE_LABELS = {
  free: "Free",
  player: "Player",
  gm: "GM",
  creator: "Creator",
  admin: "Admin",
};

export const WRITE_ROLE_REQUIREMENTS = {
  characters: "free",
  templates: "gm",
  systems: "creator",
};

function normalizeTier(tier) {
  return tier ? String(tier).trim().toLowerCase() : "";
}

// Exported alongside ROLE_ORDER/WRITE_ROLE_REQUIREMENTS for the same reason —
// see account.js's tierMeetsOwnerRequirement.
export function roleRank(role) {
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

function normalizeSessionUser(user) {
  if (!user || typeof user !== "object") {
    return null;
  }
  const normalized = { ...user };
  normalized.username = typeof normalized.username === "string" ? normalized.username.trim() : "";
  if (normalized.id === undefined) {
    normalized.id = null;
  }
  if (normalized.tier !== undefined) {
    const tier = normalizeTier(normalized.tier);
    normalized.tier = tier || "";
  }
  return normalized;
}

function sanitizeSession(rawSession) {
  if (!rawSession || typeof rawSession !== "object") {
    return null;
  }
  const token = typeof rawSession.token === "string" ? rawSession.token.trim() : "";
  if (!token) {
    return null;
  }
  const user = normalizeSessionUser(rawSession.user);
  return { token, user };
}

export class DataManager {
  constructor({
    baseUrl = "",
    storage = "localStorage" in GLOBAL_SCOPE ? GLOBAL_SCOPE.localStorage : null,
    fetchImpl = typeof GLOBAL_SCOPE.fetch === "function" ? GLOBAL_SCOPE.fetch.bind(GLOBAL_SCOPE) : null,
    storagePrefix = DEFAULT_STORAGE_PREFIX,
    sessionStorageKey = DEFAULT_SESSION_KEY,
  } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.storage = storage;
    this.fetchImpl = fetchImpl;
    this.storagePrefix = storagePrefix;
    this._listCache = new Map();
    this._ownedCache = new Map();
    this._groupCache = null;
    this._sessionKey = sessionStorageKey || DEFAULT_SESSION_KEY;
    this._legacySessionKey =
      this._sessionKey && `${this.storagePrefix}:session` !== this._sessionKey
        ? `${this.storagePrefix}:session`
        : null;
    this._bucketPrefix = `${this.storagePrefix}:bucket:`;
    this._legacyBucketPrefix = `${this.storagePrefix}:bucket`;
    this._session = this._loadSession();
    this._scope = computeScopeKey(this._session);
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
      const storage = this._requireStorage();
      const stored = storage.getItem(this._sessionKey);
      const parsed = safeJsonParse(stored, null);
      const sanitized = sanitizeSession(parsed);
      if (sanitized) {
        return sanitized;
      }
      if (this._legacySessionKey) {
        const legacyStored = storage.getItem(this._legacySessionKey);
        const legacyParsed = safeJsonParse(legacyStored, null);
        const legacySanitized = sanitizeSession(legacyParsed);
        if (legacySanitized) {
          storage.setItem(this._sessionKey, JSON.stringify(legacySanitized));
          storage.removeItem(this._legacySessionKey);
          return legacySanitized;
        }
      }
      return null;
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
      this._groupCache = null;
      this.setActiveGroup(null);
      return;
    }
    const sanitized = sanitizeSession(session);
    if (!sanitized) {
      storage.removeItem(this._sessionKey);
      this._session = null;
      this._scope = computeScopeKey(null);
      this._listCache.clear();
      this._ownedCache.clear();
      this._groupCache = null;
      this.setActiveGroup(null);
      return;
    }
    storage.setItem(this._sessionKey, JSON.stringify(sanitized));
    this._session = sanitized;
    this._scope = computeScopeKey(sanitized);
    this._listCache.clear();
    this._ownedCache.clear();
    this._groupCache = null;
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
    return this._session ? this._session.user : null;
  }

  // "Open a group" once and every tool/page sees the same selection —
  // shared, unprefixed storage, same as the session key. Cleared
  // automatically on logout (see _persistSession above).
  getActiveGroup() {
    try {
      const storage = this._requireStorage();
      const stored = storage.getItem(DEFAULT_ACTIVE_GROUP_KEY);
      const parsed = safeJsonParse(stored, null);
      if (!parsed || typeof parsed !== "object" || !parsed.groupId) {
        return null;
      }
      return { groupId: String(parsed.groupId), name: parsed.name || "" };
    } catch (error) {
      return null;
    }
  }

  // A true no-op (same groupId AND name already active) skips both the
  // write AND the event entirely. Without this, listeners of
  // "workbench:active-group-changed" (dashboard.js's renderWidgets(),
  // auth-ui.js's resyncActiveGroup) can call setActiveGroup again in
  // response to the very event that woke them, re-triggering the same
  // listener chain indefinitely — dashboard.js tearing down and rebuilding
  // every widget's live-stream connection on each firing was why Character/
  // Combat Tracker updates landed late or not at all. Comparing here, once,
  // at the single source of the event, is more robust than making every
  // current and future listener individually idempotent.
  setActiveGroup(groupId, name = "") {
    const storage = this._requireStorage();
    const current = this.getActiveGroup();
    if (!groupId) {
      if (!current) return null;
      storage.removeItem(DEFAULT_ACTIVE_GROUP_KEY);
      this._emit("workbench:active-group-changed", { groupId: null, name: "" });
      return null;
    }
    const entry = { groupId: String(groupId), name: name || "" };
    if (current && current.groupId === entry.groupId && current.name === entry.name) {
      return current;
    }
    storage.setItem(DEFAULT_ACTIVE_GROUP_KEY, JSON.stringify(entry));
    this._emit("workbench:active-group-changed", entry);
    return entry;
  }

  // The thread rolls and other system messages land in — shared across tools
  // in this browser like the active group, and only meaningful for the
  // active group (a stale group's thread reads as "none", so callers fall
  // back to the group's default thread).
  getActiveThread() {
    try {
      const parsed = safeJsonParse(this._requireStorage().getItem(DEFAULT_ACTIVE_THREAD_KEY), null);
      const group = this.getActiveGroup();
      if (!parsed || !parsed.threadId || !group || parsed.groupId !== group.groupId) {
        return null;
      }
      return { groupId: parsed.groupId, threadId: String(parsed.threadId), label: parsed.label || "" };
    } catch (error) {
      return null;
    }
  }

  setActiveThread(groupId, threadId, label = "") {
    const storage = this._requireStorage();
    const current = this.getActiveThread();
    if (!groupId || !threadId) {
      if (!current) return null;
      storage.removeItem(DEFAULT_ACTIVE_THREAD_KEY);
      this._emit("undercroft:active-thread-changed", { groupId: null, threadId: null, label: "" });
      return null;
    }
    const entry = { groupId: String(groupId), threadId: String(threadId), label: label || "" };
    if (current && current.threadId === entry.threadId && current.label === entry.label) {
      return current;
    }
    storage.setItem(DEFAULT_ACTIVE_THREAD_KEY, JSON.stringify(entry));
    this._emit("undercroft:active-thread-changed", entry);
    return entry;
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

  // Browsers disagree on how a full storage quota surfaces (Chrome/Edge/
  // Safari: "QuotaExceededError"; older Firefox: "NS_ERROR_DOM_QUOTA_
  // REACHED"; both also expose legacy code 22) — checked defensively across all.
  _isQuotaExceededError(error) {
    return Boolean(error) && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED" || error.code === 22);
  }

  // For a signed-in user the local bucket cache is entirely disposable — the
  // server copy is authoritative, and listLocal/getLocal transparently
  // re-hydrate from an empty bucket. Safe way to recover room after a
  // QuotaExceededError, unlike removeLocal (drops only one record).
  clearLocalBucket(bucket) {
    try {
      this._writeLocal(bucket, {});
    } catch (error) {
      console.warn("DataManager: unable to clear local bucket", bucket, error);
    }
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
      // The server sends no Cache-Control on ordinary /content GETs (only
      // the SSE stream route sets one) — without this, a browser's own HTTP
      // cache heuristics can serve a STALE response for a repeated GET to
      // the exact same URL (e.g. map-live-sync.js's poll re-fetching
      // `/content/map/{id}` every 10-20s), which looked exactly like a
      // save "not taking effect" until a hard refresh forced revalidation.
      // Every caller of this DataManager always wants the real current
      // state (its own preferLocal option already covers the "it's fine to
      // reuse a local copy" case at the app level), so this is safe to
      // apply unconditionally rather than only for GET.
      cache: "no-store",
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
      // Every non-2xx failure gets logged here, once — not just 5xx. A 4xx
      // previously logged nothing, leaving a failure with zero trace when
      // a caller's own catch block doesn't print the error either.
      console.warn(`DataManager: request failed (${response.status}) on ${method} ${path}`, message);
      if (response.status >= 500) {
        // A 5xx means an uncaught server exception (a raw Python traceback
        // string) — not something a user can act on by reading it. The
        // console already has the real detail above; let `error.message`
        // be a clean, generic string every call site's status.show() can use.
        const error = new Error("Something went wrong on the server. Please try again.");
        error.status = response.status;
        error.payload = data;
        error.serverMessage = message;
        throw error;
      }
      const error = new Error(message || `Request failed with status ${response.status}`);
      error.status = response.status;
      error.payload = data;
      // The server no longer recognizes the token we sent (expired, signed out elsewhere, or revoked), so
      // the signed-in look is stale: drop it and reload as a signed-out visitor.
      if (response.status === 401 && message === "Authentication required" && headers["Authorization"]) {
        this.clearSession();
        window.dispatchEvent(new CustomEvent("undercroft:auth-changed", { detail: { session: null } }));
        window.location.reload();
      }
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

  async getRegistrationOptions() {
    return this._request("/auth/registration", { auth: false });
  }

  async listInvites() {
    return (await this._request("/admin/invites", { auth: true })).invites;
  }

  async createInvite(invite) {
    return this._request("/admin/invites", { method: "POST", body: invite, auth: true });
  }

  async updateInvite(code, changes) {
    return this._request(`/admin/invites/${encodeURIComponent(code)}`, { method: "POST", body: changes, auth: true });
  }

  async deleteInvite(code) {
    return this._request(`/admin/invites/${encodeURIComponent(code)}/delete`, { method: "POST", body: {}, auth: true });
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

  // preferLocal's default is intentionally auth-dependent, not a flat
  // `true` — for an anonymous user the local mirror is the only copy, so
  // local-first is correct by necessity; for a signed-in user it's purely a
  // read-acceleration cache with no invalidation signal from another
  // writer (tool, tab, device, group member), so a flat `true` default
  // is wrong far more often than not there. Passing `preferLocal` explicitly
  // always wins outright; only the unspecified (`null`) case is resolved
  // here, per-call, against live auth state.
  async get(bucket, id, { preferLocal = null, shareToken = "" } = {}) {
    const token = shareToken ? String(shareToken) : "";
    const effectivePreferLocal = preferLocal === null ? !this.isAuthenticated() : preferLocal;
    if (effectivePreferLocal && !token) {
      const local = this.getLocal(bucket, id);
      if (local !== undefined) {
        return { source: "local", payload: local };
      }
    }
    const query = token ? `?share=${encodeURIComponent(token)}` : "";
    const payload = await this._request(`/content/${bucket}/${id}${query}`, { method: "GET", auth: true });
    return { source: "remote", payload };
  }

  // One request, N `{id, body}` pairs back (not bare bodies — a record's
  // JSON doesn't always embed its own id) — POST /content/{bucket}/bulk. No
  // local-cache fast path the way get() has: content-fetch.js's own caching
  // layer sits above this call, not below it.
  async getBulk(bucket, { ids, systemIds } = {}) {
    const body = {};
    if (Array.isArray(ids) && ids.length) body.ids = ids;
    if (Array.isArray(systemIds) && systemIds.length) body.systemIds = systemIds;
    const payload = await this._request(`/content/${bucket}/bulk`, { method: "POST", body, auth: true });
    return { source: "remote", items: Array.isArray(payload?.items) ? payload.items : [] };
  }

  async save(bucket, id, payload, { mode = "auto" } = {}) {
    if (!id) {
      throw new Error("Record id is required");
    }
    // A record's own kind is which bucket it's stored under (this call's
    // `bucket` argument) — never a field inside the record body. Several
    // Loom import mappings bind their own `kind` field for internal
    // routing purposes, but that value can stay baked into the mapped
    // object all the way through here unless stripped, drifting stale the
    // instant a kind gets renamed. Stripped here, the one place every save
    // in the suite funnels through, so no mapping/importer can reintroduce it.
    if (payload && typeof payload === "object" && !Array.isArray(payload) && "kind" in payload) {
      const { kind: _kind, ...rest } = payload;
      payload = rest;
    }
    if (mode === "local" || (mode === "auto" && !this.isAuthenticated())) {
      // The ONLY copy for an anonymous/local-mode save — a failure here
      // (most commonly QuotaExceededError once a bucket's whole-array
      // localStorage blob grows past the browser's per-origin cap) really
      // is data loss, so this still throws.
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
    // The server write above is the authoritative copy for a signed-in
    // user — this local write is purely a read-acceleration cache. Left
    // unguarded, a QuotaExceededError here (a growing bucket's whole-array
    // JSON blob exceeding the browser's per-origin localStorage cap)
    // propagates as if the entire save had failed, even though the real
    // server copy already succeeded. Best-effort only: never lets a stale/
    // oversized local cache turn a successful save into a reported failure.
    // On a genuine quota hit specifically, self-heals by purging this one
    // bucket's stale cache and retrying once — otherwise the bucket would
    // stay permanently over quota and fail this way on every future save.
    try {
      this.saveLocal(bucket, id, payload);
    } catch (error) {
      if (this._isQuotaExceededError(error)) {
        this.clearLocalBucket(bucket);
        try {
          this.saveLocal(bucket, id, payload);
        } catch (retryError) {
          console.warn(`DataManager: local cache still over quota for ${bucket}/${id} after purging (server save still succeeded)`, retryError);
        }
      } else {
        console.warn(`DataManager: local cache write failed for ${bucket}/${id} (server save still succeeded)`, error);
      }
    }
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

  // Admin editing ANOTHER user's email directly — distinct from updateEmail
  // above, which is self-service and requires the acting user's own password.
  async updateUserEmail(username, email) {
    return this._request("/auth/users/email", {
      method: "POST",
      body: { username, email },
      auth: true,
    });
  }

  // Deactivating also invalidates that user's existing sessions server-side
  // (see admin_set_user_status) — not just future logins.
  async updateUserStatus(username, isActive) {
    return this._request("/auth/users/status", {
      method: "POST",
      body: { username, is_active: Boolean(isActive) },
      auth: true,
    });
  }

  // Admin creating a user directly — already active, no verification code
  // needed — distinct from register() above, which is self-service and
  // subject to require_email_verification.
  async createUser({ username, email, password, tier = "free" } = {}) {
    return this._request("/auth/users/create", {
      method: "POST",
      body: { username, email, password, tier },
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

  // Self-service tier change (distinct from updateUserTier above, which is
  // admin-only and targets another user). No payment step yet — applies
  // immediately; the server rejects "admin" as a target unconditionally.
  async upgradeTier({ tier }) {
    const result = await this._request("/auth/profile/upgrade", {
      method: "POST",
      body: { tier },
      auth: true,
    });
    if (result && result.user) {
      this.refreshSessionUser(result.user);
    }
    return result;
  }

  async getUrlTicket(purpose) {
    const result = await this._request("/auth/ticket", { method: "POST", body: { purpose }, auth: true });
    return result.ticket;
  }

  async revokeOtherSessions() {
    return this._request("/auth/profile/sessions/revoke-others", { method: "POST", body: {}, auth: true });
  }

  async updatePassword({ current_password, new_password }) {
    return this._request("/auth/profile/password", {
      method: "POST",
      body: { current_password, new_password },
      auth: true,
    });
  }

  // A small per-user JSON blob stored directly on the users row (see
  // the `settings` column on `users`), not a Library kind — this
  // is account-level preference (today: the Dashboard's widget layout), not
  // shareable/owned content. Only meaningful when signed in; callers fall
  // back to localStorage otherwise (same local-first pattern every other
  // kind already follows).
  async getUserSettings() {
    if (!this.isAuthenticated()) {
      return {};
    }
    return this._request("/auth/profile/settings", { method: "GET", auth: true });
  }

  // Merge-patch — only the keys in `patch` are updated server-side, so this
  // can't clobber some other feature's settings stored in the same blob.
  async saveUserSettings(patch) {
    if (!this.isAuthenticated()) {
      throw new Error("Sign in to sync settings.");
    }
    return this._request("/auth/profile/settings", {
      method: "POST",
      body: patch,
      auth: true,
    });
  }

  // Home Assistant connection — {configured, baseUrl} only; the server
  // never returns the token itself after the save that set it (see
  // server/integrations.py's own header comment on why).
  async getHaConnection() {
    if (!this.isAuthenticated()) {
      return { configured: false, baseUrl: "" };
    }
    return this._request("/home-assistant/connection", { method: "GET", auth: true });
  }

  async saveHaConnection({ baseUrl, token }) {
    if (!this.isAuthenticated()) {
      throw new Error("Sign in to connect Home Assistant.");
    }
    return this._request("/home-assistant/connection", { method: "POST", body: { baseUrl, token }, auth: true });
  }

  async clearHaConnection() {
    if (!this.isAuthenticated()) {
      throw new Error("Sign in to manage your Home Assistant connection.");
    }
    return this._request("/home-assistant/connection/clear", { method: "POST", auth: true });
  }

  // Deployment-wide auth credentials (D&D Beyond session cookie, Anthropic
  // API key) — Loom's Admin tab is the intended caller. No client-side tier
  // check here — the server independently enforces gm-reads/admin-writes.
  // Never returns either secret value, only {configured, ...}.
  async getAuthCredentialsStatus() {
    return this._request("/auth/credentials", { method: "GET", auth: true });
  }

  async saveDdbSessionCookie(cookie) {
    return this._request("/auth/credentials/ddb-session", { method: "POST", body: { cookie }, auth: true });
  }

  async saveAnthropicApiKey(apiKey) {
    return this._request("/auth/credentials/anthropic", { method: "POST", body: { apiKey }, auth: true });
  }

  async checkDdbAuthStatus() {
    return this._request("/auth/credentials/ddb-session/check", { method: "POST", auth: true });
  }

  // Trimmed {entityId, domain, friendlyName}[] — see app.py's own
  // handle_ha_entities for why the full HA state payload never leaves the
  // server.
  async listHaEntities() {
    if (!this.isAuthenticated()) {
      return { entities: [] };
    }
    return this._request("/home-assistant/entities", { method: "GET", auth: true });
  }

  // One entity's live state — {entityId, state, brightness, rgbColor,
  // supportedColorModes, friendlyName} — for a light control surface (see
  // ha-light.js). Distinct from listHaEntities above, which only returns
  // enough to populate a picker.
  async getHaEntityState(entityId) {
    if (!this.isAuthenticated() || !entityId) {
      return null;
    }
    return this._request(`/home-assistant/entity-state?entityId=${encodeURIComponent(entityId)}`, {
      method: "GET",
      auth: true,
    });
  }

  // One generic action — "control a device" and "trigger a routine" are the
  // same call underneath (a routine is just domain: "script"/"scene"/
  // "automation") — see home-assistant.js's own HA_MACRO_ACTIONS.
  async callHaService({ domain, service, entityId, data } = {}) {
    if (!this.isAuthenticated()) {
      throw new Error("Sign in to control Home Assistant.");
    }
    return this._request("/home-assistant/call-service", {
      method: "POST",
      body: { domain, service, entityId, data },
      auth: true,
    });
  }

  // Not routed through _request — that helper always JSON-encodes the body,
  // and this needs to send raw audio bytes with its own Content-Type
  // instead. Mirrors _request's own auth-header handling and error-message
  // extraction. `serverId` picks a saved transcription server, sent as a
  // query param since the body here is raw audio, not JSON.
  async transcribeAudioChunk(blob, serverId) {
    if (!this.isAuthenticated()) {
      throw new Error("Sign in to use live transcription.");
    }
    const fetchImpl = this._requireFetch();
    const headers = { "Content-Type": blob.type || "audio/webm" };
    if (this._session?.token) headers["Authorization"] = `Bearer ${this._session.token}`;
    const response = await fetchImpl(this._url(`/audio/transcribe-chunk?serverId=${encodeURIComponent(serverId || "")}`), {
      method: "POST",
      headers,
      body: blob,
      cache: "no-store",
    });
    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      // A non-JSON response only happens on an unexpected server error —
      // the message fallback below covers it.
    }
    if (!response.ok) {
      throw new Error((data && data.error) || "Transcription failed for this chunk.");
    }
    return data;
  }

  // Deployment-wide LIST of transcription servers — [{id, label, baseUrl,
  // hasKey}]; the API key (if any) is never returned (see
  // server/integrations.py's own header comment on why). List works for any
  // signed-in gm+ account (populating its own server picker); save/delete
  // are admin-only server-side.
  async listTranscriptionServers() {
    if (!this.isAuthenticated()) {
      return { servers: [] };
    }
    return this._request("/admin/transcription-servers", { method: "GET", auth: true });
  }

  // Upserts one entry — `id` present and matching an existing entry edits
  // it in place; a new (client-generated) id creates one. Returns the
  // refreshed list.
  async saveTranscriptionServer({ id, label, baseUrl, model, token }) {
    if (!this.isAuthenticated()) {
      throw new Error("Sign in to manage transcription servers.");
    }
    return this._request("/admin/transcription-servers", {
      method: "POST",
      body: { id, label, baseUrl, model, token },
      auth: true,
    });
  }

  async deleteTranscriptionServer(id) {
    if (!this.isAuthenticated()) {
      throw new Error("Sign in to manage transcription servers.");
    }
    return this._request(`/admin/transcription-servers/${encodeURIComponent(id)}/clear`, { method: "POST", auth: true });
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

  // Admin-only (server enforces this, no client-side tier check duplicated
  // here). Two calls, same route: `dryRun: true` scans and reports what
  // would change with nothing written; `dryRun: false` performs the rename
  // and reference repair for real. Both return `{ok, kind, oldId, newId,
  // dryRun, referenceCount, touched: [{kind, id, count}]}`.
  async renameContent(bucket, id, newId, { dryRun = false } = {}) {
    if (!newId) {
      throw new Error("New id is required");
    }
    const result = await this._request(`/content/${bucket}/${encodeURIComponent(id)}/rename`, {
      method: "POST",
      body: { newId, dryRun },
      auth: true,
    });
    if (!dryRun) {
      // A real rename invalidates far more than this one bucket's list —
      // every other kind whose records may have just been rewritten too —
      // so clearing every cached list/bulk entry is the only way to
      // guarantee nothing stale survives.
      this._listCache.clear();
      this._ownedCache.clear();
      this.removeLocal(bucket, id);
    }
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

  // Server-side half of the suite-wide header search — every kind at once,
  // filtered to this signed-in user's own owned/shared content. Uncached
  // (unlike list/listOwnedContent above) — a search box firing a fresh
  // query on every keystroke has nothing sensible to cache against.
  async searchContent(query) {
    if (!this.isAuthenticated() || !query || !query.trim()) return [];
    const params = new URLSearchParams({ q: query.trim() });
    const payload = await this._request(`/content/search?${params.toString()}`, { method: "GET", auth: true });
    return Array.isArray(payload?.results) ? payload.results : [];
  }

  // includeMemberGroups (opt-in) also lists groups you don't own but have a
  // character added to (`?scope=member`) — what auth-ui.js's account-menu
  // campaign selector wants, but not Loom's group-management tab (default
  // scope, owner-only, since that UI offers rename/delete/member-editing
  // controls that only work on groups you own). Cached per-scope (a Map,
  // not a single value) so one caller's broader request can't leak into
  // the other's.
  async listGroups({ refresh = false, includeMemberGroups = false } = {}) {
    if (!this.isAuthenticated()) {
      this._groupCache = null;
      return { groups: [] };
    }
    if (!(this._groupCache instanceof Map)) {
      this._groupCache = new Map();
    }
    const cacheKey = includeMemberGroups ? "member" : "owned";
    if (!refresh && this._groupCache.has(cacheKey)) {
      return this._groupCache.get(cacheKey);
    }
    const query = includeMemberGroups ? "?scope=member" : "";
    const payload = await this._request(`/groups${query}`, { method: "GET", auth: true });
    const normalized = payload && typeof payload === "object" ? payload : { groups: [] };
    this._groupCache.set(cacheKey, normalized);
    return normalized;
  }

  async createGroup({ name, type = "player-group" } = {}) {
    const payload = await this._request("/groups", {
      method: "POST",
      body: { name, type },
      auth: true,
    });
    this._groupCache = null;
    return payload;
  }

  async updateGroup({ id, name, systemId, settingId, templateId, properties, groupDayIndex, groupMinutesOfDay } = {}) {
    if (!id) {
      throw new Error("Group id is required");
    }
    const body = {};
    if (name !== undefined) body.name = name;
    if (systemId !== undefined) body.system_id = systemId;
    if (settingId !== undefined) body.setting_id = settingId;
    // The group's own "Party Data" template (Workbench's no-character
    // mode) — independent of any one Character's own `template` field.
    if (templateId !== undefined) body.template_id = templateId;
    // The Group Properties SCHEMA (Loom's own Group tab) — not a value
    // write, see updateGroupPropertyValue below for that.
    if (properties !== undefined) body.properties = properties;
    // The group's own tracked "what date is it in the fiction" — same
    // conceptual tier as systemId/settingId above. setGroupDate below
    // is the purpose-named entry point most callers actually want; this
    // stays generic so a future combined save (e.g. a Loom Group editor
    // field) can still set it alongside other Group fields in one request.
    if (groupDayIndex !== undefined) body.group_day_index = groupDayIndex;
    if (groupMinutesOfDay !== undefined) body.group_minutes_of_day = groupMinutesOfDay;
    const payload = await this._request(`/groups/${encodeURIComponent(id)}`, {
      method: "POST",
      body,
      auth: true,
    });
    this._groupCache = null;
    return payload;
  }

  // Thin, purpose-named wrapper over updateGroup for the one common write
  // every group-date UI needs — advance the day, optionally the time of
  // day too. Emits its own event (unlike updateGroup, whose callers already
  // re-render off their own await): more than one Calendar widget can be on
  // the same dashboard, each reading this shared value, and only the one
  // that made this change already knows to re-render itself.
  async setGroupDate(groupId, { dayIndex, minutesOfDay } = {}) {
    const payload = await this.updateGroup({ id: groupId, groupDayIndex: dayIndex, groupMinutesOfDay: minutesOfDay });
    this._emit("undercroft:group-date-changed", {
      groupId,
      dayIndex: payload?.group_day_index,
      minutesOfDay: payload?.group_minutes_of_day,
    });
    return payload;
  }

  async deleteGroup(id) {
    if (!id) {
      throw new Error("Group id is required");
    }
    const result = await this._request(`/groups/${encodeURIComponent(id)}/delete`, {
      method: "POST",
      auth: true,
    });
    this._groupCache = null;
    return result;
  }

  async updateGroupMembers({ id, characterIds = [] } = {}) {
    if (!id) {
      throw new Error("Group id is required");
    }
    const members = Array.isArray(characterIds) ? characterIds : [];
    const payload = await this._request(`/groups/${encodeURIComponent(id)}/members`, {
      method: "POST",
      body: { character_ids: members },
      auth: true,
    });
    this._groupCache = null;
    return payload;
  }

  // Writes ONE Group Property value — deliberately NOT this.save("group", id,
  // ...), which requires owner/edit-share access a plain party member
  // rarely has. The server's own bespoke endpoint checks that SPECIFIC
  // property's own `public` flag instead (see server/groups.py's
  // update_group_property_value) — this is the write path
  // common/js/lib/group-live-sync.js's persistGroupPropertyValue calls.
  async updateGroupPropertyValue({ id, key, value } = {}) {
    if (!id) {
      throw new Error("Group id is required");
    }
    if (!key) {
      throw new Error("Property key is required");
    }
    return this._request(`/groups/${encodeURIComponent(id)}/properties/${encodeURIComponent(key)}`, {
      method: "POST",
      body: { value },
      auth: true,
    });
  }

  // Read-side counterpart to updateGroupPropertyValue above, for the same
  // reason: this.get("group", id, ...) requires owner/share access a plain
  // member doesn't have, so it 401s for every real player, every time (see
  // group-live-sync.js's own doLoad, the confirmed real bug this fixes).
  // Returns { properties, propertyValues } — the owner/admin gets
  // everything, a mere member gets only whatever properties the GM marked
  // `public` (server/groups.py's get_group_properties).
  async getGroupProperties(id) {
    if (!id) {
      throw new Error("Group id is required");
    }
    return this._request(`/groups/${encodeURIComponent(id)}/properties`, { method: "GET", auth: true });
  }

  async listCharacterGroups(id) {
    if (!id) {
      throw new Error("Character id is required");
    }
    return this._request(`/groups/character/${encodeURIComponent(id)}`, {
      method: "GET",
      auth: true,
    });
  }

  async createGroupShareLink(id) {
    if (!id) {
      throw new Error("Group id is required");
    }
    const payload = await this._request(`/groups/${encodeURIComponent(id)}/share-link`, {
      method: "POST",
      auth: true,
    });
    this._groupCache = null;
    return payload;
  }

  async revokeGroupShareLink(id) {
    if (!id) {
      throw new Error("Group id is required");
    }
    const payload = await this._request(`/groups/${encodeURIComponent(id)}/share-link/revoke`, {
      method: "POST",
      auth: true,
    });
    this._groupCache = null;
    return payload;
  }

  // --- Group chat (channels -> threads -> messages) ---------------------------
  // A share-link visitor passes `shareToken` instead of relying on the path's
  // group id ("-" is a placeholder; the token decides the group server-side).

  _chatPath(groupId, shareToken, suffix) {
    if (!groupId && !shareToken) {
      throw new Error("Group id is required for group chat");
    }
    const base = `/groups/${encodeURIComponent(groupId || "-")}/chat${suffix}`;
    return shareToken ? `${base}${base.includes("?") ? "&" : "?"}share=${encodeURIComponent(shareToken)}` : base;
  }

  async getChatOverview({ groupId = "", shareToken = "" } = {}) {
    return this._request(this._chatPath(groupId, shareToken, ""), { method: "GET", auth: !shareToken || this.isAuthenticated() });
  }

  async getChatMessages({ groupId = "", shareToken = "", threadId, before, after, limit } = {}) {
    if (!threadId) {
      throw new Error("Thread id is required");
    }
    const params = new URLSearchParams();
    if (before) params.set("before", String(before));
    if (after) params.set("after", String(after));
    if (limit) params.set("limit", String(limit));
    const query = params.toString() ? `?${params.toString()}` : "";
    return this._request(this._chatPath(groupId, shareToken, `/threads/${encodeURIComponent(threadId)}/messages${query}`), {
      method: "GET",
      auth: !shareToken || this.isAuthenticated(),
    });
  }

  // `payload` is only for system messages (rolls, shop lines): it must carry a
  // `kind` and a human-readable `summary`. `refs` are the mention/wikilink/
  // message references the composer inserted into `body`.
  async postChatMessage({ groupId = "", shareToken = "", threadId, body = "", payload = undefined, voice = undefined, refs = undefined } = {}) {
    if (!threadId) {
      throw new Error("Thread id is required to post");
    }
    // A share-link visitor has no group id of their own; the token in the body decides the group.
    return this._request(this._chatPath(groupId || (shareToken ? "-" : ""), "", `/threads/${encodeURIComponent(threadId)}/messages`), {
      method: "POST",
      body: { body, payload, voice, refs, share: shareToken || undefined },
      auth: true,
    });
  }

  async editChatMessage({ groupId, messageId, body, refs = undefined } = {}) {
    return this._request(this._chatPath(groupId, "", `/messages/${encodeURIComponent(messageId)}/edit`), {
      method: "POST",
      body: { body, refs },
      auth: true,
    });
  }

  async deleteChatMessage({ groupId, messageId } = {}) {
    return this._request(this._chatPath(groupId, "", `/messages/${encodeURIComponent(messageId)}/delete`), {
      method: "POST",
      body: {},
      auth: true,
    });
  }

  async toggleChatReaction({ groupId, messageId, emoji } = {}) {
    return this._request(this._chatPath(groupId, "", `/messages/${encodeURIComponent(messageId)}/reactions`), {
      method: "POST",
      body: { emoji },
      auth: true,
    });
  }

  async markChatThreadRead({ groupId, threadId } = {}) {
    return this._request(this._chatPath(groupId, "", `/threads/${encodeURIComponent(threadId)}/read`), {
      method: "POST",
      body: {},
      auth: true,
    });
  }

  async createChatChannel({ groupId, name, category = "", linked = undefined, mode = undefined, threadTitle = "" } = {}) {
    return this._request(this._chatPath(groupId, "", "/channels"), {
      method: "POST",
      body: { name, category, linked, mode, threadTitle },
      auth: true,
    });
  }

  async updateChatChannel({ groupId, channelId, fields = {} } = {}) {
    return this._request(this._chatPath(groupId, "", `/channels/${encodeURIComponent(channelId)}`), {
      method: "POST",
      body: fields,
      auth: true,
    });
  }

  async createChatThread({ groupId, channelId, title } = {}) {
    return this._request(this._chatPath(groupId, "", `/channels/${encodeURIComponent(channelId)}/threads`), {
      method: "POST",
      body: { title },
      auth: true,
    });
  }

  async archiveChatThread({ groupId, threadId } = {}) {
    return this._request(this._chatPath(groupId, "", `/threads/${encodeURIComponent(threadId)}/archive`), {
      method: "POST",
      body: {},
      auth: true,
    });
  }

  // `[[msg:ID]]` targets for Repository and the reply preview; signed-in only
  // (an anonymous visitor just gets unresolved links).
  async resolveChatMessages(ids = []) {
    const list = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
    if (!list.length) return { messages: {} };
    return this._request(`/chat/messages/resolve?ids=${list.join(",")}`, { method: "GET", auth: true });
  }

  async getBacklinks(kind, id) {
    if (!kind || !id) {
      throw new Error("kind and id are required");
    }
    return this._request(`/backlinks/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, { method: "GET", auth: true });
  }

  async sendDirectMessage({ groupId, recipientIds, body } = {}) {
    if (!groupId) {
      throw new Error("Group id is required to send a message");
    }
    return this._request(`/groups/${encodeURIComponent(groupId)}/direct-messages`, {
      method: "POST",
      body: { recipientIds, body },
      auth: true,
    });
  }

  async getInbox({ unreadOnly = false } = {}) {
    return this._request(`/inbox${unreadOnly ? "?unread=1" : ""}`, { method: "GET", auth: true });
  }

  async getInboxCount() {
    return this._request("/inbox/count", { method: "GET", auth: true });
  }

  // --- Scheduled sessions (server/sessions.py). Times are UTC ISO strings. ---

  _sessionsPath(groupId, suffix = "") {
    if (!groupId) {
      throw new Error("Group id is required for sessions");
    }
    return `/groups/${encodeURIComponent(groupId)}/sessions${suffix}`;
  }

  async getGroupSessions(groupId) {
    return this._request(this._sessionsPath(groupId), { method: "GET", auth: true });
  }

  async createGroupSession(groupId, settings) {
    return this._request(this._sessionsPath(groupId), { method: "POST", body: settings, auth: true });
  }

  async updateGroupSession(groupId, sessionId, settings) {
    return this._request(this._sessionsPath(groupId, `/${encodeURIComponent(sessionId)}`), {
      method: "POST",
      body: settings,
      auth: true,
    });
  }

  async endGroupSession(groupId, sessionId) {
    return this._request(this._sessionsPath(groupId, `/${encodeURIComponent(sessionId)}/end`), {
      method: "POST",
      body: {},
      auth: true,
    });
  }

  // Removes the session, all its dates and their history (unlike endGroupSession).
  async deleteGroupSession(groupId, sessionId) {
    return this._request(this._sessionsPath(groupId, `/${encodeURIComponent(sessionId)}/delete`), {
      method: "POST",
      body: {},
      auth: true,
    });
  }

  async previewSessionSlots(groupId, settings) {
    return this._request(this._sessionsPath(groupId, "/preview"), { method: "POST", body: settings, auth: true });
  }

  // Creates a not-yet-announced date of a series early, so it can be edited or cancelled alone.
  async ensureSessionOccurrence(groupId, sessionId, slotKey) {
    return this._request(this._sessionsPath(groupId, `/${encodeURIComponent(sessionId)}/slots`), {
      method: "POST",
      body: { slotKey },
      auth: true,
    });
  }

  _occurrencePath(groupId, occurrenceId, suffix = "") {
    return `/groups/${encodeURIComponent(groupId)}/occurrences/${encodeURIComponent(occurrenceId)}${suffix}`;
  }

  async updateSessionOccurrence(groupId, occurrenceId, settings) {
    return this._request(this._occurrencePath(groupId, occurrenceId), { method: "POST", body: settings, auth: true });
  }

  async cancelSessionOccurrence(groupId, occurrenceId) {
    return this._request(this._occurrencePath(groupId, occurrenceId, "/cancel"), { method: "POST", body: {}, auth: true });
  }

  async setSessionOccurrenceHistory(groupId, occurrenceId, history) {
    return this._request(this._occurrencePath(groupId, occurrenceId, "/history"), {
      method: "POST",
      body: history,
      auth: true,
    });
  }

  async getSessionOccurrence(occurrenceId) {
    return this._request(`/sessions/occurrences/${encodeURIComponent(occurrenceId)}`, { method: "GET", auth: true });
  }

  async rsvpSessionOccurrence(occurrenceId, response) {
    return this._request(`/sessions/occurrences/${encodeURIComponent(occurrenceId)}/rsvp`, {
      method: "POST",
      body: { response },
      auth: true,
    });
  }

  // The GM answering for a player; `response` null clears their answer.
  async rsvpSessionOccurrenceFor(occurrenceId, userId, response) {
    return this._request(`/sessions/occurrences/${encodeURIComponent(occurrenceId)}/rsvp-for`, {
      method: "POST",
      body: { userId, response },
      auth: true,
    });
  }

  async declineSessionRange(groupId, from, to) {
    return this._request("/sessions/decline-range", { method: "POST", body: { groupId, from, to }, auth: true });
  }

  // The GM (or an admin) marks an Accepted player a no-show, or clears one.
  async setSessionNoShow(occurrenceId, userId, noShow) {
    return this._request(`/sessions/occurrences/${encodeURIComponent(occurrenceId)}/no-show`, {
      method: "POST",
      body: { userId, noShow },
      auth: true,
    });
  }

  // The player contests their own no-show.
  async disputeSessionNoShow(occurrenceId) {
    return this._request(`/sessions/occurrences/${encodeURIComponent(occurrenceId)}/dispute`, {
      method: "POST",
      body: {},
      auth: true,
    });
  }

  // --- Group membership and campaigns (server/groups.py, campaigns.py) ---

  _groupPath(groupId, suffix = "") {
    if (!groupId) {
      throw new Error("Group id is required");
    }
    return `/groups/${encodeURIComponent(groupId)}${suffix}`;
  }

  async leaveGroup(groupId) {
    return this._request(this._groupPath(groupId, "/leave"), { method: "POST", body: {}, auth: true });
  }

  async addGroupPlayer(groupId, username) {
    return this._request(this._groupPath(groupId, "/players"), { method: "POST", body: { username }, auth: true });
  }

  async getAddableGroupPlayers(groupId) {
    return this._request(this._groupPath(groupId, "/addable-players"), { auth: true });
  }

  async getAddableGroupCharacters(groupId) {
    return this._request(this._groupPath(groupId, "/addable-characters"), { auth: true });
  }

  async removeGroupPlayer(groupId, userId) {
    return this._request(this._groupPath(groupId, `/players/${encodeURIComponent(userId)}/remove`), {
      method: "POST",
      body: {},
      auth: true,
    });
  }

  // A player takes one of the GM's unclaimed characters.
  async claimRosterCharacter(groupId, characterId) {
    return this._request(this._groupPath(groupId, "/roster/claim"), { method: "POST", body: { characterId }, auth: true });
  }

  // A player puts a character they own on the roster.
  async addOwnRosterCharacter(groupId, characterId) {
    return this._request(this._groupPath(groupId, "/roster/own-character"), {
      method: "POST",
      body: { characterId },
      auth: true,
    });
  }

  async getGroupCampaigns(groupId) {
    return this._request(this._groupPath(groupId, "/campaigns"), { method: "GET", auth: true });
  }

  async createGroupCampaign(groupId, { name, status }) {
    return this._request(this._groupPath(groupId, "/campaigns"), { method: "POST", body: { name, status }, auth: true });
  }

  async updateGroupCampaign(groupId, campaignId, changes) {
    return this._request(this._groupPath(groupId, `/campaigns/${encodeURIComponent(campaignId)}`), {
      method: "POST",
      body: changes,
      auth: true,
    });
  }

  async reorderGroupCampaigns(groupId, ids) {
    return this._request(this._groupPath(groupId, "/campaigns/order"), { method: "POST", body: { ids }, auth: true });
  }

  async getServerLoad(minutes = 5) {
    return this._request(`/admin/load?minutes=${encodeURIComponent(minutes)}`, { auth: true });
  }

  async getNoteQuota() {
    return this._request("/notes/quota", { auth: true });
  }

  async deleteGroupCampaign(groupId, campaignId) {
    return this._request(this._groupPath(groupId, `/campaigns/${encodeURIComponent(campaignId)}/delete`), {
      method: "POST",
      body: {},
      auth: true,
    });
  }

  // --- Community: profiles, signals, endorsements, listings, applications (server/community.py and friends) ---

  async getCommunityProfile() {
    return this._request("/community/profile", { method: "GET", auth: true });
  }

  async saveCommunityProfile(profile) {
    return this._request("/community/profile", { method: "POST", body: profile, auth: true });
  }

  async getCommunityPerson(userId) {
    return this._request(`/community/people/${encodeURIComponent(userId)}`, { method: "GET", auth: true });
  }

  async listCommunityPeople(filters = {}) {
    return this._request(`/community/people${this._query(filters)}`, { method: "GET", auth: true });
  }

  async getCommunitySignals(userId) {
    return this._request(`/community/signals/${encodeURIComponent(userId)}`, { method: "GET", auth: true });
  }

  async listEndorsable() {
    return this._request("/community/endorsable", { method: "GET", auth: true });
  }

  async endorsePerson({ userId, scopeKey, tagId }) {
    return this._request("/community/endorse", { method: "POST", body: { userId, scopeKey, tagId }, auth: true });
  }

  _query(params) {
    const search = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        search.set(key, value);
      }
    });
    const text = search.toString();
    return text ? `?${text}` : "";
  }

  async listCommunityListings(filters = {}) {
    return this._request(`/community/listings${this._query(filters)}`, { method: "GET", auth: true });
  }

  async getCommunityListing(listingId) {
    return this._request(`/community/listings/${encodeURIComponent(listingId)}`, { method: "GET", auth: true });
  }

  // Creates the listing, or updates it when `listing.id` is set.
  async saveCommunityListing(listing) {
    const path = listing.id ? `/community/listings/${encodeURIComponent(listing.id)}` : "/community/listings";
    return this._request(path, { method: "POST", body: listing, auth: true });
  }

  async deleteCommunityListing(listingId) {
    return this._request(`/community/listings/${encodeURIComponent(listingId)}/delete`, { method: "POST", body: {}, auth: true });
  }

  async getCommunityTags() {
    return this._request("/community/tags", { method: "GET", auth: true });
  }

  async rewriteCommunityTag({ from, to }) {
    return this._request("/community/tags/rewrite", { method: "POST", body: { from, to }, auth: true });
  }

  async applyToListing(listingId, body) {
    return this._request(`/community/listings/${encodeURIComponent(listingId)}/apply`, {
      method: "POST",
      body: { body },
      auth: true,
    });
  }

  async getApplication(applicationId) {
    return this._request(`/community/applications/${encodeURIComponent(applicationId)}`, { method: "GET", auth: true });
  }

  async replyToApplication(applicationId, body) {
    return this._request(`/community/applications/${encodeURIComponent(applicationId)}/reply`, {
      method: "POST",
      body: { body },
      auth: true,
    });
  }

  // `action` is accept, decline or withdraw.
  async answerApplication(applicationId, action) {
    return this._request(`/community/applications/${encodeURIComponent(applicationId)}/${action}`, {
      method: "POST",
      body: {},
      auth: true,
    });
  }

  // Admin-edited community lists (safety tools, endorsement tags) and the settings object.
  // The community-defined lists keep the routes the tools already use; the rest live under /community/lists.
  _communityListRoute(name) {
    const routes = { fonts: "/custom-fonts", clips: "/soundboard/clips", tokens: "/token-library", sizes: "/press/custom-sizes" };
    return routes[name] || `/community/lists/${encodeURIComponent(name)}`;
  }

  async saveCommunityListItem(name, item) {
    return this._request(this._communityListRoute(name), { method: "POST", body: { item }, auth: true });
  }

  async saveCommunityListOrder(name, ids) {
    return this._request(`${this._communityListRoute(name)}/order`, { method: "POST", body: { ids }, auth: true });
  }

  async deleteCommunityListItem(name, id) {
    return this._request(`${this._communityListRoute(name)}/delete`, { method: "POST", body: { id }, auth: true });
  }

  // React to the message behind an Inbox item: a mention or reply reacts to the
  // chat message itself, a direct message keeps its own reactions.
  async toggleInboxReaction(itemId, emoji) {
    return this._request("/inbox/reactions", { method: "POST", body: { itemId, emoji }, auth: true });
  }

  async deleteInboxItems(ids = []) {
    return this._request("/inbox/delete", { method: "POST", body: { ids }, auth: true });
  }

  async setGroupMemberActive({ groupId, characterId, active } = {}) {
    if (!groupId || !characterId) {
      throw new Error("groupId and characterId are required");
    }
    const payload = await this._request(`/groups/${encodeURIComponent(groupId)}/members/active`, {
      method: "POST",
      body: { characterId, active: Boolean(active) },
      auth: true,
    });
    this._groupCache = null;
    return payload;
  }

  async markInboxRead({ ids = undefined, all = false } = {}) {
    return this._request("/inbox/read", { method: "POST", body: { ids, all }, auth: true });
  }

  // A transient pointer broadcast (Orrery's click-to-ping map tool) —
  // deliberately not a chat message: a ping never touches the
  // database/group log at all, it only exists in-memory server-side long
  // enough for the live SSE stream's "ping" kind to relay it to subscribers.
  async postMapPing({ groupId = "", shareToken = "", position } = {}) {
    const body = { position };
    const token = shareToken ? String(shareToken) : "";
    if (token) {
      return this._request(`/groups/share/${encodeURIComponent(token)}/ping`, {
        method: "POST",
        body,
        auth: true,
      });
    }
    if (!groupId) {
      throw new Error("Group id is required to ping the map");
    }
    return this._request(`/groups/${encodeURIComponent(groupId)}/ping`, {
      method: "POST",
      body,
      auth: true,
    });
  }

  // Same transient, never-persisted shape as postMapPing above — "here are
  // the real settled per-die values, go show them on everyone else's
  // screen," relayed through the /live stream's "diceRoll" kind.
  // `dieResults` ({sides, value}[]) is what dice-reveal.js's tiles display —
  // dice-box can't be told to land on a chosen result, so a remote viewer's
  // animation is never a physics roll, just a display of these known
  // values. No share-token variant: Broadcast mode is GM-only, server-
  // enforced, and a share-link viewer's access never resolves to "owner."
  async postDiceRollBroadcast({ groupId = "", label = "", total = "", dieResults = [] } = {}) {
    if (!groupId) {
      throw new Error("Group id is required to broadcast a roll");
    }
    return this._request(`/groups/${encodeURIComponent(groupId)}/dice-roll-broadcast`, {
      method: "POST",
      body: { label, total, dieResults },
      auth: true,
    });
  }

  // Same transient "go animate this now" shape as postDiceRollBroadcast
  // above, for a Broadcast-mode card draw. No share-token variant, same
  // reasoning: Broadcast mode is GM-only and never reachable from a
  // share-link session.
  async postCardBroadcast({ groupId = "", deckLabel = "", backImage = "", cards = [] } = {}) {
    if (!groupId) {
      throw new Error("Group id is required to broadcast a draw");
    }
    return this._request(`/groups/${encodeURIComponent(groupId)}/card-broadcast`, {
      method: "POST",
      body: { deckLabel, backImage, cards },
      auth: true,
    });
  }

  async postEffectBroadcast({ groupId = "", mapId = "", elementId = "" } = {}) {
    if (!groupId) {
      throw new Error("Group id is required to broadcast an effect trigger");
    }
    return this._request(`/groups/${encodeURIComponent(groupId)}/effect-broadcast`, {
      method: "POST",
      body: { mapId, elementId },
      auth: true,
    });
  }

  // What the group currently has "shown to the table": {items: [{kind, id,
  // templateId?, data?, postedAt}], version}. A share-link visitor reads it
  // anonymously.
  async getGroupSpotlights({ groupId = "", shareToken = "" } = {}) {
    if (!groupId && !shareToken) {
      throw new Error("groupId (or shareToken) is required");
    }
    const query = shareToken ? `?share=${encodeURIComponent(shareToken)}` : "";
    return this._request(`/groups/${encodeURIComponent(groupId || "-")}/spotlight${query}`, {
      method: "GET",
      auth: !shareToken || this.isAuthenticated(),
    });
  }

  async _postSpotlight({ groupId = "", shareToken = "", ...body } = {}) {
    return this._request(`/groups/${encodeURIComponent(groupId || "-")}/spotlight`, {
      method: "POST",
      body: { ...body, share: shareToken || undefined },
      auth: true,
    });
  }

  // "Show to table": one call does both halves — grant the group view
  // access (share_with_group is an idempotent upsert, safe on every call),
  // then record the spotlight. Also shares the template (if any): a private,
  // GM-authored template needs the same visibility grant, or an anonymous
  // viewer's card render 403s on the template fetch even though the entity
  // fetch succeeds.
  // `skipShare` — for a widget type with no real Library record behind it
  // (Dashboard's Browser/Clock widgets, whose content lives entirely in the
  // spotlight's `data` payload) — nothing to grant view permission on.
  // `data` — the inline payload for those same kinds. Ignored by the server
  // for any kind with a real Library record.
  async spotlightToGroup({ groupId, contentType, contentId, templateId = "", skipShare = false, data = undefined } = {}) {
    if (!groupId || !contentType || !contentId) {
      throw new Error("groupId, contentType, and contentId are required");
    }
    if (!skipShare) {
      // "map" and "encounter" are the spotlighted kinds a player is ever
      // expected to write back to (their own token position; their own
      // combatant's initiative) — every other kind is genuinely read-only
      // for a player, so "view" stays correct there. A view-only share left
      // save_item's is_shared(require_edit:true) check failing for a
      // player's own narrow write, surfacing as "Edit not permitted."
      const spotlightPermissions = contentType === "map" || contentType === "encounter" ? "edit" : "view";
      await this.shareWithGroup({ contentType, contentId, groupId, permissions: spotlightPermissions });
      if (templateId) {
        await this.shareWithGroup({ contentType: "templates", contentId: templateId, groupId, permissions: "view" });
      }
    }
    const result = await this._postSpotlight({
      groupId,
      action: "show",
      kind: contentType,
      id: contentId,
      templateId: templateId || undefined,
      data,
    });
    // Lets anything watching this browser tab's own actions (dashboard.js's
    // spotlight panel) refresh immediately instead of waiting on the
    // poll/live-stream round-trip, which otherwise left a GM's own "show to
    // table" toggle taking several seconds to show up in their own icon tray.
    this._emit("undercroft:spotlight-changed", { groupId, kind: contentType, id: contentId });
    return result;
  }

  // Refreshes the `data` payload on an already-shown inline-kind spotlight
  // (a clock tick, a Browser URL edit); a no-op once it's been cleared. Only
  // valid for the server's inline-spotlight kinds (and an encounter's hidden
  // flag) — rejected for anything else.
  async updateSpotlightData({ groupId, shareToken = "", kind, id, data } = {}) {
    if ((!groupId && !shareToken) || !kind || !id) {
      throw new Error("groupId (or shareToken), kind, and id are required");
    }
    return this._postSpotlight({ groupId, shareToken, action: "update", kind, id, data });
  }

  // The other half of "show to table". `kind` + `id` scope the clear to just
  // that one instance (a widget's eye-icon toggling off shouldn't affect
  // another instance of the same kind shown alongside it); `kind` alone
  // clears every instance of that kind; omitting both clears whatever's
  // currently shown, of any kind (auth-ui.js's global "stop showing to the
  // table" header action).
  async clearSpotlight({ groupId, shareToken = "", kind = "", id = "" } = {}) {
    if (!groupId && !shareToken) {
      throw new Error("groupId is required");
    }
    const result = await this._postSpotlight({ groupId, shareToken, action: "clear", kind, id });
    // See spotlightToGroup's own identical comment — same instant, in-page
    // "this tab's own action just happened" signal, this time for turning
    // something off.
    this._emit("undercroft:spotlight-changed", { groupId, kind, id });
    return result;
  }

  async fetchGroupShare(token) {
    if (!token) {
      throw new Error("Share token is required");
    }
    return this._request(`/groups/share/${encodeURIComponent(token)}`, { method: "GET", auth: false });
  }

  async claimGroupCharacter({ token, characterId } = {}) {
    if (!token) {
      throw new Error("Share token is required");
    }
    if (!characterId) {
      throw new Error("characterId is required");
    }
    return this._request(`/groups/share/${encodeURIComponent(token)}/claim`, {
      method: "POST",
      body: { character_id: characterId },
      auth: true,
    });
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

  // Sibling of shareWithUser/revokeShare for a group target instead
  // of a single user — grants every member's owning user access at once
  // (server/shares.py's share_with_group + storage.py's group-membership
  // resolution), same /shares endpoint, same permissions vocabulary.
  async shareWithGroup({ contentType, contentId, groupId, permissions = "view" } = {}) {
    if (!contentType || !contentId || !groupId) {
      throw new Error("contentType, contentId, and groupId are required");
    }
    const result = await this._request("/shares", {
      method: "POST",
      body: {
        content_type: contentType,
        content_id: contentId,
        group_id: groupId,
        permissions,
      },
      auth: true,
    });
    this._emit("workbench:content-share", {
      bucket: contentType,
      id: contentId,
      groupId,
      permissions,
      action: "grant",
    });
    return result;
  }

  async revokeGroupShare({ contentType, contentId, groupId } = {}) {
    if (!contentType || !contentId || !groupId) {
      throw new Error("contentType, contentId, and groupId are required");
    }
    const result = await this._request("/shares/revoke", {
      method: "POST",
      body: {
        content_type: contentType,
        content_id: contentId,
        group_id: groupId,
      },
      auth: true,
    });
    this._emit("workbench:content-share", {
      bucket: contentType,
      id: contentId,
      groupId,
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
