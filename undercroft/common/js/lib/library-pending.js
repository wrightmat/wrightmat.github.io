// Library kinds whose records are being fetched for a `libraryEntries()` formula. A formula that indexes into
// the (still empty) result throws on that first pass; bindings.js stays quiet about it while a fetch is in
// flight, because the data-ready re-render that follows evaluates it again with the real records. A leaf module
// so both formula-functions.js and bindings.js can share it without importing each other.
export const pendingLibraryKinds = new Set();
