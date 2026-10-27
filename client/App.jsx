import { lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout.jsx";
import { useAuth } from "./context/AuthContext.jsx";
const AboutPage = lazy(() => import("./pages/AboutPage.jsx").then((module) => ({ default: module.AboutPage })));
const AuthPage = lazy(() => import("./pages/AuthPage.jsx").then((module) => ({ default: module.AuthPage })));
const ForgotPasswordPage = lazy(
  () => import("./pages/ForgotPasswordPage.jsx").then((module) => ({ default: module.ForgotPasswordPage }))
);
const LobbyPage = lazy(() => import("./pages/LobbyPage.jsx").then((module) => ({ default: module.LobbyPage })));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage.jsx").then((module) => ({ default: module.NotFoundPage })));
const ProfilePage = lazy(() => import("./pages/ProfilePage.jsx").then((module) => ({ default: module.ProfilePage })));
const ResetPasswordPage = lazy(
  () => import("./pages/ResetPasswordPage.jsx").then((module) => ({ default: module.ResetPasswordPage }))
);
const RoomPage = lazy(() => import("./pages/RoomPage.jsx").then((module) => ({ default: module.RoomPage })));
function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader label="Checking your star chart…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  return children;
}
function PageLoader({ label }) {
  return <div className="page-loader" role="status">
      <span className="orbit-loader" aria-hidden="true">
        <span />
      </span>
      <p>{label}</p>
    </div>;
}
function App() {
  const { loading } = useAuth();
  if (loading) {
    return <div className="boot-screen">
        <div className="boot-screen__glow" aria-hidden="true" />
        <PageLoader label="Aligning the constellations…" />
      </div>;
  }
  return <Routes>
      <Route element={<Layout />}>
        <Route index element={<LobbyPage />} />
        <Route path="login" element={<AuthPage mode="login" />} />
        <Route path="register" element={<AuthPage mode="register" />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset/:token" element={<ResetPasswordPage />} />
        <Route path="about" element={<AboutPage />} />
        <Route
    path="profile"
    element={<Protected>
              <ProfilePage />
            </Protected>}
  />
        <Route
    path="room/:code"
    element={<Protected>
              <RoomPage />
            </Protected>}
  />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>;
}
export {
  App
};
