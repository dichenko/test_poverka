import { apiFetch } from "./client";

export function listOrganizations(accessToken) {
  return apiFetch("/api/admin/organizations", {}, accessToken);
}

export function listUsers(params, accessToken) {
  const search = new URLSearchParams(params);
  return apiFetch(`/api/admin/users?${search.toString()}`, {}, accessToken);
}

export function createUser(payload, accessToken) {
  return apiFetch(
    "/api/admin/users",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    accessToken
  );
}

export function updateUser(id, payload, accessToken) {
  return apiFetch(
    `/api/admin/users/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload)
    },
    accessToken
  );
}

export function listSubmissions(params, accessToken) {
  const search = new URLSearchParams(params);
  return apiFetch(`/api/admin/submissions?${search.toString()}`, {}, accessToken);
}

export function getSubmissionHistory(id, accessToken) {
  return apiFetch(`/api/admin/submissions/${id}/history`, {}, accessToken);
}

export function listAuditLogs(params, accessToken) {
  const search = new URLSearchParams(params);
  return apiFetch(`/api/admin/audit-logs?${search.toString()}`, {}, accessToken);
}
