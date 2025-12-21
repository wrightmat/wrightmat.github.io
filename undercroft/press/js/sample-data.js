const STORAGE_KEY = "undercroft.press.sampleData";
const DEFAULT_SAMPLE_DATA_URL = new URL("../data/sample-data.json", import.meta.url);

let sampleData = {};
let sampleDataText = "";
let isLoaded = false;
const subscribers = new Set();

function notifySubscribers() {
  subscribers.forEach((listener) => {
    try {
      listener(sampleData);
    } catch (error) {
      console.warn("Sample data listener failed", error);
    }
  });
}

function serializeSampleData(data) {
  try {
    return JSON.stringify(data ?? {}, null, 2);
  } catch (error) {
    console.warn("Unable to serialize sample data", error);
    return "{}";
  }
}

async function loadDefaultSampleData() {
  try {
    const response = await fetch(DEFAULT_SAMPLE_DATA_URL);
    if (!response.ok) {
      throw new Error(`Unable to load sample data (${response.status})`);
    }
    return await response.json();
  } catch (error) {
    console.warn("Falling back to empty sample data", error);
    return {};
  }
}

export async function loadSampleData() {
  if (isLoaded) return { data: sampleData, text: sampleDataText };
  const fallback = await loadDefaultSampleData();
  let storedText = null;
  try {
    storedText = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn("Unable to read stored sample data", error);
  }

  if (storedText) {
    try {
      sampleData = JSON.parse(storedText);
      sampleDataText = storedText;
    } catch (error) {
      console.warn("Stored sample data was invalid, resetting", error);
      sampleData = fallback;
      sampleDataText = serializeSampleData(fallback);
    }
  } else {
    sampleData = fallback;
    sampleDataText = serializeSampleData(fallback);
  }

  isLoaded = true;
  return { data: sampleData, text: sampleDataText };
}

export function getSampleData() {
  return sampleData;
}

export function getSampleDataText() {
  return sampleDataText;
}

export function setSampleDataText(nextText) {
  sampleDataText = nextText ?? "";
  try {
    const parsed = JSON.parse(sampleDataText || "{}");
    sampleData = parsed;
    try {
      localStorage.setItem(STORAGE_KEY, sampleDataText);
    } catch (error) {
      console.warn("Unable to persist sample data", error);
    }
    notifySubscribers();
    return { valid: true };
  } catch (error) {
    return { valid: false, error };
  }
}

export function subscribeSampleData(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}
