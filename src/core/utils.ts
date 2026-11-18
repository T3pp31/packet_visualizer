export function formatMac(bytes: Uint8Array, offset = 0): string | null {
  if (!Number.isInteger(offset) || offset < 0 || offset + 6 > bytes.length) {
    return null;
  }
  const parts: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    parts.push(bytes[offset + i].toString(16).padStart(2, '0'));
  }
  return parts.join(':');
}

export function formatIp(bytes: Uint8Array, offset = 0): string | null {
  if (!Number.isInteger(offset) || offset < 0 || offset + 4 > bytes.length) {
    return null;
  }
  return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
}

export function isBroadcastMac(mac: string): boolean {
  return mac.toLowerCase() === 'ff:ff:ff:ff:ff:ff';
}

export function isZeroMac(mac: string): boolean {
  return mac.toLowerCase() === '00:00:00:00:00:00';
}

export function normalizeMac(mac: string): string {
  return mac.toLowerCase();
}

export function nodeIdFromMac(mac: string): string {
  return `mac:${normalizeMac(mac)}`;
}

export function nodeIdFromIp(ip: string): string {
  return `ip:${ip}`;
}

export function linkId(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function subnet24(ip: string): string | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}
