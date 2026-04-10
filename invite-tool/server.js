const express = require("express");
const { auth, requiresAuth } = require("express-openid-connect");

const {
  PORT = 3003,
  LOGTO_ENDPOINT,
  LOGTO_ADMIN_CLIENT_ID,
  LOGTO_ADMIN_CLIENT_SECRET,
  LOGTO_M2M_CLIENT_ID,
  LOGTO_M2M_CLIENT_SECRET,
  LOGTO_ORG_ID,
  OUTLINE_URL,
  WIKI_APP_ID,
  ADMIN_TOOL_URL,
  SESSION_SECRET,
} = process.env;

for (const [k, v] of Object.entries({
  LOGTO_ENDPOINT,
  LOGTO_ADMIN_CLIENT_ID,
  LOGTO_ADMIN_CLIENT_SECRET,
  LOGTO_M2M_CLIENT_ID,
  LOGTO_M2M_CLIENT_SECRET,
  LOGTO_ORG_ID,
  OUTLINE_URL,
  WIKI_APP_ID,
  ADMIN_TOOL_URL,
  SESSION_SECRET,
})) {
  if (!v) throw new Error(`Missing env var: ${k}`);
}

const EXPIRATION_SECONDS = 2 * 24 * 60 * 60;
const REQUIRED_ORG_ROLE = "Admin";

const app = express();
app.use(express.urlencoded({ extended: false }));

app.use(
  auth({
    authRequired: false,
    auth0Logout: false,
    baseURL: ADMIN_TOOL_URL,
    clientID: LOGTO_ADMIN_CLIENT_ID,
    clientSecret: LOGTO_ADMIN_CLIENT_SECRET,
    issuerBaseURL: `${LOGTO_ENDPOINT}/oidc`,
    secret: SESSION_SECRET,
    idpLogout: true,
    idTokenSigningAlg: "ES384",
    authorizationParams: {
      response_type: "code",
      scope: "openid profile email roles",
    },
  }),
);

// --- M2M token caching ---
let cachedToken = null;
let tokenExpiresAt = 0;

async function getM2MToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }
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

// --- Logto API helpers ---
async function logtoApi(path, method = "GET", body = null) {
  const token = await getM2MToken();
  const res = await fetch(`${LOGTO_ENDPOINT}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body && { "Content-Type": "application/json" }),
    },
    ...(body && { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Logto API ${method} ${path} failed: ${res.status} ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// --- Invitation flow ---
async function inviteUser(email) {
  // 1. Create org invitation
  const invitation = await logtoApi("/api/organization-invitations", "POST", {
    invitee: email,
    organizationId: LOGTO_ORG_ID,
    expiresAt: Date.now() + EXPIRATION_SECONDS * 1000,
  });

  // 2. Create one-time token (with JIT org membership)
  const tokenResponse = await logtoApi("/api/one-time-tokens", "POST", {
    email,
    expiresIn: EXPIRATION_SECONDS,
    context: { jitOrganizationIds: [LOGTO_ORG_ID] },
  });
  const oneTimeToken = tokenResponse.token;

  // 3. Send invitation email via Logto
  const magicLink = `${OUTLINE_URL}/auth/oidc?one_time_token=${encodeURIComponent(oneTimeToken)}&login_hint=${encodeURIComponent(email)}`;
  await logtoApi(`/api/organization-invitations/${invitation.id}/message`, "POST", {
    link: magicLink,
  });

  return { invitationId: invitation.id, magicLink };
}

function requiresWikiAdmin(req, res, next) {
  if (!req?.oidc?.isAuthenticated()) {
    return res.redirect("/login");
  }

  const claims = req.oidc.idTokenClaims;
  // console.log("User claims:", claims);
  const orgRoles = claims?.roles || [];
  // orgRoles is an array of strings like ["5bzlqkl2ic7n:wiki-admin"]
  // each entry is "orgId:roleName"
  const hasRole = orgRoles.some((r) => r === `${REQUIRED_ORG_ROLE}`);

  if (!hasRole) {
    return res.status(403).send(
      renderPage(
        "Access denied",
        `
      <h1>Access denied</h1>
      <p class="error">You don't have permission to invite users.</p>
      <p>Contact a wiki administrator if you need access.</p>
      <div class="user-info">
        Signed in as ${req.oidc.user?.email || "unknown"}
        &middot; <a href="/logout">Sign out</a>
      </div>
    `,
      ),
    );
  }

  next();
}

// --- Views ---
function renderPage(title, body) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 3em auto; padding: 0 1em; color: #222; }
    h1 { border-bottom: 1px solid #ccc; padding-bottom: 0.3em; }
    form { margin: 1.5em 0; }
    label { display: block; margin-bottom: 0.3em; font-weight: 600; }
    input[type=email] { width: 100%; padding: 0.6em; font-size: 1em; box-sizing: border-box; }
    button { padding: 0.6em 1.2em; font-size: 1em; background: #2a6496; color: white; border: none; cursor: pointer; margin-top: 0.5em; }
    button:hover { background: #1f4e75; }
    .error { color: #a00; background: #fee; padding: 0.8em; border-left: 3px solid #a00; margin: 1em 0; }
    .success { color: #060; background: #efe; padding: 0.8em; border-left: 3px solid #060; margin: 1em 0; }
    .user-info { color: #666; font-size: 0.9em; margin-top: 2em; }
    a { color: #2a6496; }
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
}

// --- Routes ---

app.get("/", requiresWikiAdmin, (req, res) => {
  const claims = req?.oidc?.idTokenClaims;
  console.log("User claims:", claims);

  if (!req.oidc.isAuthenticated()) {
    return res.send(
      renderPage(
        "Wiki admin",
        `
      <h1>Wiki admin</h1>
      <p>You need to sign in to invite users.</p>
      <p><a href="/login"><button>Sign in</button></a></p>
    `,
      ),
    );
  }

  const user = req.oidc.user;
  res.send(
    renderPage(
      "Invite a user",
      `
    <h1>Invite a user</h1>
    <form method="POST" action="/invite">
      <label for="email">Email address</label>
      <input type="email" id="email" name="email" required autofocus>
      <button type="submit">Send invitation</button>
    </form>
    <div class="user-info">
      Signed in as ${user.email || user.name || user.sub}
      &middot; <a href="/logout">Sign out</a>
    </div>
  `,
    ),
  );
});

app.post("/invite", requiresWikiAdmin, requiresAuth(), async (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return res.status(400).send(
      renderPage(
        "Error",
        `
      <h1>Invalid email</h1>
      <p class="error">Please provide a valid email address.</p>
      <p><a href="/">Go back</a></p>
    `,
      ),
    );
  }

  try {
    await inviteUser(email);
    res.send(
      renderPage(
        "Invitation sent",
        `
        <h1>Invitation sent</h1>
        <p class="success">An invitation email has been sent to <strong>${email}</strong>.</p>
        <p>They'll receive a link to set up their account and join the wiki. The link expires in ${EXPIRATION_SECONDS / 60 / 60 / 24} days.</p>
        <p><a href="/">Invite another user</a></p>
        `,
      ),
    );
    console.log("Invitation sent to :", email);
  } catch (err) {
    console.error("Invitation failed:", err);
    res.status(500).send(
      renderPage(
        "Error",
        `
      <h1>Invitation failed</h1>
      <p class="error">Something went wrong: ${err.message}</p>
      <p><a href="/">Go back</a></p>
    `,
      ),
    );
  }
});

app.listen(PORT, () => {
  console.log(`Wiki invite tool listening on port ${PORT}`);
});
