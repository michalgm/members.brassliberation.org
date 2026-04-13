#!/usr/bin/env node
// Usage:
//   node test-webhook.js users.signin someone@example.com <outline-user-id>
//   node test-webhook.js users.create someone@example.com <outline-user-id>
//
// Reads OUTLINE_WEBHOOK_SECRET from invite-tool.env automatically.
// Defaults to http://localhost:3003 unless PORT env var is set.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => l.split("=").map((p) => p.trim()))
      .filter(([k]) => k)
      .map(([k, ...rest]) => [k, rest.join("=")]),
  );
}

const envFile = path.resolve(__dirname, "../invite-tool.env");
const env = loadEnv(envFile);
const secret = process.env.OUTLINE_WEBHOOK_SECRET ?? env.OUTLINE_WEBHOOK_SECRET;
const port = process.env.PORT ?? env.PORT ?? 3003;
const baseUrl = `http://localhost:${port}`;

if (!secret) {
  console.error("OUTLINE_WEBHOOK_SECRET not found in env or invite-tool.env");
  process.exit(1);
}

const [, , event = "users.signin", email = "test@example.com", outlineUserId = "test-outline-user-id"] = process.argv;

const payload = JSON.stringify({
  event,
  data: { email, id: outlineUserId },
});

const sig = `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;

(async () => {
  console.log(`→ POST ${baseUrl}/group_sync`);
  console.log(`  event: ${event}`);
  console.log(`  email: ${email}`);
  console.log(`  outlineUserId: ${outlineUserId}`);

  const res = await fetch(`${baseUrl}/group_sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-outline-signature": sig,
    },
    body: payload,
  });

  const body = await res.text();
  console.log(`\n← ${res.status} ${res.statusText}`);
  try {
    console.log(JSON.stringify(JSON.parse(body), null, 2));
  } catch {
    console.log(body);
  }
})();
