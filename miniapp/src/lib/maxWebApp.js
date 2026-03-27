export function getMaxWebApp() {
  return (
    window.WebApp ||
    window.Telegram?.WebApp ||
    window.Max?.WebApp ||
    window.MAX?.WebApp ||
    window.MiniApp ||
    null
  );
}

export function getInitData() {
  const webApp = getMaxWebApp();
  if (webApp?.initData) {
    return webApp.initData;
  }

  const searchParams = new URLSearchParams(window.location.search);
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const hashParams = new URLSearchParams(hash);

  return (
    searchParams.get("initData") ||
    searchParams.get("init_data") ||
    searchParams.get("tgWebAppData") ||
    hashParams.get("initData") ||
    hashParams.get("init_data") ||
    hashParams.get("tgWebAppData") ||
    ""
  );
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

export function getMaxUserId() {
  const webApp = getMaxWebApp();

  const unsafeUserId = String(webApp?.initDataUnsafe?.user?.id ?? "").trim();
  if (unsafeUserId) {
    return unsafeUserId;
  }

  const initDataUserId = getMaxUserIdFromInitData(getInitData());
  if (initDataUserId) {
    return initDataUserId;
  }

  const searchParams = new URLSearchParams(window.location.search);
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const hashParams = new URLSearchParams(hash);

  return (
    searchParams.get("user_id") ||
    searchParams.get("userid") ||
    searchParams.get("uid") ||
    hashParams.get("user_id") ||
    hashParams.get("userid") ||
    hashParams.get("uid") ||
    ""
  );
}

export function readyWebApp() {
  const webApp = getMaxWebApp();
  if (webApp?.ready) {
    webApp.ready();
  }
}

export function closeWebApp() {
  const webApp = getMaxWebApp();
  if (webApp?.close) {
    webApp.close();
  }
}
