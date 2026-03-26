import { useEffect, useState } from "react";
import { fetchMe, handshakeWithMax } from "../api/auth";
import { getInitData, readyWebApp } from "../lib/maxWebApp";

export function useAuth() {
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState("");
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");

  useEffect(() => {
    let mounted = true;

    async function run() {
      readyWebApp();
      setLoading(true);
      setError("");
      setErrorCode("");
      try {
        const initData = getInitData();
        if (!initData) {
          throw Object.assign(new Error("MAX initData is missing."), { code: "INITDATA_MISSING" });
        }
        const auth = await handshakeWithMax(initData);
        if (!mounted) {
          return;
        }
        setAccessToken(auth.accessToken);

        const me = await fetchMe(auth.accessToken);
        if (!mounted) {
          return;
        }
        setUser(me.user);
      } catch (err) {
        if (!mounted) {
          return;
        }
        setError(err.message || "Authorization failed");
        setErrorCode(err.code || "AUTH_ERROR");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    run();
    return () => {
      mounted = false;
    };
  }, []);

  return {
    loading,
    accessToken,
    user,
    error,
    errorCode
  };
}
