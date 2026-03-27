export function getMaxWebApp() {
  return window.WebApp || window.Telegram?.WebApp || null;
}

export function getInitData() {
  const webApp = getMaxWebApp();
  if (webApp?.initData) {
    return webApp.initData;
  }
  const params = new URLSearchParams(window.location.search);
  return params.get("initData") || "";
}

export function getMaxUserIdFromInitData(initData) {
  try {
    const params = new URLSearchParams(initData || "");
    const rawUser = params.get("user");
    if (!rawUser) {
      return "";
    }

    const user = JSON.parse(rawUser);
    return user?.id ? String(user.id) : "";
  } catch {
    return "";
  }
}

export function readyWebApp() {
  const webApp = getMaxWebApp();
  if (webApp?.ready) {
    webApp.ready();
  }
}
