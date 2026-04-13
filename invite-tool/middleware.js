const views = require("./views");
const { URL } = require("node:url");

const { LOGTO_ORG_ID, ADMIN_TOOL_URL } = process.env;
const REQUIRED_ORG_ROLE = `${LOGTO_ORG_ID}:Admins`;
const TRUSTED_ORIGIN = new URL(ADMIN_TOOL_URL).origin;

// Minimal flash via session: req.flash(type, msg) to set, req.flash(type) to read-and-clear.
function flash(req, _res, next) {
  req.flash = (type, msg) => {
    if (msg === undefined) {
      const msgs = req.session.flash?.[type] ?? [];
      delete req.session.flash?.[type];
      return msgs;
    }
    if (!req.session.flash) req.session.flash = {};
    if (!req.session.flash[type]) req.session.flash[type] = [];
    req.session.flash[type].push(msg);
  };
  next();
}

function checkAdmin(req, _res, next) {
  const orgRoles = req.oidc.idTokenClaims?.organization_roles ?? [];
  req.session.isAdmin = orgRoles.some((r) => r === REQUIRED_ORG_ROLE);
  next();
}

function getViewUser(req) {
  if (!req.oidc?.user) return null;
  return {
    ...req.oidc.user,
    isAdmin: !!req.session?.isAdmin,
  };
}

function requiresWikiAdmin(req, res, next) {
  if (!req.oidc.isAuthenticated()) return res.redirect("/login");
  if (!req.session.isAdmin) {
    return res.status(403).send(views.accessDeniedPage(getViewUser(req)));
  }
  next();
}

function getFlash(req) {
  return { success: req.flash("success"), error: req.flash("error") };
}

function verifyCsrfOrigin(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  const origin = req.get("origin");
  const referer = req.get("referer");
  const source = origin || referer || "";

  if (!source.startsWith(TRUSTED_ORIGIN)) {
    return res.status(403).send("Invalid request origin");
  }

  return next();
}

module.exports = { flash, requiresWikiAdmin, getFlash, checkAdmin, getViewUser, verifyCsrfOrigin };
