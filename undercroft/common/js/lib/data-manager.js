const DEFAULT_STORAGE_PREFIX = "undercroft";
const DEFAULT_SESSION_KEY = "undercroft.session";
// Same "shared, unprefixed" trick as the session key — every tool's
// DataManager instance uses its own storagePrefix for local content, but
// login state (and now the active campaign selection) has to be visible
// identically across every tool without re-picking it per page.
const DEFAULT_ACTIVE_GROUP_KEY = "undercroft.activeGroup";
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

  // "Open a campaign" once (any tool, any page) and every tool sees the same
  // selection without re-picking it — mirrors the session key's shared,
  // unprefixed storage exactly. Cleared automatically on logout (see
  // _persistSession above), since it's meaningless without being signed in
  // as that group's owner.
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
  // write AND the event entirely — confirmed real bug this fixes: several
  // listeners of "workbench:active-group-changed" (dashboard.js's own full
  // renderWidgets(), auth-ui.js's own resyncActiveGroup) can themselves,
  // directly or indirectly, call setActiveGroup again in response to the
  // very event that woke them — auth-ui.js's resyncActiveGroup in
  // particular re-derives `name` from a fresh (cached) listGroups() call
  // every time it runs and calls this again whenever that disagrees with
  // whatever's currently stored, with no guard against calling it with the
  // literal value already in effect. Previously, since this always fired
  // the event unconditionally, that could re-trigger the exact same chain
  // of listeners indefinitely — dashboard.js's own listener alone tears
  // down and rebuilds every widget on the page each time (including their
  // live-stream connections), which is likely why Character/Combat Tracker
  // updates were landing late or not at all: their live-stream got torn
  // down and reconnected mid-flight, over and over, rather than staying up
  // long enough to actually receive anything. Also why `/list/character`
  // was observed being hit several times a second — that request happens
  // on every Character widget remount. Comparing here, once, at the single
  // source of the event, is more robust than trying to make every current
  // (and future) listener individually idempotent.
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

  // Browsers disagree on exactly how a full storage quota surfaces
  // (Chrome/Edge/Safari: DOMException name "QuotaExceededError"; older
  // Firefox: name "NS_ERROR_DOM_QUOTA_REACHED"; both also expose code 22
  // per the legacy DOM exception codes) — checked defensively across all
  // three rather than trusting one browser's own naming.
  _isQuotaExceededError(error) {
    return Boolean(error) && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED" || error.code === 22);
  }

  // For a signed-in user the local bucket cache is entirely disposable —
  // the server copy (already written by the time save() ever calls this)
  // is authoritative, and listLocal/getLocal transparently re-hydrate from
  // an empty bucket on the next read. Wiping it is therefore a SAFE way to
  // recover room after a QuotaExceededError, unlike removeLocal (which only
  // ever drops one record) — see save()'s own retry below.
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
      if (response.status >= 500) {
        // A 5xx means an uncaught exception on the server (a Python
        // traceback's own str(), e.g. a raw "[WinError 5] Access is
        // denied: ...\.tmp -> ...json" from a transient file-lock
        // collision) — not a client mistake, and not something a user can
        // act on by reading it. Every existing call site across the suite
        // just does `status.show(error.message)` on catch with no
        // per-site handling of this case, so the fix belongs here, once:
        // log the real detail to the console for whoever's debugging, and
        // let `error.message` be a clean, generic string instead.
        console.warn(`DataManager: server error on ${method} ${path}`, message);
        const error = new Error("Something went wrong on the server. Please try again.");
        error.status = response.status;
        error.payload = data;
        error.serverMessage = message;
        throw error;
      }
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

  // preferLocal's default is intentionally auth-dependent, not a flat
  // `true` — getLocal's mirror means two different things depending on who's
  // asking. For an anonymous user it's the ONLY copy (no server account),
  // so local-first isn't an optimization, it's correct by necessity. For a
  // signed-in user it's "purely a read-acceleration cache" (see save()'s
  // own comment) sitting on top of an authoritative server, with NO
  // invalidation signal from any other writer — another tool, another tab,
  // another device, another player in the same campaign. A flat default of
  // `true` silently carried the anonymous-only assumption into that
  // multi-writer case, where it's wrong far more often than not: confirmed
  // as the root cause behind three separate live-sync bugs traced to this
  // file this session (Orrery's loadMapById/refreshPreview serving a stale
  // local mirror even on a hard refresh; Combat Tracker changes never
  // reaching an already-open Orrery), and 83 of this suite's 105 call sites
  // already had to override it explicitly (almost all to `false`) rather
  // than rely on the bare default — strong evidence the default itself,
  // not each individual call site, was the actual bug. Passing `preferLocal`
  // explicitly (true OR false) always wins outright; only the unspecified
  // (`null`) case is resolved here, per-call, against live auth state.
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

  // One request, N `{id, body}` pairs back (not bare bodies — a record's own
  // JSON doesn't always embed its own id, see get_items_bulk's own comment,
  // server/storage.py) — server/app.py's POST /content/{bucket}/bulk,
  // replacing the old "one GET per record" pattern content-fetch.js's
  // fetchKindEntriesWithIds used to do. No local-cache fast path the way
  // get() has (preferLocal) — this is always used for a bulk library load
  // where content-fetch.js's own caching layer sits above this call, not
  // below it.
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
    // The server write above is the AUTHORITATIVE copy for a signed-in
    // user — this local write is purely a read-acceleration cache. Left
    // unguarded, a QuotaExceededError here (confirmed live: a growing
    // `feature`/`effect` bucket's whole-array JSON blob exceeding the
    // browser's per-origin localStorage cap during a large bulk import)
    // propagated as if the ENTIRE save had failed, even though the real,
    // authoritative server copy had already succeeded — every caller
    // (Loom's saveEntity, vault-feature-matching.js's own per-Feature
    // saves) treated a perfectly good save as an error, discarding
    // recoverable in-progress conversion state along the way. Best-effort
    // only: never lets a stale/oversized local cache turn a successful
    // save into a reported failure. On a genuine quota hit specifically
    // (not just any local-write error), self-heals by purging THIS one
    // bucket's stale cache and retrying once — otherwise the bucket would
    // stay permanently over quota and silently fail this same way on every
    // future save, forever, once it first happened. Anything OTHER than a
    // quota error (a truly unexpected local-storage failure) still only
    // warns, same as before — no reason to nuke a healthy bucket's cache
    // over an unrelated problem.
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

  async updatePassword({ current_password, new_password }) {
    return this._request("/auth/profile/password", {
      method: "POST",
      body: { current_password, new_password },
      auth: true,
    });
  }

  // A small per-user JSON blob stored directly on the users row (see
  // auth.py's _migrate_users_table_for_settings), not a Library kind — this
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
  // and this needs to send one recording chunk's raw audio bytes with its
  // own Content-Type instead. Mirrors _request's own auth-header handling
  // and error-message extraction so this still behaves the same way as
  // every other call here for an unauthenticated/failed request. `serverId`
  // picks which of the deployment's own saved transcription servers to use
  // (see listTranscriptionServers below) — sent as a query param since the
  // body here is the raw audio, not JSON.
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

  // Server-side half of the suite-wide header search (common/js/lib/
  // suite-search.js) — every kind at once, filtered to this signed-in
  // user's own owned/shared content (see storage.py's own search_content).
  // Uncached (unlike list/listOwnedContent above) — a search box firing a
  // fresh query on every keystroke has nothing sensible to cache against.
  // Returns [] uncalled for an anonymous session — nothing server-side is
  // an anonymous user's to own/be shared, so suite-search.js skips this
  // call entirely rather than making a request guaranteed to 401.
  async searchContent(query) {
    if (!this.isAuthenticated() || !query || !query.trim()) return [];
    const params = new URLSearchParams({ q: query.trim() });
    const payload = await this._request(`/content/search?${params.toString()}`, { method: "GET", auth: true });
    return Array.isArray(payload?.results) ? payload.results : [];
  }

  // includeMemberGroups (opt-in) also lists groups you don't own but have a
  // character added to (server's own ?scope=member — see groups.py's own
  // list_groups) — what auth-ui.js's account-menu campaign selector wants
  // ("which campaigns am I part of"), but NOT what Loom's own group-
  // management tab wants (default scope, owner-only — that UI offers
  // rename/delete/member-editing controls that only work on groups you
  // actually own). Cached per-scope (a plain Map, not a single value) so
  // one caller's broader request can never leak into the other's — every
  // existing `this._groupCache = null` invalidation elsewhere in this class
  // still works unchanged, since a falsy cache just gets rebuilt as a fresh
  // Map here regardless of which scope asks for it first.
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

  async createGroup({ name, type = "campaign" } = {}) {
    const payload = await this._request("/groups", {
      method: "POST",
      body: { name, type },
      auth: true,
    });
    this._groupCache = null;
    return payload;
  }

  async updateGroup({ id, name, systemId, settingId, templateId, properties, campaignDayIndex, campaignMinutesOfDay } = {}) {
    if (!id) {
      throw new Error("Group id is required");
    }
    const body = {};
    if (name !== undefined) body.name = name;
    if (systemId !== undefined) body.system_id = systemId;
    if (settingId !== undefined) body.setting_id = settingId;
    // The campaign's own "Party Data" template (Workbench's no-character
    // mode) — independent of any one Character's own `template` field.
    if (templateId !== undefined) body.template_id = templateId;
    // The Group Properties SCHEMA (Loom's own Group tab) — not a value
    // write, see updateGroupPropertyValue below for that.
    if (properties !== undefined) body.properties = properties;
    // The campaign's own tracked "what date is it in the fiction" — same
    // conceptual tier as systemId/settingId above. setCampaignDate below
    // is the purpose-named entry point most callers actually want; this
    // stays generic so a future combined save (e.g. a Loom Group editor
    // field) can still set it alongside other Group fields in one request.
    if (campaignDayIndex !== undefined) body.campaign_day_index = campaignDayIndex;
    if (campaignMinutesOfDay !== undefined) body.campaign_minutes_of_day = campaignMinutesOfDay;
    const payload = await this._request(`/groups/${encodeURIComponent(id)}`, {
      method: "POST",
      body,
      auth: true,
    });
    this._groupCache = null;
    return payload;
  }

  // Thin, purpose-named wrapper over updateGroup for the one common write
  // every campaign-date UI (the Calendar widget, currently the only one)
  // actually needs — advance the day, optionally the time of day too.
  // Emits its own event (unlike updateGroup itself, which has no reason to
  // — most callers already re-render off their own await) since the
  // ambient date is meant to be visible to every tool: more than one
  // Calendar widget can be on the same dashboard at once, each reading
  // this same shared value, and only the ONE that made this particular
  // change already knows to re-render itself.
  async setCampaignDate(groupId, { dayIndex, minutesOfDay } = {}) {
    const payload = await this.updateGroup({ id: groupId, campaignDayIndex: dayIndex, campaignMinutesOfDay: minutesOfDay });
    this._emit("undercroft:campaign-date-changed", {
      groupId,
      dayIndex: payload?.campaign_day_index,
      minutesOfDay: payload?.campaign_minutes_of_day,
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

  // `types` (optional) restricts the LIMIT-bounded server query to specific
  // entry types instead of the group's raw, most-recent-N-of-everything log
  // — see groups.py's _fetch_group_log_entries's own comment for why this
  // matters: spotlight.js's own resolution passes the three spotlight-
  // related types so ordinary chat/roll entries (and a single chatty
  // inline-kind widget's own frequent spotlight-update refreshes) can't
  // crowd an unrelated widget's still-active spotlight entry out of the
  // fetched window. Omit for the Game Log widget's own read, which wants
  // everything, unfiltered, exactly as before.
  async getGroupLog({ groupId = "", shareToken = "", limit = undefined, types = undefined } = {}) {
    const token = shareToken ? String(shareToken) : "";
    const params = new URLSearchParams();
    if (limit !== undefined && limit !== null) {
      params.set("limit", String(limit));
    }
    if (Array.isArray(types) && types.length) {
      params.set("types", types.join(","));
    }
    const query = params.toString() ? `?${params.toString()}` : "";
    if (token) {
      return this._request(`/groups/share/${encodeURIComponent(token)}/log${query}`, {
        method: "GET",
        auth: false,
      });
    }
    if (!groupId) {
      throw new Error("Group id is required to load the game log");
    }
    return this._request(`/groups/${encodeURIComponent(groupId)}/log${query}`, {
      method: "GET",
      auth: true,
    });
  }

  async createGroupLogEntry({
    groupId = "",
    shareToken = "",
    type = "message",
    message = "",
    payload = undefined,
    recipientIds = undefined,
    inCharacter = undefined,
  } = {}) {
    const body = { type, message, payload, recipientIds, inCharacter };
    const token = shareToken ? String(shareToken) : "";
    if (token) {
      return this._request(`/groups/share/${encodeURIComponent(token)}/log`, {
        method: "POST",
        body,
        auth: true,
      });
    }
    if (!groupId) {
      throw new Error("Group id is required to post to the game log");
    }
    return this._request(`/groups/${encodeURIComponent(groupId)}/log`, {
      method: "POST",
      body,
      auth: true,
    });
  }

  // A transient pointer broadcast (Orrery's click-to-ping map tool) —
  // deliberately NOT createGroupLogEntry: a ping never touches the
  // database/group log at all (see server/state.py's ServerState.
  // pending_pings for why), it only ever exists in-memory server-side long
  // enough for the /live/{groupId} SSE stream's "ping" kind to relay it to
  // whoever's currently subscribed.
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

  // "Show to table": one call does both halves of the one-click ask — make
  // sure the group can actually see this record (share_with_group is an
  // idempotent upsert, safe to call every time, not just the first), then
  // post the spotlight log entry the group's share-link page polls for.
  // Also shares the template (if any) for the same reason: a private,
  // GM-authored template needs the same visibility grant as the entity
  // itself, or an anonymous share-link viewer's card render 403s on the
  // template fetch even though the entity fetch succeeds.
  // `skipShare` — for a widget type with no real Library record behind it at
  // all (the Dashboard's own Browser/Clock widgets: their content lives
  // entirely in this log entry's own `data` payload, not a shareable record
  // — see server/groups.py's own _INLINE_SPOTLIGHT_KINDS) — there's nothing
  // to grant view permission ON, so this skips straight to posting the log
  // entry; the server enforces the same "only these specific kinds may skip
  // sharing" rule independently, this flag is just what avoids a doomed
  // share_with_group call for one of them here.
  // `data` — the inline payload for those same kinds (e.g. Browser's
  // `{url}`, Clock's own config object). Ignored by the server for any kind
  // with a real Library record, since that record is always the source of
  // truth for those.
  async spotlightToGroup({ groupId, contentType, contentId, templateId = "", skipShare = false, data = undefined } = {}) {
    if (!groupId || !contentType || !contentId) {
      throw new Error("groupId, contentType, and contentId are required");
    }
    if (!skipShare) {
      // "map" and "encounter" are the spotlighted kinds a player is ever
      // expected to write back to (their own character's token position —
      // see map.js's own isMarkerDraggable/ownership check; their own
      // combatant's initiative — see character-sheet.js's own
      // pushInitiativeToActiveEncounter) — every other kind (npc, location,
      // handout content, ...) is genuinely read-only for a player, so "view"
      // stays correct there. Confirmed real bug (map, fixed first): a
      // view-only share left save_item's own is_shared(require_edit:true)
      // check failing for a player writing their own narrow update into a
      // shared record, surfacing as "Edit not permitted" even after the
      // client-side write itself was already correctly scoped to just that
      // player's own data. Confirmed the identical bug for "encounter" —
      // rolling initiative from a shown-to-table combat failed the exact
      // same way, since only "map" had this carve-out.
      const spotlightPermissions = contentType === "map" || contentType === "encounter" ? "edit" : "view";
      await this.shareWithGroup({ contentType, contentId, groupId, permissions: spotlightPermissions });
      if (templateId) {
        await this.shareWithGroup({ contentType: "templates", contentId: templateId, groupId, permissions: "view" });
      }
    }
    const result = await this.createGroupLogEntry({
      groupId,
      type: "spotlight",
      payload: { kind: contentType, id: contentId, templateId: templateId || undefined, data },
    });
    // Lets anything watching THIS browser tab's own actions (dashboard.js's
    // spotlight panel) refresh immediately instead of waiting for its own
    // poll/live-stream round-trip — confirmed real complaint: a GM's own
    // "show to table" toggle could take several seconds to show up in their
    // own icon tray, reading as "is this even working." A live-stream event
    // still has to round-trip through the server; this fires synchronously,
    // in-page, the instant the action this tab itself took has actually
    // succeeded.
    this._emit("undercroft:spotlight-changed", { groupId, kind: contentType, id: contentId });
    return result;
  }

  // Refreshes the `data` payload on an ALREADY-shown inline-kind spotlight
  // (a clock tick, a Browser URL edit) without re-announcing it as a new
  // "show to table" — a fresh `spotlight` entry would re-trigger every other
  // viewer's accept-prompt/Game Log row on every single edit, which is not
  // what a live content update should do. Followers (spotlight.js's
  // resolveSpotlightData/resolveIsSpotlighted) treat this the same as
  // `spotlight` for "is this still active, and with what data" purposes;
  // only a `spotlight-clear` ends it. Only valid for
  // server/groups.py's own _INLINE_SPOTLIGHT_KINDS — the server rejects it
  // for anything else.
  async updateSpotlightData({ groupId, shareToken = "", kind, id, data } = {}) {
    if ((!groupId && !shareToken) || !kind || !id) {
      throw new Error("groupId (or shareToken), kind, and id are required");
    }
    return this.createGroupLogEntry({ groupId, shareToken, type: "spotlight-update", payload: { kind, id, data } });
  }

  // The other half of "show to table" — posts a `spotlight-clear` entry, so
  // anything reading "what's currently shown" (Now Showing panels, the
  // Combat Tracker's player view, the anonymous share-link's narrow
  // get_item exception) sees nothing again, without deleting log history.
  // `kind` + `id` scope the clear to just that ONE instance (a widget's own
  // eye-icon toggling off should only ever affect ITS OWN spotlight, not
  // every other instance of the same kind shown alongside it — two
  // Handouts, two Maps, two Clocks — see spotlight.js's own
  // resolveIsSpotlighted comment). `id` alone with no `kind` doesn't scope
  // anything (there's nothing to disambiguate an id by), so it's ignored
  // unless `kind` is also given; `kind` with no `id` clears every instance
  // of that kind; omitting both is a deliberate "clear whatever's currently
  // shown, of any kind" (the one legitimate use of that: auth-ui.js's global
  // "stop showing to the table" header action, which isn't tied to any one
  // tool/kind/instance).
  async clearSpotlight({ groupId, shareToken = "", kind = "", id = "" } = {}) {
    if (!groupId && !shareToken) {
      throw new Error("groupId is required");
    }
    let payload;
    if (kind) payload = id ? { kind, id } : { kind };
    const result = await this.createGroupLogEntry({ groupId, shareToken, type: "spotlight-clear", payload });
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

  // Sibling of shareWithUser/revokeShare for a campaign-group target instead
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
