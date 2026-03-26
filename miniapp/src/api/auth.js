import { apiFetch } from "./client";

export function handshakeWithMax(initData) {
  return apiFetch("/api/auth/max/handshake", {
    method: "POST",
    body: JSON.stringify({ initData })
  });
}

export function refreshSession() {
  return apiFetch("/api/auth/refresh", { method: "POST" });
}

export function fetchMe(accessToken) {
  return apiFetch("/api/auth/me", {}, accessToken);
}
