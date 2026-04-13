const crypto = require("node:crypto");
const { Router, raw } = require("express");
const logto = require("./logto");
const outline = require("./outline");

const { OUTLINE_WEBHOOK_SECRET } = process.env;

const router = Router();

const handleSignIn = async (payload, res) => {
  const email = payload.data?.email;
  const outlineUserId = payload.data?.id;
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
  const signature = req.headers["x-outline-signature"] ?? "";
  const expected = `sha256=${crypto.createHmac("sha256", OUTLINE_WEBHOOK_SECRET).update(req.body).digest("hex")}`;
  let signatureValid;
  try {
    signatureValid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }
  try {
    switch (payload.event) {
      case "users.signin":
        return await handleSignIn(payload, res);
      case "users.create":
        return await handleCreate(payload, res);
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
