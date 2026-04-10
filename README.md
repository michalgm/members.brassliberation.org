# blowiki

A self-hosted wiki for Brass Liberation Orchestra, running on a single Linode.

## Stack

**[Outline](https://www.getoutline.com/)** — the wiki itself. A modern, Notion-style knowledge base with rich text editing, nested docs, and search.

**[Logto](https://logto.io/)** — handles authentication. Members sign in via Logto, which issues OIDC tokens that Outline trusts. Logto also manages organization membership, so access to the wiki is tied to Logto org membership.

**Invite tool** — a small internal app (`invite-tool/`) for adding new members. Because Outline's access is gated by Logto org membership, there's no self-serve signup. Wiki admins use this tool to send a magic-link invitation that creates a Logto account and grants org access in one step.

**[https-portal](https://github.com/SteveLTN/https-portal)** — nginx reverse proxy that handles SSL termination and routes the public domains to each service.

### Domains

| Domain | Service |
|--------|---------|
| `members.brassliberation.org` | Outline wiki |
| `auth.members.brassliberation.org` | Logto (member-facing) |
| `auth-admin.members.brassliberation.org` | Logto admin console |
| `invite.members.brassliberation.org` | Invite tool |

## Setup

The `ansible/` directory contains playbooks to provision a fresh Ubuntu server (tested on Linode).

```sh
cd ansible

# install required collections
ansible-galaxy collection install -r collections/requirements.yml

# run everything
ansible-playbook site.yml
```

The playbooks run in order:

1. **`init.yml`** — system updates, essential packages, admin user, SSH key, unattended upgrades
2. **`security.yml`** — SSH hardening, fail2ban, sysctl security settings, auditd
3. **`docker.yml`** — installs Docker, copies compose files, starts services

### Config files

Copy and fill these in before running Ansible:

| File | Purpose |
|------|---------|
| `outline.env` | Outline configuration (database URL, secret key, OIDC settings) — see `outline.env.example` |
| `invite-tool.env` | Invite tool config (Logto credentials, org ID, session secret) — see `invite-tool.env.example` |
