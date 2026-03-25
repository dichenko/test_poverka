function getFallbackApiBaseUrl() {
  const { protocol, hostname } = window.location;

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:3000`;
  }

  return (
    import.meta.env.VITE_DEFAULT_BACKEND_PUBLIC_URL ||
    'https://poverka-test-api.liven8n.site'
  );
}

export function getApiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL || getFallbackApiBaseUrl();
}

async function parseJson(response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMessage = data.error || 'Request failed.';
    throw new Error(errorMessage);
  }

  return data;
}

export async function getMiniappAccess(userId, token) {
  const url = new URL('/api/miniapp/access', getApiBaseUrl());
  url.searchParams.set('user_id', userId);
  url.searchParams.set('token', token);

  const response = await fetch(url.toString());
  return parseJson(response);
}

export async function submitMiniappForm(payload) {
  const response = await fetch(`${getApiBaseUrl()}/api/miniapp/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  return parseJson(response);
}
