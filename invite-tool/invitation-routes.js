const { Router } = require("express");
const logto = require("./logto");
const views = require("./views");

const { OUTLINE_URL } = process.env;

const router = Router();

function normalizeInviteParams({ id, one_time_token, token, login_hint, email }) {
  return {
    invitationId: id,
    oneTimeToken: one_time_token || token,
    loginHint: login_hint || email,
  };
}

router.get("/invitation/join", async (req, res) => {
  const { invitationId, oneTimeToken, loginHint } = normalizeInviteParams(req.query);

  if (!invitationId || !oneTimeToken || !loginHint) {
    return res.status(400).send(
      views.invitationJoinPage({
        invitationId,
        token: oneTimeToken,
        email: loginHint,
        error: "Missing invitation parameters. Please use the full invite link from your email.",
      }),
    );
  }

  try {
    const invitation = await logto.getOrganizationInvitation(invitationId);
    if (invitation.status !== "Pending") {
      return res.status(409).send(
        views.invitationDonePage({
          title: "Invitation not available",
          message: `This invitation is ${invitation.status.toLowerCase()}.`,
          success: false,
        }),
      );
    }

    return res.send(
      views.invitationJoinPage({
        invitationId,
        token: oneTimeToken,
        email: loginHint,
      }),
    );
  } catch (err) {
    return res.status(500).send(
      views.invitationDonePage({
        title: "Invitation error",
        message: `Failed to load invitation: ${err.message}`,
        success: false,
      }),
    );
  }
});

router.post("/invitation/reject", async (req, res) => {
  const invitationId = req.body.id;
  if (!invitationId) {
    return res
      .status(400)
      .send(views.invitationDonePage({ title: "Invalid request", message: "Missing invitation ID.", success: false }));
  }

  try {
    await logto.revokeOrganizationInvitation(invitationId);
    return res.send(
      views.invitationDonePage({
        title: "Invitation rejected",
        message: "The invitation has been rejected.",
        success: true,
      }),
    );
  } catch (err) {
    return res.status(500).send(
      views.invitationDonePage({
        title: "Invitation error",
        message: `Failed to reject invitation: ${err.message}`,
        success: false,
      }),
    );
  }
});

router.post("/invitation/accept/start", async (req, res, next) => {
  const { invitationId, oneTimeToken, loginHint } = normalizeInviteParams(req.body);

  if (!invitationId || !oneTimeToken || !loginHint) {
    return res.status(400).send(
      views.invitationDonePage({
        title: "Invalid request",
        message: "Missing invitation parameters.",
        success: false,
      }),
    );
  }

  try {
    const invitation = await logto.getOrganizationInvitation(invitationId);
    if (invitation.status !== "Pending") {
      return res.status(409).send(
        views.invitationDonePage({
          title: "Invitation not available",
          message: `This invitation is ${invitation.status.toLowerCase()}.`,
          success: false,
        }),
      );
    }

    req.session.pendingInvitation = { invitationId };

    return await res.oidc.login({
      returnTo: "/invitation/accept/callback",
      authorizationParams: {
        one_time_token: oneTimeToken,
        login_hint: loginHint,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/invitation/accept/callback", async (req, res) => {
  if (!req.oidc.isAuthenticated()) {
    return res.status(401).send(
      views.invitationDonePage({
        title: "Not signed in",
        message: "Authentication did not complete. Please use the invitation link again.",
        success: false,
      }),
    );
  }

  const pending = req.session.pendingInvitation;
  if (!pending?.invitationId) {
    return res.status(400).send(
      views.invitationDonePage({
        title: "Session expired",
        message: "Could not find your invitation. Please use the link in your email and try again.",
        success: false,
      }),
    );
  }

  try {
    await logto.acceptOrganizationInvitation(pending.invitationId, req.oidc.user.sub);
    req.session.pendingInvitation = null;
    return res.redirect(`${OUTLINE_URL}/auth/oidc`);
  } catch (err) {
    return res.status(500).send(
      views.invitationDonePage({
        title: "Could not accept invitation",
        message: err.message,
        success: false,
      }),
    );
  }
});

module.exports = router;
