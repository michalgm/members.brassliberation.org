const { LOGTO_ENDPOINT, LOGTO_M2M_CLIENT_ID, LOGTO_M2M_CLIENT_SECRET, LOGTO_ORG_ID, ADMIN_TOOL_URL } = process.env;

const EXPIRATION_SECONDS = 2 * 24 * 60 * 60;
const EXPIRATION_DAYS = EXPIRATION_SECONDS / 86400;
const PAGE_SIZE = 100;

// --- M2M token cache ---
let cachedToken = null;
let tokenExpiresAt = 0;

let cached_roles = null;

async function getM2MToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) return cachedToken;
  const res = await fetch(`${LOGTO_ENDPOINT}/oidc/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: LOGTO_M2M_CLIENT_ID,
      client_secret: LOGTO_M2M_CLIENT_SECRET,
      resource: "https://default.logto.app/api",
      scope: "all",
    }),
  });
  if (!res.ok) throw new Error(`M2M token fetch failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

async function logtoApi(path, method = "GET", body = null) {
  const token = await getM2MToken();
  const res = await fetch(`${LOGTO_ENDPOINT}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== null && { "Content-Type": "application/json" }),
    },
    ...(body !== null && { body: JSON.stringify(body) }),
  });
  if (method !== "GET") {
    console.log(`Logto API ${method} ${path} → ${res.status}`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Logto API ${method} ${path} → ${res.status}: ${text}`);
  }
  const json = await res.json().catch(() => null);
  return json;
}

async function loadRoles() {
  const data = (await logtoApi(`/api/organization-roles?page=1&page_size=${PAGE_SIZE}`)) ?? [];
  cached_roles = data.reduce((acc, role) => {
    acc[role.name] = role;
    return acc;
  }, {});

  return cached_roles;
}

function getRoles() {
  if (!cached_roles) throw new Error("Logto roles not loaded yet — call loadRoles() at startup");
  return cached_roles;
}

// --- Org roles ---

async function getUserOrgRoles(userId) {
  return (await logtoApi(`/api/organizations/${LOGTO_ORG_ID}/users/${userId}/roles`)) ?? [];
}

async function setUserOrgRole(userId, roleId) {
  if (roleId) {
    const roleName = Object.values(getRoles()).find((r) => r.id === roleId)?.name;
    const organizationRoleNames = [roleName];
    if (roleName === "Admins") {
      organizationRoleNames.push("Members");
    }
    await logtoApi(`/api/organizations/${LOGTO_ORG_ID}/users/${userId}/roles`, "PUT", {
      organizationRoleNames,
    });
  }
}

// --- Invite ---
async function inviteUser(email, organizationRoleIds = []) {
  const invitation = await logtoApi("/api/organization-invitations", "POST", {
    invitee: email,
    organizationId: LOGTO_ORG_ID,
    expiresAt: Date.now() + EXPIRATION_SECONDS * 1000,
    ...(organizationRoleIds.length > 0 && { organizationRoleIds }),
  });
  const { token } = await logtoApi("/api/one-time-tokens", "POST", {
    email,
    expiresIn: EXPIRATION_SECONDS,
    context: { jitOrganizationIds: [LOGTO_ORG_ID] },
  });
  const magicLink = `${ADMIN_TOOL_URL}/invitation/join?id=${encodeURIComponent(invitation.id)}&one_time_token=${encodeURIComponent(token)}&login_hint=${encodeURIComponent(email)}`;
  await logtoApi(`/api/organization-invitations/${invitation.id}/message`, "POST", { link: magicLink });
  return { invitationId: invitation.id };
}

async function getOrganizationInvitation(invitationId) {
  return await logtoApi(`/api/organization-invitations/${invitationId}`);
}

async function updateOrganizationInvitationStatus(invitationId, { status, acceptedUserId }) {
  const body = { status };
  if (acceptedUserId) body.acceptedUserId = acceptedUserId;
  return await logtoApi(`/api/organization-invitations/${invitationId}/status`, "PUT", body);
}

async function acceptOrganizationInvitation(invitationId, acceptedUserId) {
  return await updateOrganizationInvitationStatus(invitationId, {
    status: "Accepted",
    acceptedUserId,
  });
}

async function revokeOrganizationInvitation(invitationId) {
  return await updateOrganizationInvitationStatus(invitationId, { status: "Revoked" });
}

// --- Member management ---
async function listUsers() {
  return (await logtoApi(`/api/organizations/${LOGTO_ORG_ID}/users?page=1&page_size=${PAGE_SIZE}`)) ?? [];
}

async function deleteUser(userId) {
  await logtoApi(`/api/users/${userId}`, "DELETE");
}

// --- Account management ---
async function getUser(userId) {
  return await logtoApi(`/api/users/${userId}`);
}

async function updateUser(userId, { name, customData }) {
  const body = {};
  if (name !== undefined) body.name = name;
  if (customData !== undefined) body.customData = customData;
  return await logtoApi(`/api/users/${userId}`, "PATCH", body);
}

async function setUserPassword(userId, password) {
  await logtoApi(`/api/users/${userId}/password`, "PATCH", { password });
}

async function findUserByEmail(email) {
  const results = (await logtoApi(`/api/users?search=${encodeURIComponent(email)}&page=1&page_size=10`)) ?? [];
  return results.find((u) => u.primaryEmail?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function getInvitations(invitee) {
  return await logtoApi(
    `/api/organization-invitations?invitee=${encodeURIComponent(invitee)}&organizationId=${LOGTO_ORG_ID}&page=1&page_size=10`,
  );
}

async function getPendingInvitation(invitee) {
  const invitations = (await getInvitations(invitee)) ?? [];
  return invitations.find((invitation) => invitation.status === "Pending") ?? null;
}

async function acceptPendingInvitation(invitee) {
  const [invitation, user] = await Promise.all([getPendingInvitation(invitee), findUserByEmail(invitee)]);
  if (!invitation || !user) {
    return null;
  }

  return await acceptOrganizationInvitation(invitation.id, user.id);
}

module.exports = {
  EXPIRATION_DAYS,
  inviteUser,
  getUserOrgRoles,
  setUserOrgRole,
  listUsers,
  deleteUser,
  getUser,
  updateUser,
  setUserPassword,
  findUserByEmail,
  loadRoles,
  getRoles,
  getInvitations,
  getPendingInvitation,
  getOrganizationInvitation,
  updateOrganizationInvitationStatus,
  acceptOrganizationInvitation,
  acceptPendingInvitation,
  revokeOrganizationInvitation,
};
