const { OUTLINE_URL, OUTLINE_API_KEY } = process.env;
// Groups are loaded once at startup and cached here.
let cachedGroups = null;

async function outlineApi(endpoint, body = {}) {
  const res = await fetch(`${OUTLINE_URL}/api/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OUTLINE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Outline API ${endpoint} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function loadGroups() {
  const data = await outlineApi("groups.list", { limit: 100 });
  cachedGroups = data.data?.groups ?? [];
  return cachedGroups;
}

function getGroups() {
  if (!cachedGroups) throw new Error("Outline groups not loaded yet — call loadGroups() at startup");
  return cachedGroups;
}

async function getUser(userId) {
  const data = await outlineApi("users.info", { id: userId });
  return data.data ?? null;
}

async function findUserByEmail(email) {
  const data = await outlineApi("users.list", { emails: [email], limit: 1 });
  const users = data.data ?? [];
  return users.find((user) => user.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function suspendUser(userId) {
  await outlineApi("users.suspend", { id: userId });
}

async function suspendUserByEmail(email) {
  const user = await findUserByEmail(email);
  if (!user) {
    return false;
  }
  await suspendUser(user.id);
  return true;
}

async function listUserGroups(userId) {
  const data = await outlineApi("groups.list", { userId, limit: 100 });
  return data.data?.groups ?? [];
}

// Swallows errors if user is already a member.
async function addUserToGroup(groupId, userId) {
  try {
    await outlineApi("groups.add_user", { id: groupId, userId });
  } catch (err) {
    if (!err.message.includes("already")) throw err;
  }
}

// Swallows errors if user is not a member.
async function removeUserFromGroup(groupId, userId) {
  try {
    await outlineApi("groups.remove_user", { id: groupId, userId });
  } catch (err) {
    if (!err.message.includes("not") && !err.message.includes("404")) throw err;
  }
}

module.exports = {
  loadGroups,
  getGroups,
  getUser,
  findUserByEmail,
  suspendUser,
  suspendUserByEmail,
  listUserGroups,
  addUserToGroup,
  removeUserFromGroup,
};
