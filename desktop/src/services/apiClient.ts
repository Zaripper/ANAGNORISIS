/**
 * API base resolution, in priority order:
 *  1. the server address saved from the login screen (client stations on the LAN
 *     point at the server machine, e.g. http://192.168.1.10:5000),
 *  2. the address injected by the Electron preload,
 *  3. localhost for single-machine setups and development.
 */
export function getApiBase() {
  const saved = localStorage.getItem('serverUrl');
  if (saved) return `${saved.replace(/\/+$/, '')}/api`;
  return (window as any).erp?.apiBaseUrl || 'http://127.0.0.1:5000/api';
}

export function getServerUrl(): string {
  return localStorage.getItem('serverUrl') || '';
}

export function setServerUrl(url: string) {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (trimmed) localStorage.setItem('serverUrl', trimmed);
  else localStorage.removeItem('serverUrl');
}

export function getToken() {
  return localStorage.getItem('token');
}

export function setSession(token: string | null, user: unknown | null) {
  if (token) localStorage.setItem('token', token);
  else localStorage.removeItem('token');
  if (user) localStorage.setItem('user', JSON.stringify(user));
  else localStorage.removeItem('user');
}

export function getStoredUser<T = any>(): T | null {
  const raw = localStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
}

/**
 * Thin fetch wrapper: attaches the bearer token, normalizes JSON errors into
 * ApiError, and centralizes the base URL.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`${getApiBase()}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });

  if (response.status === 401) {
    setSession(null, null);
    throw new ApiError('SESSION_EXPIRED', 401);
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    throw new ApiError(payload?.message ?? `HTTP_${response.status}`, response.status);
  }
  return payload as T;
}
