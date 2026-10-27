import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import {
  fetchSession,
  loginRequest,
  logoutRequest,
  registerRequest,
  setCsrfToken
} from "../lib/api.js";
const AuthContext = createContext(null);
function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const session = await fetchSession();
      setUser(session.authenticated ? session.user : null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const login = useCallback(async (email, password) => {
    const result = await loginRequest(email, password);
    setUser(result.user);
  }, []);
  const register = useCallback(async (username, email, password) => {
    const result = await registerRequest(username, email, password);
    setUser(result.user);
  }, []);
  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      setCsrfToken(null);
      setUser(null);
    }
  }, []);
  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh, setUser }),
    [user, loading, login, register, logout, refresh]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
export {
  AuthProvider,
  useAuth
};
