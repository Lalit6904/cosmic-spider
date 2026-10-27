import { Router } from "express";
import { z } from "zod";
import { parseInput } from "../lib/errors.js";
import { asyncHandler, httpLimiters, requireJson } from "../middleware/security.js";
import { optionalAuth, requireAuth, requireCsrf } from "../middleware/auth.js";
import {
  changePassword,
  forgotPassword,
  getGlobalLeaderboard,
  getProfile,
  loginUser,
  logout,
  registerUser,
  resetPassword
} from "../services/authService.js";
import { ensureCsrfToken } from "../services/sessions.js";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema
} from "../validation/schemas.js";
const loginBodySchema = loginSchema;
const forgotBodySchema = forgotPasswordSchema;
const resetBodySchema = resetPasswordSchema;
const changeBodySchema = changePasswordSchema;
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function createApiRouter(hub) {
  const router = Router();
  router.get("/auth/session", optionalAuth, asyncHandler(async (req, res) => {
    if (!req.auth) {
      res.json({ authenticated: false, user: null, csrfToken: null });
      return;
    }
    const csrfToken = await ensureCsrfToken(req, res);
    res.json({ authenticated: true, user: req.auth.user, csrfToken });
  }));
  router.post(
    "/auth/register",
    httpLimiters.register,
    requireJson,
    asyncHandler(async (req, res) => {
      const input = parseInput(registerSchema, req.body);
      const result = await registerUser(input, req, res);
      res.status(201).json(result);
    })
  );
  router.post(
    "/auth/login",
    httpLimiters.login,
    requireJson,
    asyncHandler(async (req, res) => {
      const input = parseInput(loginBodySchema, req.body);
      const result = await loginUser(input, req, res);
      res.json(result);
    })
  );
  router.post(
    "/auth/logout",
    requireAuth,
    requireCsrf,
    asyncHandler(async (req, res) => {
      await logout(req, res);
      res.status(204).end();
    })
  );
  router.post(
    "/auth/forgot-password",
    httpLimiters.forgot,
    requireJson,
    asyncHandler(async (req, res) => {
      const input = parseInput(forgotBodySchema, req.body);
      const started = Date.now();
      await forgotPassword(input.email);
      const remaining = 250 - (Date.now() - started);
      if (remaining > 0) await delay(remaining);
      res.json({
        message: "If an account exists for that email, a reset link has been sent."
      });
    })
  );
  router.post(
    "/auth/reset-password",
    httpLimiters.reset,
    requireJson,
    asyncHandler(async (req, res) => {
      const input = parseInput(resetBodySchema, req.body);
      await resetPassword(input.token, input.password);
      res.json({ message: "Your password has been reset. Sign in with your new password." });
    })
  );
  router.post(
    "/auth/change-password",
    requireAuth,
    requireCsrf,
    httpLimiters.passwordChange,
    requireJson,
    asyncHandler(async (req, res) => {
      const input = parseInput(changeBodySchema, req.body);
      const auth = req.auth;
      const result = await changePassword(
        req,
        res,
        auth.user.id,
        input.currentPassword,
        input.newPassword
      );
      res.json(result);
    })
  );
  router.get(
    "/profile",
    requireAuth,
    httpLimiters.profile,
    asyncHandler(async (req, res) => {
      const profile = await getProfile(req.auth.user.id);
      res.json(profile);
    })
  );
  router.get(
    "/leaderboard",
    requireAuth,
    httpLimiters.leaderboard,
    asyncHandler(async (_req, res) => {
      res.json({ leaderboard: await getGlobalLeaderboard() });
    })
  );
  router.get(
    "/rooms/public",
    requireAuth,
    httpLimiters.profile,
    asyncHandler(async (_req, res) => {
      res.json({ rooms: hub.listPublicRooms() });
    })
  );
  return router;
}
const healthSchema = z.object({ ready: z.boolean() });
export {
  createApiRouter,
  healthSchema
};
