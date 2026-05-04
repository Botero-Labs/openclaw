# Velanir OpenClaw Fork Notes

This fork exists to keep Velanir's machine-install runtime close to upstream
OpenClaw while supporting Velanir workspace bootstrap files.

Companion platform decision record:
`docs/plans/velanir-openclaw-runtime-plan.md` in the Velanir platform repo.

Companion platform maintenance runbook:
`docs/runbooks/openclaw-fork-maintenance.md` in the Velanir platform repo.

On Dan's development machine, this checkout
(`/Users/danbotero/Developer/forked-openclaw`) is the retained Velanir fork
checkout. `/Users/danbotero/Developer/openclaw` is an upstream study clone only.
Do not recreate long-lived local worktrees for this patch unless there is a
clear temporary reason.

## Current fork-owned behavior

- Keep the npm package metadata as `openclaw`.
- Publish machine-install artifacts to S3 as `velanir-openclaw-<version>.tgz`.
- Preserve the generic `bootstrap-extra-files.allowedBasenames` config seam.
- Keep the fork branch focused on `velanir/bootstrap-extra-files`.

## Merge guidance

When updating from upstream OpenClaw, preserve an equivalent opt-in mechanism
for custom bootstrap basenames. Do not hardcode Velanir filenames into
`VALID_BOOTSTRAP_NAMES` unless there is no other viable short-term option.

The platform config uses this seam so files such as `COMPANY.md`,
`ROLE_PROFILE.md`, `MANAGER.md`, `TEAM.md`, and `CONTACTS.md` can be included
in normal agent Project Context without rewriting the OpenClaw package identity.

If upstream accepts a generic replacement, prefer the upstream version and
remove this fork patch.

## Verification

After changing this fork-owned seam, run:

```bash
pnpm test src/agents/workspace.load-extra-bootstrap-files.test.ts src/hooks/bundled/bootstrap-extra-files/handler.test.ts
pnpm tsgo:core
```
