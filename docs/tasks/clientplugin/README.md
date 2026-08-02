# Web Client Plugin Tracer

## Tasks

**Overall Progress:** 2 of 9 tasks completed

**Current Task:** [Task 03](./03-install-and-render-fixture-plugin.md) (todo)

### Task List

| #   | Task                                                                                          | Status |
| --- | --------------------------------------------------------------------------------------------- | ------ |
| 01  | [Establish Kernel UI and Connect to a Server](./01-establish-kernel-ui-and-connect-server.md) | done   |
| 02  | [Authenticate Into the Kernel Shell](./02-authenticate-into-kernel-shell.md)                  | done   |
| 03  | [Install and Render a Fixture Plugin](./03-install-and-render-fixture-plugin.md)              | todo   |
| 04  | [Navigate Fixture Private Routes](./04-navigate-fixture-private-routes.md)                    | todo   |
| 05  | [Invoke an Authenticated Operation](./05-invoke-authenticated-operation.md)                   | todo   |
| 06  | [Synchronize Kernel Theme](./06-synchronize-kernel-theme.md)                                  | todo   |
| 07  | [Recover From Plugin Crashes](./07-recover-from-plugin-crashes.md)                            | todo   |
| 08  | [Reload Updated Plugin Artifacts](./08-reload-updated-plugin-artifacts.md)                    | todo   |
| 09  | [Clean Up the Web Tracer](./09-clean-up-web-tracer.md)                                        | todo   |

## Source Plan

This plan implements only the fresh kernel and web fixture tracer from [Ryot Client Plugin Architecture](../../ryot-client-plugin-design.md), especially sections 3-22, 31-34, and 39.1-39.2. The architecture document remains authoritative when this plan does not narrow a decision.

## Goal

Prove one client plugin through the production web path:

```text
plugin client source in archive
  -> server-side client compilation
  -> immutable content-addressed artifact
  -> RyotQL installation/artifact catalog
  -> authenticated kernel route resolution
  -> isolated iframe and MessageChannel bridge
  -> plugin home and one private route
  -> one authenticated backend operation
  -> live theme synchronization
  -> crash recovery
  -> update and forced artifact reload
```

## External Prerequisites

The repository owner completes these actions before Task 01 starts:

1. move the existing Expo / React Native client from `kernel/client` to a reference location under `crates/`
2. create a plain TanStack Router React DOM starter at `kernel/client`

These actions are not tasks in this plan. Implementors may read the legacy client under `crates/`, but every task in this plan must treat `crates/**` as read-only. This plan does not delete, clean up, rename, or otherwise modify anything under `crates/`.

## User Stories

1. As a user, I can open the new Ryot web kernel, connect it to Ryot Cloud or a self-hosted server, and see a consistent accessible Ryot interface.
2. As a user, I can authenticate with the methods enabled by my server, restore my session, and enter an authenticated kernel shell.
3. As a plugin author, I can put supported React DOM client source and assets in my plugin archive and have Ryot compile an immutable client artifact without installing my dependencies.
4. As an authenticated user, I can open an installed fixture plugin home through the same isolated artifact path intended for third-party plugins.
5. As a user, I can navigate between the fixture home and a private route using one kernel-owned browser history without recreating the plugin iframe.
6. As a plugin author, I can invoke one authenticated operation through the client SDK without receiving the user's Ryot credentials.
7. As a user, I can change the kernel theme and see the mounted plugin update without recompilation or iframe recreation.
8. As a user, I see a stable kernel-owned failure state when a plugin crashes and can reload that plugin without reloading the kernel.
9. As a user, I receive an updated plugin artifact through a forced iframe reload without mixing old client code with a newer backend package revision.

## Fixed Decisions

- The new client is a greenfield React DOM kernel. Do not add Expo adapters, compatibility layers, migrated client state, or legacy bridge behavior.
- The first tracer targets the browser only. Capacitor validation and Media entity rendering belong to later tracers.
- Onboarding and authentication are real production paths. Tests may seed users and sessions through test support, but application code must not hardcode a user or bypass authentication.
- Kernel UI starts from the existing semantic design language, adapted to DOM CSS. Port tokens and behavior, not React Native or NativeWind implementation details.
- The plugin source archive contains `manifest.json`, `backend/**`, and optional `client/**`. The compiled client artifact is separate from the source archive.
- `@ryot/sandbox-compiler` remains backend-specific. Browser compilation belongs to a new `@ryot/client-plugin-compiler` package.
- The server compiles client source during plugin installation and update. Package source hash and client artifact hash are separate identities.
- The kernel reads installation and artifact metadata through an application-owned named RyotQL recipe with a colocated schema and decoder.
- Plugin applications run in isolated iframes, receive no Ryot credentials, and communicate through a kernel-created `MessageChannel`.
- V1 uses exact client API, bridge protocol, and artifact-format markers. Do not add version ranges, negotiation, fallback adapters, or compatibility code.
- Installed plugins are trusted with data exposed through their SDK and may use public browser networking. This tracer does not add network permissions or origin allowlists.
- A package update changes the artifact hash and force-reloads the mounted iframe. An old artifact must not continue against the new package revision.
- A disabled installation is absent from bootstrap and the workspace switcher, but direct routes remain valid. Backend operation availability remains backend-owned.

## Scope Boundaries

This plan does not implement:

- Capacitor, iOS, or Android projects
- Media or Fitness client applications
- entity renderer delegation
- saved-view UI porting
- plugin installation or permission UI
- the complete client plugin SDK or client UI SDK
- durable plugin client storage
- files, notifications, audio, haptics, screen, or Live Activity capabilities
- artifact retention or garbage collection beyond what the active fixture path requires
- broad legacy-client feature parity
- deletion or cleanup of `crates/**`

Only SDK and UI APIs exercised by the web fixture may be introduced.

## Verification Strategy

Each task owns focused tests for its behavior and must keep all previously completed slices passing. Prefer contract, compiler, backend integration, and browser-level assertions at their owning boundaries. The completed tracer must prove the same installed fixture from source archive through browser rendering; a test-only alternate runtime path is not acceptable.
