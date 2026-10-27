import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState
} from "react";
const ToastContext = createContext(null);
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);
  const pushToast = useCallback((message, tone = "info") => {
    const id = nextId.current++;
    setToasts((current) => [...current.slice(-3), { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4500);
  }, []);
  const value = useMemo(() => ({ pushToast }), [pushToast]);
  return <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => <div key={toast.id} className={`toast toast--${toast.tone}`} role="status">
            <span className="toast__dot" aria-hidden="true" />
            {toast.message}
          </div>)}
      </div>
    </ToastContext.Provider>;
}
function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
export {
  ToastProvider,
  useToast
};
