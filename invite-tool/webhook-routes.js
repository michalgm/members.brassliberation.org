const crypto = require("node:crypto");
const { Router, raw } = require("express");
const logto = require("./logto");
const outline = require("./outline");

const { OUTLINE_WEBHOOK_SECRET } = process.env;

const router = Router();

const resolveEmail = async (payload) => {
  const payloadEmail = payload?.email || payload.model?.email;
  if (payloadEmail) {
    return payloadEmail;
  }

  const outlineUserId = payload.id;
  if (!outlineUserId) {
    return null;
  }
  const outlineUser = await outline.getUser(outlineUserId);
  return outlineUser?.email ?? null;
};

const handleSignIn = async (payload, res) => {
  const outlineUserId = payload.id;
  const email = await resolveEmail(payload);
  if (!email || !outlineUserId) {
    return res.status(400).json({ error: "Missing user email or id in payload" });
  }

  const groups = outline.getGroups();
  const managedRoleNames = new Set(Object.keys(logto.getRoles()).map((name) => name.toLowerCase()));
  const managedGroups = groups.filter((group) => managedRoleNames.has(group.name.toLowerCase()));
  const currentGroups = await outline.listUserGroups(outlineUserId);
  const currentGroupIdSet = new Set(currentGroups.map((group) => group.id));
  const logtoUser = await logto.findUserByEmail(email);

  let roleNames = [];
  if (logtoUser) {
    const roles = await logto.getUserOrgRoles(logtoUser.id);
    roleNames = roles.map((r) => r.name.toLowerCase());
  }
  const roleNameSet = new Set(roleNames);

  await Promise.all(
    managedGroups.map((group) => {
      const matches = roleNameSet.has(group.name.toLowerCase());
      const isInOutlineGroup = currentGroupIdSet.has(group.id);
      if (matches && !isInOutlineGroup) {
        console.log(`Adding ${email} to Outline group ${group.name}`);
        return outline.addUserToGroup(group.id, outlineUserId);
      }

      if (!matches && isInOutlineGroup) {
        console.log(`Removing ${email} from Outline group ${group.name}`);
        return outline.removeUserFromGroup(group.id, outlineUserId);
      }

      return null;
    }),
  );

  res.status(200).json({ ok: true });
};

const handleCreate = handleSignIn;

router.post("/group_sync", raw({ type: "application/json" }), async (req, res) => {
  // Verify HMAC-SHA256 signature
  const header = req.headers["outline-signature"] ?? "";
  const timestamp = header.split(",")[0].split("=")[1];
  const signature = header.split(",")[1].split("=")[1];
  const body = req.body;
  const expected = crypto
    .createHmac("sha256", OUTLINE_WEBHOOK_SECRET)
    .update(`${timestamp}.${body.toString()}`)
    .digest("hex");
  const signatureValid = expected === signature;
  if (!signatureValid) {
    console.error(`Invalid signature on webhook call`);
    return res.status(401).json({ error: "Invalid signature" });
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString("utf8"));
  } catch {
    console.error(`Invalid JSON on webhook call`);
    return res.status(400).json({ error: "Invalid JSON" });
  }
  try {
    switch (payload.event) {
      case "users.signin":
        return await handleSignIn(payload.payload, res);
      case "users.create":
        return await handleCreate(payload.payload, res);
      default:
        console.log(`group_sync: ignoring unsupported event type "${payload.event}"`);
        return res.status(200).json({ ok: true, skipped: true });
    }
  } catch (err) {
    console.error(`webhook error: (${payload?.event})`, err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
