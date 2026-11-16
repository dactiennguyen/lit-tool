// Best-effort localStorage for the zustand stores that remember things on this
// machine. Storage can be missing or full (private mode, quota): reads fall
// back to the default and writes are dropped, so the stores work in memory.
// Each store keeps its own key and value layout, so data saved by earlier
// builds still loads.

export function readStored<T>(key: string, parse: (raw: string) => T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : parse(raw);
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: memory only */
  }
}
