// Sign-in, first setup and account management routes for the Admin app (v6.0.0).
import express from "express";
import crypto from "node:crypto";
import {AccountError, MIN_PASSWORD, sessionCookie, sessionToken} from "./accounts.js";

const loopback = req => {
  const ip = String(req.socket?.remoteAddress || "");
  return !req.headers["x-forwarded-for"] && (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1");
};
const secureRequest = req => req.secure || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
const clientIp = req => String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();

// enabled(): accounts apply to this app (the Admin edition). required(): sign-in is enforced now.
// setupCode: needed for first setup from anywhere but this computer (a hosted Admin); shown in the server log.
export function accountRoutes({store, enabled, required, setupCode, log = console.log}) {
  const router = express.Router();
  router.use(express.json({limit: "64kb"}));
  const failures = new Map(); // ip -> [timestamps], a simple brake on password guessing across usernames
  const tooMany = ip => {
    const cutoff = Date.now() - 15 * 60 * 1000, list = (failures.get(ip) || []).filter(t => t > cutoff);
    failures.set(ip, list); if (failures.size > 2000) failures.clear();
    return list.length >= 20;
  };
  const fail = (res, error) => res.status(error.status || 500).json({error: error.message || "The request failed.", ...(error.mustChange ? {mustChange: true} : {})});
  const run = fn => async (req, res) => { try { await fn(req, res); } catch (error) { fail(res, error instanceof AccountError ? error : new AccountError("The account request failed.", 500)); } };
  const signedIn = req => store.session(sessionToken(req));
  const needOwner = req => {
    const me = signedIn(req);
    if (!me) throw new AccountError("Sign in to ISAF.", 401);
    if (me.mustChange) throw new AccountError("Change your temporary password first.", 403, {mustChange: true});
    if (me.role !== "owner") throw new AccountError("Only an Owner can manage accounts.", 403);
    return me;
  };

  router.get("/status", (req, res) => {
    if (!enabled()) return res.json({enabled: false});
    const me = signedIn(req);
    res.json({enabled: true, required: required(), setupNeeded: !store.hasAccounts(), setupCodeRequired: !loopback(req),
      minPassword: MIN_PASSWORD, signedIn: !!me, user: me || null});
  });

  router.post("/setup", run((req, res) => {
    if (!enabled()) throw new AccountError("Accounts are not used in this app.", 404);
    if (!loopback(req)) {
      const given = String(req.body?.setupCode || "").trim().toUpperCase(), expected = String(setupCode || "");
      const ok = expected && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
      if (!ok) throw new AccountError("The setup code is not correct. It is shown in the server log when ISAF starts.", 403);
    }
    const {token, account} = store.setup(req.body || {});
    log(`ISAF accounts: Owner account "${account.username}" created.`);
    res.setHeader("Set-Cookie", sessionCookie(token, {secure: secureRequest(req)}));
    res.json({user: account});
  }));

  router.post("/signin", run((req, res) => {
    if (!enabled()) throw new AccountError("Accounts are not used in this app.", 404);
    const ip = clientIp(req);
    if (tooMany(ip)) throw new AccountError("Too many sign-in attempts from this computer. Wait 15 minutes and try again.", 429);
    try {
      const {token, account} = store.signIn({username: req.body?.username, password: req.body?.password, ip});
      res.setHeader("Set-Cookie", sessionCookie(token, {secure: secureRequest(req)}));
      res.json({user: account});
    } catch (error) { failures.get(ip)?.push(Date.now()) ?? failures.set(ip, [Date.now()]); throw error; }
  }));

  router.post("/signout", (req, res) => {
    store.signOut(sessionToken(req));
    res.setHeader("Set-Cookie", sessionCookie("", {clear: true, secure: secureRequest(req)}));
    res.json({ok: true});
  });

  router.post("/password", run((req, res) => {
    const me = signedIn(req);
    if (!me) throw new AccountError("Sign in to ISAF.", 401);
    res.json({user: store.changePassword(me.id, {current: req.body?.current, password: req.body?.password})});
  }));

  router.get("/users", run((req, res) => { needOwner(req); res.json(store.list()); }));
  router.post("/users", run((req, res) => { const me = needOwner(req); res.status(201).json(store.create(me, req.body || {})); }));
  router.patch("/users/:id", run((req, res) => { const me = needOwner(req); res.json(store.update(me, req.params.id, req.body || {})); }));
  return router;
}
