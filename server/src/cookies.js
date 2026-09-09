/**
 * Minimal cookie read/write.
 *
 * The app sets exactly one cookie holding one opaque base64url token, so a
 * plugin would be more configuration than code. Deliberately not a general
 * cookie library: no signing (the token is 32 random bytes and carries no
 * claims), no multi-value handling.
 */

export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return undefined; // malformed percent-encoding — treat as absent
    }
  }
  return undefined;
}

export function serializeCookie(name, value, { path, maxAge, secure }) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  return parts.join("; ");
}

export function clearedCookie(name, { path, secure }) {
  return serializeCookie(name, "", { path, maxAge: 0, secure });
}
