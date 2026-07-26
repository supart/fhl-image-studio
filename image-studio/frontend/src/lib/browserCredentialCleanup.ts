function isBrowserAPIKeyStorageKey(key: string): boolean {
  return key.includes(".image-studio.browser-key.")
    || key.startsWith("image-studio.browser-key.")
    || key === "gptcodex.apiKey"
    || key === "gptcodex.responses.apiKey"
    || key === "gptcodex.images.apiKey"
    || /\.gptcodex\.(responses\.|images\.)?apiKey$/.test(key);
}

export function clearBrowserCredentialStorage(): number {
  if (typeof localStorage === "undefined") return 0;
  const keys: string[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && isBrowserAPIKeyStorageKey(key)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
    return keys.length;
  } catch {
    return 0;
  }
}
