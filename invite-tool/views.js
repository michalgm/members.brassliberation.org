const { escape: esc } = require("html-escaper");
// --- Private fragments ---

function nav() {
  // if (!user?.isAdmin) return "";
  if (process.env.NODE_ENV === "production") return "";

  return `<nav>
    <a href='/profile'>Profile</a>
    <a href="/invite">Invite Users</a>
    <a href="/members">Manage Members</a>
  </nav>`;
}

function footer(user) {
  return `<div class="footer">
    Signed in as ${esc(user.email || user.name || user.sub)}
    &middot; <a href="/logout">Sign out</a>
  </div>`;
}

function flashHtml(f) {
  if (!f) return "";
  const parts = [];
  if (f.success?.length) parts.push(`<p class="alert success">${esc(f.success[0])}</p>`);
  if (f.error?.length) parts.push(`<p class="alert error">${esc(f.error[0])}</p>`);
  return parts.join("\n");
}

// --- Page shell ---
// user and f are optional; when provided, nav/flash/footer are injected automatically.

function renderPage(title, content, user = null, f = null) {
  const top = user ? `${nav(user)}\n  ${flashHtml(f)}` : "";
  const bottom = user ? footer(user) : "";
  const heading = `<h1>${esc(title)}</h1>`;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${esc(title)} — Wiki Admin</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; max-width: 860px; margin: 3em auto; padding: 0 1.5em; color: #222; }
    h1 { border-bottom: 1px solid #ddd; padding-bottom: 0.3em; margin-bottom: 0.5em; }
    h2 { margin-top: 1.5em; font-size: 1.1em; color: #444; }
    nav { margin-bottom: 1.5em; }
    nav a { margin-right: 1.2em; color: #2a6496; text-decoration: none; font-weight: 600; }
    nav a:hover { text-decoration: underline; }
    hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
    form { margin: 1em 0; }
    label { display: block; margin: 0.8em 0 0.3em; font-weight: 600; font-size: 0.95em; }
    input[type=text], input[type=email], input[type=password], input[type=search] {
      width: 100%; padding: 0.55em 0.7em; font-size: 1em; border: 1px solid #ccc; border-radius: 3px;
    }
    input:disabled { background: #f5f5f5; color: #888; }
    textarea { width: 100%; padding: 0.6em; font-size: 0.9em; font-family: monospace; border: 1px solid #ccc; border-radius: 3px; }
    textarea.emails { height: 8em; }
    select { padding: 0.35em 0.5em; font-size: 0.9em; border: 1px solid #ccc; border-radius: 3px; }
    button { padding: 0.5em 1em; font-size: 0.9em; background: #2a6496; color: white; border: none; cursor: pointer; border-radius: 3px; margin-top: 0.6em; }
    button:hover { background: #1f4e75; }
    button:disabled { background: #7aa8c7; cursor: default; }
    button.danger { background: #b00; }
    button.danger:hover { background: #800; }
    button.secondary { background: #555; }
    button.secondary:hover { background: #333; }
    button.small { padding: 0.3em 0.7em; font-size: 0.85em; margin-top: 0; }
    .alert { padding: 0.8em 1em; border-left: 4px solid; margin: 1em 0; }
    .alert.error { color: #900; background: #fff0f0; border-color: #900; }
    .alert.success { color: #060; background: #f0fff0; border-color: #060; }
    .footer { color: #666; font-size: 0.9em; margin-top: 2.5em; padding-top: 0.8em; border-top: 1px solid #eee; }
    .hint { color: #666; font-size: 0.85em; margin: 0.25em 0 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 1em; }
    th { text-align: left; padding: 0.6em 0.5em; background: #f5f5f5; border-bottom: 2px solid #ddd; font-size: 0.9em; }
    td { padding: 0.5em; border-bottom: 1px solid #eee; vertical-align: middle; }
    tr:hover td { background: #fafafa; }
    .row-actions { display: flex; gap: 0.4em; align-items: center; }
    .inline-form { display: inline; margin: 0; }
    .result-list { list-style: none; padding: 0; margin: 1em 0; }
    .result-list li { padding: 0.4em 0.2em; border-bottom: 1px solid #f0f0f0; }
    .ok::before { content: "✓ "; color: #060; }
    .fail::before { content: "✗ "; color: #900; }
  </style>
</head>
<body>
  ${heading}
  ${top}
  ${content}
  ${bottom}
</body>
</html>`;
}

function orgRoleOptions(orgRoles, selectedName) {
  return Object.entries(orgRoles)
    .map(
      ([name, role]) =>
        `<option value="${esc(role.id)}"${name === selectedName ? " selected" : ""}>${esc(name)}</option>`,
    )
    .join("");
}

// --- Pages ---

function invitePage(user, orgRoles, f) {
  const roleOptions = orgRoleOptions(orgRoles, "Members");

  return renderPage(
    "Invite Users",
    `
    <form method="POST" action="/invite" onsubmit="const b=this.querySelector('button[type=submit]');b.disabled=true;b.textContent='Sending…'">
      <label for="emails">Email addresses</label>
      <textarea class="emails" id="emails" name="emails" required autofocus
        placeholder="alice@example.com&#10;bob@example.com&#10;carol@example.com"></textarea>
      <p class="hint">One per line, or comma-separated. Duplicates are ignored.</p>
      <label for="roleId">Invite as</label>
      <select id="roleId" name="roleId">${roleOptions}</select>
      <button type="submit">Send Invitations</button>
    </form>
  `,
    user,
    f,
  );
}

function inviteResultPage(user, results) {
  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;

  let summary;
  if (fail === 0) summary = `<p class="alert success">All ${ok} invitation(s) sent.</p>`;
  else if (ok === 0) summary = `<p class="alert error">All ${fail} invitation(s) failed.</p>`;
  else summary = `<p class="alert success">${ok} sent.</p><p class="alert error">${fail} failed.</p>`;

  const items = results
    .map((r) => `<li class="${r.ok ? "ok" : "fail"}">${esc(r.email)}${r.ok ? "" : ` — ${esc(r.error)}`}</li>`)
    .join("\n");

  return renderPage(
    "Invitation Results",
    `
    ${summary}
    <ul class="result-list">${items}</ul>
    <p><a href="/invite"><button class="secondary">Invite more</button></a></p>
  `,
    user,
  );
}

function membersPage(user, members, availableRoles, f) {
  function roleSelect(orgRoles) {
    const currentRoleName = orgRoles.some((r) => r.name === "Admins") ? "Admins" : (orgRoles[0]?.name ?? "");
    // const opts = [{ id: "", name: "— no role —" }, ...availableRoles].map((role) => {
    //   const sel = role.name === (currentRoleName ?? "") ? " selected" : "";
    //   return `<option value="${esc(role.name)}"${sel}>${esc(role.name)}</option>`;
    // });
    const opts = orgRoleOptions(availableRoles, currentRoleName);
    return `<select name="roleId">${opts}</select>`;
  }

  const rows = members
    .map(
      (m) => `
    <tr>
    <td>
      <a href="/members/${esc(m.id)}/account"> ${esc(m.name || "")} </a>
      </td>
      <td>${esc(m.primaryEmail || "")}</td>
      <td>
        <div class="row-actions">
          <form method="POST" action="/members/${esc(m.id)}/role" class="inline-form">
            ${roleSelect(m.organizationRoles)}
            <button type="submit" class="small">Set</button>
          </form>
          <form method="POST" action="/members/${esc(m.id)}/remove" class="inline-form"
            onsubmit="return confirm('Delete this user account? This cannot be undone.')">
            <button type="submit" class="small danger">Delete</button>
          </form>
        </div>
      </td>
    </tr>`,
    )
    .join("\n");

  const emptyRow = `<tr><td colspan="3" style="text-align:center;color:#888;padding:1.5em">No members found</td></tr>`;

  return renderPage(
    `Members`,
    `
    <input type="search" id="member-filter" placeholder="Filter by name or email…" autofocus>
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Actions</th></tr></thead>
      <tbody id="members-body">${rows || emptyRow}</tbody>
    </table>
    <script>
      const filter = document.getElementById('member-filter');
      const rows = document.querySelectorAll('#members-body tr');
      filter.addEventListener('input', () => {
        const q = filter.value.toLowerCase();
        rows.forEach(row => { row.hidden = q && !row.textContent.toLowerCase().includes(q); });
      });
    </script>
  `,
    user,
    f,
  );
}

function accountPage(user, member, f) {
  const customData = member.customData ?? {};
  const customFields =
    Object.entries(customData)
      .map(
        ([key, value]) => `
    <label for="cd_${esc(key)}">${esc(key)}</label>
    <input type="text" id="cd_${esc(key)}" name="customData[${esc(key)}]" value="${esc(String(value))}">
  `,
      )
      .join("") || `<p class="hint">No custom data fields on this account.</p>`;

  const displayName = member.name || member.primaryEmail || member.id;
  return renderPage(
    `Account: ${displayName}`,
    `
    <form method="POST" action="/members/${esc(member.id)}/account">
      <h2>Profile</h2>
      <label for="name">Display name</label>
      <input type="text" id="name" name="name" value="${esc(member.name || "")}">

      <label>Email</label>
      <input type="email" value="${esc(member.primaryEmail || "")}" disabled>
      <p class="hint">Email cannot be changed here.</p>

      <h2>Custom data</h2>
      ${customFields}

      <button type="submit">Save Changes</button>
    </form>

    <hr>

    <form method="POST" action="/members/${esc(member.id)}/password">
      <h2>Set Password</h2>
      <label for="password">New password</label>
      <input type="password" id="password" name="password" required minlength="8" autocomplete="new-password">
      <label for="confirmPassword">Confirm password</label>
      <input type="password" id="confirmPassword" name="confirmPassword" required minlength="8" autocomplete="new-password">
      <button type="submit">Set Password</button>
    </form>
    ${user.sub !== member.id ? `<p style="margin-top:2em"><a href="/members">&larr; Back to members</a></p>` : ""}
    
  `,
    user,
    f,
  );
}

function accessDeniedPage(user) {
  const who = user
    ? `Signed in as ${esc(user.email || "unknown")} &middot; <a href="/logout">Sign out</a>`
    : `<a href="/login">Sign in</a>`;
  return renderPage(
    "Access Denied",
    `
    <p class="alert error">You don't have permission to use this tool.</p>
    <p>Contact a wiki administrator if you need access.</p>
    <div class="footer">${who}</div>
  `,
  );
}

function invitationDonePage({ title, message, success = true, continueUrl = null }) {
  return renderPage(
    title,
    `
    <p class="alert ${success ? "success" : "error"}">${esc(message)}</p>
    ${continueUrl ? `<p><a href="${esc(continueUrl)}"><button>Continue</button></a></p>` : ""}
  `,
  );
}

function errorPage(err) {
  const isDev = process.env.NODE_ENV !== "production";
  const detail = isDev && err?.message ? `<p class="hint">${esc(err.message)}</p>` : "";
  return renderPage(
    "Unexpected Error",
    `
    <p class="alert error">Something went wrong. Please try again or contact an administrator if the problem persists.</p>
    ${detail}
    <p><a href="/">Go to home</a></p>
  `,
  );
}

module.exports = {
  renderPage,
  invitePage,
  inviteResultPage,
  membersPage,
  accountPage,
  accessDeniedPage,
  invitationDonePage,
  errorPage,
};
