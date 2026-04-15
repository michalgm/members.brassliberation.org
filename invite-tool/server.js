const express = require("express");
const session = require("express-session");
const { auth } = require("express-openid-connect");
const { flash, checkAdmin, verifyCsrfOrigin } = require("./middleware");
const { adminRouter, profileRouter } = require("./admin-routes");
const invitationRoutes = require("./invitation-routes");
const webhookRoutes = require("./webhook-routes");
const outline = require("./outline");
const logto = require("./logto");

const {
  PORT = 3003,
  LOGTO_ENDPOINT,
  LOGTO_ADMIN_CLIENT_ID,
  LOGTO_ADMIN_CLIENT_SECRET,
  LOGTO_M2M_CLIENT_ID,
  LOGTO_M2M_CLIENT_SECRET,
  LOGTO_ORG_ID,
  OUTLINE_URL,
  OUTLINE_API_KEY,
  OUTLINE_WEBHOOK_SECRET,
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
  OUTLINE_API_KEY,
  OUTLINE_WEBHOOK_SECRET,
  ADMIN_TOOL_URL,
  SESSION_SECRET,
})) {
  if (!v) throw new Error(`Missing env var: ${k}`);
}

const app = express();
app.use(webhookRoutes);
app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 8,
    },
  }),
);
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
      scope: "openid profile email custom_data urn:logto:scope:organization_roles urn:logto:scope:organizations",
    },
  }),
);


app.use(checkAdmin);
app.use(flash);
app.use(verifyCsrfOrigin);
app.use(invitationRoutes);
app.use(profileRouter);
app.use(adminRouter);

// Generic error handler — must be last and have exactly 4 params
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).send(views.errorPage(err));
});

const init = async () => {
  await outline.loadGroups();
  await logto.loadRoles();
  app.listen(PORT, () => console.log(`Wiki admin tool listening on port ${PORT}`));
};

init().catch((err) => {
  console.error("Initialization failed:", err);
  process.exit(1);
});
