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

export function readyWebApp() {
  const webApp = getMaxWebApp();
  if (webApp?.ready) {
    webApp.ready();
  }
}
