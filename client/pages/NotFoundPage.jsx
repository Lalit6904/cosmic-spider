import { Link } from "react-router-dom";
import { Logo } from "../components/Layout.jsx";
function NotFoundPage() {
  return <div className="centered-page">
      <div className="empty-orbit" aria-hidden="true">
        <Logo compact />
      </div>
      <span className="eyebrow">404 · Lost in space</span>
      <h1>This constellation isn&apos;t on our chart.</h1>
      <p className="lede">The page may have drifted out of orbit, or the room has closed.</p>
      <Link to="/" className="button button--primary">
        Return to mission control
      </Link>
    </div>;
}
export {
  NotFoundPage
};
