import { apiFetch } from "./client";

export function createDraftSubmission(payload, accessToken) {
  return apiFetch(
    "/api/submissions/draft",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    accessToken
  );
}

export function listEquipmentTypes(accessToken) {
  return apiFetch("/api/submissions/equipment-types", {}, accessToken);
}

export function confirmSubmission(id, accessToken) {
  return apiFetch(`/api/submissions/${id}/confirm`, { method: "POST" }, accessToken);
}

export function listMySubmissions(accessToken) {
  return apiFetch("/api/submissions/me?limit=10", {}, accessToken);
}
