export function encodeShare(code: string): string {
  const bytes = new TextEncoder().encode(code);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeShare(hash: string): string | null {
  try {
    const b64 = hash.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '==='.slice((b64.length + 3) % 4);
    const bin = atob(pad);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function readInitialCode(): string | null {
  const url = new URL(location.href);
  const q = url.searchParams.get('code');
  if (q) {
    try {
      return decodeURIComponent(q);
    } catch {
      return q;
    }
  }
  if (url.hash.startsWith('#code=')) {
    return decodeShare(url.hash.slice(6));
  }
  return null;
}

export function writeShareUrl(code: string) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = 'code=' + encodeShare(code);
  history.replaceState(null, '', url.toString());
  return url.toString();
}
