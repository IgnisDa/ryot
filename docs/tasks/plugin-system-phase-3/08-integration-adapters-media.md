# Step 4b — Integration Adapters: Sinks + Yanks into `plugins/media`

**Parent Plan:** [Plugin System — Phase 3: Capability Migrations](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Before starting, read `docs/plans/plugin-system/00-overview.md` in full and then
`docs/plans/plugin-system/03-phase-3-capability-migrations.md` in full — §4 is the authoritative
spec. Do not begin until Step 4a (task 07) is done and its gates pass.

Move every native integration adapter into `plugins/media` as scripts declared through the
`integrationProviders` manifest section task 07 built.

- **Sinks** (webhook receivers, normalization to progress events): plex, jellyfin, emby, kodi,
  browser-extension, generic_json. These come from `modules/integrations/sinks/`.
- **Yanks** (credentialed fetchers): komga, plex, audiobookshelf, youtube-music. These come from
  `modules/integrations/yank/` plus the yank dispatch in `modules/integrations/worker.ts`.
- **Push** targets (radarr, sonarr, jellyfin_push) are already `kind: "automation"` scripts bound
  through `bindings.eventAutomations` — they need **only** their lot-discriminated registry entries
  with `settingsSchema`, no script migration.

Network access is bounded through `httpCall` with credentials from the scoped `getIntegration`.
Plex sink payloads are multipart/form-data and are parsed in-script without a dependency.

Preserve `createProgressResult` semantics (`modules/integrations/sinks/shared.ts`): `occurredAt` is
always set, and the progress-policy automation depends on it.

Delete the native sink and yank adapter code from `modules/integrations`, along with the
switch dispatch in `sinks/sink-adapters.ts` and `worker.ts` and the hardcoded
`IntegrationProviderSpecifics` union and `integrationProviders`/`providerLotByProvider` tables in
`libs/contract/src/modules/integrations/`. The framework stays: credential storage,
enable/disable, auto-disable, webhook endpoint, run bookkeeping.

Adapter unit tests move into `plugins/media` alongside their adapters with assertions preserved.
Re-point the `integrations/` e2e suites (2 files, 16 tests) with assertions preserved; add new
coverage where the migration exposes a gap.

## Acceptance criteria

- [ ] All six sink adapters and all four yank adapters run as `plugins/media` scripts declared
      through `integrationProviders`; push targets have registry entries only
- [ ] `modules/integrations` contains **zero provider-specific code**; the framework
      (credentials, lifecycle, auto-disable, webhook endpoint, run bookkeeping) is unchanged in
      behavior
- [ ] The hardcoded provider union and lot tables are deleted from `libs/contract`
- [ ] Credential exposure is scoped to the executing integration
- [ ] `createProgressResult` semantics are preserved (`occurredAt` always set) and the
      progress-policy automation still fires
- [ ] Adapter outputs identify catalog providers by logical `providerSlug`/`providerId`, never by
      executable script identity
- [ ] Adapter unit tests live in `plugins/media` with assertions preserved
- [ ] `integrations/` e2e suites re-pointed with assertions preserved
- [ ] The branch stays shippable: backend `check` + unit tests, the full e2e suite, and the
      `app-client` check all pass (cross-phase invariant 1)

## User stories addressed

- User story 26
- User story 30
- User story 31
- User story 32
- User story 38
- User story 39
- User story 42
