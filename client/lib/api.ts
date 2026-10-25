import type { ApiErrorBody, AuthUser, ProfileGame } from '../../shared/protocol';

let csrfToken: string | null = null;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);
  if (options.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken);
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers,
      credentials: 'include',
      signal: options.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the Cosmic Spider server.');
  }

  if (response.status === 204) return undefined as T;
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON response is treated as a generic server failure.
  }

  if (!response.ok) {
    const errorBody = body as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      errorBody?.error?.code ?? 'REQUEST_FAILED',
      errorBody?.error?.message ?? 'The request could not be completed.',
      errorBody?.error?.fields,
    );
  }
  return body as T;
}

export interface SessionResponse {
  authenticated: boolean;
  user: AuthUser | null;
  csrfToken: string | null;
}

export interface AuthResponse {
  user: AuthUser;
  csrfToken: string;
}

export async function fetchSession(): Promise<SessionResponse> {
  const session = await apiFetch<SessionResponse>('/api/auth/session');
  setCsrfToken(session.csrfToken);
  return session;
}

export async function loginRequest(email: string, password: string): Promise<AuthResponse> {
  const result = await apiFetch<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setCsrfToken(result.csrfToken);
  return result;
}

export async function registerRequest(
  username: string,
  email: string,
  password: string,
): Promise<AuthResponse> {
  const result = await apiFetch<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, email, password }),
  });
  setCsrfToken(result.csrfToken);
  return result;
}

export async function logoutRequest(): Promise<void> {
  await apiFetch<void>('/api/auth/logout', { method: 'POST' });
  setCsrfToken(null);
}

export async function forgotPasswordRequest(email: string): Promise<{ message: string }> {
  return apiFetch('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function resetPasswordRequest(token: string, password: string): Promise<{ message: string }> {
  return apiFetch('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });
}

export async function changePasswordRequest(
  currentPassword: string,
  newPassword: string,
): Promise<AuthResponse> {
  const result = await apiFetch<AuthResponse>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  setCsrfToken(result.csrfToken);
  return result;
}

export async function fetchProfile(): Promise<{ user: AuthUser; recentGames: ProfileGame[] }> {
  return apiFetch('/api/profile');
}
