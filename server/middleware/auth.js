import { authenticateRequest, assertCsrf } from "../services/sessions.js";
async function optionalAuth(req, _res, next) {
  if (req.auth) {
    next();
    return;
  }
  try {
    const auth = await authenticateRequest(req);
    if (auth) req.auth = auth;
    next();
  } catch (error) {
    next(error);
  }
}
async function requireAuth(req, res, next) {
  try {
    if (!req.auth) {
      const auth = await authenticateRequest(req);
      if (auth) req.auth = auth;
    }
    if (!req.auth) {
      res.status(401).json({
        error: { code: "UNAUTHENTICATED", message: "Sign in to continue.", requestId: req.requestId }
      });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}
function requireCsrf(req, _res, next) {
  try {
    assertCsrf(req);
    next();
  } catch (error) {
    next(error);
  }
}
export {
  optionalAuth,
  requireAuth,
  requireCsrf
};
