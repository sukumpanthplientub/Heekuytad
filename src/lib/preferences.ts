// Storage can be unavailable in private/embedded browsers. Preferences must not
// prevent reading or saving real jobs.
export function getPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setPreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Optional browser preference. */
  }
}
