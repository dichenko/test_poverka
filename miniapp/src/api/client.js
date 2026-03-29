function fallbackBaseUrl() {
  const { protocol, hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//${hostname}:3000`;
  }
  return import.meta.env.VITE_DEFAULT_BACKEND_PUBLIC_URL || "http://localhost:3000";
}

export function getBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL || fallbackBaseUrl();
}

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || "Request failed";
    const code = data?.error?.code || "REQUEST_ERROR";
    const error = new Error(message);
    error.code = code;
    error.details = data?.error?.details;
    throw error;
  }
  return data;
}

export async function apiFetch(path, options = {}, accessToken) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${getBaseUrl()}${path}`, {
    ...options,
    headers,
    credentials: "include"
  });

  return parseResponse(response);
}
