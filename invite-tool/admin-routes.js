const { Router } = require("express");
const { isEmail } = require("validator");
const logto = require("./logto");
const outline = require("./outline");
const views = require("./views");
const { requiresWikiAdmin, getFlash, getViewUser } = require("./middleware");

const adminRouter = Router();

function parseEmails(raw) {
  return [
    ...new Set(
      raw
        .split(/[\n,]+/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

adminRouter.use(requiresWikiAdmin);
adminRouter.get("/", (_req, res) => res.redirect("/invite"));

adminRouter.get("/invite", async (req, res) => {
  const orgRoles = logto.getRoles();
  res.send(views.invitePage(getViewUser(req), orgRoles, getFlash(req)));
});

adminRouter.post("/invite", async (req, res) => {
  const emails = parseEmails(req.body.emails || "");
  const roleId = req.body.roleId || "";
  const organizationRoleIds = roleId ? [roleId] : [];
  if (roleId === logto.getRoles().Admins.id) {
    organizationRoleIds.push(logto.getRoles().Members.id);
  }

  if (emails.length === 0) {
    req.flash("error", "No email addresses provided.");
    return res.redirect("/invite");
  }

  const invalid = emails.filter((e) => !isEmail(e));
  if (invalid.length > 0) {
    req.flash("error", `Invalid address(es): ${invalid.join(", ")} — please fix and resubmit.`);
    return res.redirect("/invite");
  }
  const results = [];
  for (const email of emails) {
    try {
      const invitations = await logto.getInvitations(email);
      await Promise.all(invitations.map((inv) => logto.revokeOrganizationInvitation(inv.id, true)));
      await logto.inviteUser(email, organizationRoleIds);
      results.push({ email, ok: true, error: "" });
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (err) {
      console.error(`Failed to invite ${email}:`, err);
      results.push({ email, ok: false, error: err.message });
    }
  }
  res.send(views.inviteResultPage(getViewUser(req), results));
});

adminRouter.get("/members", async (req, res) => {
  try {
    const [members, availableRoles] = await Promise.all([logto.listUsers(), logto.getRoles()]);
    res.send(views.membersPage(getViewUser(req), members, availableRoles, getFlash(req)));
  } catch (err) {
    console.error("Failed to load members:", err);
    res
      .status(500)
      .send(
        views.renderPage(
          "Error",
          `<h1>Error loading members</h1><p class="alert error">${err.message}</p><p><a href="/members">Retry</a></p>`,
        ),
      );
  }
});

adminRouter.post("/members/:userId/role", async (req, res) => {
  try {
    await logto.setUserOrgRole(req.params.userId, req.body.roleId || "");
    req.flash("success", "Role updated.");
  } catch (err) {
    console.error("Failed to update role:", err);
    req.flash("error", `Failed to update role: ${err.message}`);
  }
  res.redirect("/members");
});

adminRouter.post("/members/:userId/remove", async (req, res) => {
  try {
    const member = await logto.getUser(req.params.userId);
    const email = member.primaryEmail;

    let outlineSuspended = false;
    if (email) {
      outlineSuspended = await outline.suspendUserByEmail(email);
    }

    await logto.deleteUser(req.params.userId);
    req.flash(
      "success",
      outlineSuspended ? "User deleted from Logto and suspended in Outline." : "User deleted from Logto.",
    );
  } catch (err) {
    console.error("Failed to delete user:", err);
    req.flash("error", `Failed to delete user: ${err.message}`);
  }
  res.redirect("/members");
});

adminRouter.get("/members/:userId/account", async (req, res) => {
  try {
    const member = await logto.getUser(req.params.userId);
    res.send(views.accountPage(getViewUser(req), member, getFlash(req)));
  } catch (err) {
    console.error("Failed to load account:", err);
    req.flash("error", `Failed to load account: ${err.message}`);
    res.redirect("/members");
  }
});

adminRouter.post("/members/:userId/account", async (req, res) => {
  const { userId } = req.params;
  const { name, customData } = req.body;
  try {
    await logto.updateUser(userId, { name, customData: customData ?? {} });
    req.flash("success", "Account updated.");
  } catch (err) {
    console.error("Failed to update account:", err);
    req.flash("error", `Failed to update account: ${err.message}`);
  }
  res.redirect(`/members/${userId}/account`);
});

adminRouter.post("/members/:userId/password", async (req, res) => {
  const { userId } = req.params;
  const { password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    req.flash("error", "Passwords do not match.");
    return res.redirect(`/members/${userId}/account`);
  }

  try {
    await logto.setUserPassword(userId, password);
    req.flash("success", "Password updated.");
  } catch (err) {
    console.error("Failed to set password:", err);
    req.flash("error", `Failed to set password: ${err.message}`);
  }
  res.redirect(`/members/${userId}/account`);
});

const profileRouter = Router();

profileRouter.get("/profile", async (req, res) => {
  try {
    const member = await logto.getUser(req.oidc.user.sub);
    res.send(views.accountPage(getViewUser(req), member, getFlash(req)));
  } catch (err) {
    console.error("Failed to load account:", err);
    req.flash("error", `Failed to load account: ${err.message}`);
    res.redirect("/members");
  }
});

profileRouter.post("/members/:userId/account", async (req, res) => {
  const { userId } = req.params;
  const { name, customData } = req.body;
  if (req.oidc.user.sub !== userId && !req.session.isAdmin) {
    req.flash("error", "You can only update your own account.");
    return res.redirect("/profile");
  }

  try {
    await logto.updateUser(userId, { name, customData: customData ?? {} });
    req.flash("success", "Account updated.");
  } catch (err) {
    console.error("Failed to update account:", err);
    req.flash("error", `Failed to update account: ${err.message}`);
  }
  if (req.session.isAdmin) {
    return res.redirect(`/members/${userId}/account`);
  }
  res.redirect(`/profile`);
});


profileRouter.post("/members/:userId/password", async (req, res) => {
  const { userId } = req.params;
  const { password, confirmPassword } = req.body;

  if (req.oidc.user.sub !== userId && !req.session.isAdmin) {
    req.flash("error", "You can only update your own account.");
    return res.redirect("/profile");
  }
  if (password !== confirmPassword) {
    req.flash("error", "Passwords do not match.");
    return res.redirect(`/members/${userId}/account`);
  }

  try {
    await logto.setUserPassword(userId, password);
    req.flash("success", "Password updated.");
  } catch (err) {
    console.error("Failed to set password:", err);
    req.flash("error", `Failed to set password: ${err.message}`);
  }
  if (req.session.isAdmin) {
    return res.redirect(`/members/${userId}/account`);
  }
  res.redirect(`/profile`);
});

module.exports = { adminRouter, profileRouter };
