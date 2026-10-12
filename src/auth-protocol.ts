import { publicEncrypt, constants } from 'node:crypto';

export const ROOT = 'https://2class.cqut.edu.cn/';
export const LOGIN = 'https://uis.cqut.edu.cn/center-auth-server/sso/doLogin';
export const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

// Public authentication protocol verified against the school's mobile login page.
// This public key is not a credential. Never reuse a previously issued CAS ticket.
const KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDACwPDxYycdCiNeblZa9LjvDzb
iZU1vc9gKRcG/pGjZ/DJkI4HmoUE2r/o6SfB5az3s+H5JDzmOMVQ63hD7LZQGR4k
3iYWnCg3UpQZkZEtFtXBXsQHjKVJqCiEtK+gtxz4WnriDjf+e/CxJ7OD03e7sy5N
Y/akVmYNtghKZzz6jwIDAQAB
-----END PUBLIC KEY-----`;

export function encryptPassword(password: string): string {
  if (!password.trim()) throw new Error('EMPTY_PASSWORD');
  const chunks: string[] = [];
  for (let offset = 0; offset < password.length; offset += 29) {
    const encrypted = publicEncrypt({key: KEY, padding: constants.RSA_PKCS1_PADDING},
      Buffer.from(password.slice(offset, offset + 29), 'utf8')).toString('base64');
    chunks.push(encodeURI(encrypted));
  }
  return encodeURIComponent(JSON.stringify(chunks));
}

export function safeEndpoint(value: string): string {
  const url = new URL(value);
  return url.origin + url.pathname;
}

export function isSchoolHost(value: string): boolean {
  const url = new URL(value);
  return url.protocol === 'https:' && (url.hostname === 'cqut.edu.cn' || url.hostname.endsWith('.cqut.edu.cn'));
}

export function classifyLogin(code: unknown): string {
  if (code === 200) return 'accepted';
  if (code === 16300) return 'manual_second_factor_required';
  if (code === 601) return 'manual_identity_selection_required';
  if (code === 10029) return 'password_update_required';
  return 'rejected';
}

export function jsonShape(value: unknown, depth = 0): unknown {
  if (depth > 3) return 'nested';
  if (value === null) return 'null';
  if (Array.isArray(value)) return {kind:'array', item: value.length ? jsonShape(value[0], depth + 1) : 'empty'};
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 60).map(([k,v]) => [k, jsonShape(v, depth + 1)]));
  return typeof value;
}
