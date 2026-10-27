let csrfToken = null;
class ApiError extends Error {
  status;
  code;
  fields;
  constructor(status, code, message, fields) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}
function setCsrfToken(token) {
  csrfToken = token;
}
function getCsrfToken() {
  return csrfToken;
}
async function apiFetch(path, options = {}) {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  if (options.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers,
      credentials: "include",
      signal: options.signal
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Could not reach the Cosmic Spider server.");
  }
  if (response.status === 204) return void 0;
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Some responses (such as 204s) have no JSON body.
  }
  if (!response.ok) {
    const errorBody = body;
    throw new ApiError(
      response.status,
      errorBody?.error?.code ?? "REQUEST_FAILED",
      errorBody?.error?.message ?? "The request could not be completed.",
      errorBody?.error?.fields
    );
  }
  return body;
}
async function fetchSession() {
  const session = await apiFetch("/api/auth/session");
  setCsrfToken(session.csrfToken);
  return session;
}
async function loginRequest(email, password) {
  const result = await apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  setCsrfToken(result.csrfToken);
  return result;
}
async function registerRequest(username, email, password) {
  const result = await apiFetch("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, email, password })
  });
  setCsrfToken(result.csrfToken);
  return result;
}
async function logoutRequest() {
  await apiFetch("/api/auth/logout", { method: "POST" });
  setCsrfToken(null);
}
async function forgotPasswordRequest(email) {
  return apiFetch("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email })
  });
}
async function resetPasswordRequest(token, password) {
  return apiFetch("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password })
  });
}
async function changePasswordRequest(currentPassword, newPassword) {
  const result = await apiFetch("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword })
  });
  setCsrfToken(result.csrfToken);
  return result;
}
async function fetchProfile() {
  return apiFetch("/api/profile");
}
export {
  ApiError,
  apiFetch,
  changePasswordRequest,
  fetchProfile,
  fetchSession,
  forgotPasswordRequest,
  getCsrfToken,
  loginRequest,
  logoutRequest,
  registerRequest,
  resetPasswordRequest,
  setCsrfToken
};
