const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

export function canonicalDevURL(currentHref: string, canonicalHostname: string): string | null {
  const targetHostname = normalizeHostname(canonicalHostname);
  if (!LOOPBACK_HOSTS.has(targetHostname)) return null;

  let current: URL;
  try {
    current = new URL(currentHref);
  } catch {
    return null;
  }

  const currentHostname = normalizeHostname(current.hostname);
  if (!LOOPBACK_HOSTS.has(currentHostname) || currentHostname === targetHostname) return null;

  current.hostname = targetHostname === "::1" ? "[::1]" : targetHostname;
  return current.href;
}

export function redirectToCanonicalDevOrigin(
  location: Pick<Location, "href" | "replace">,
  canonicalHostname: string,
): boolean {
  const target = canonicalDevURL(location.href, canonicalHostname);
  if (!target) return false;
  location.replace(target);
  return true;
}
