# Client Plugin Contract

`@ryot-app/client-plugin-contract` owns the environment-neutral boundary shared by client plugins,
the client kernel, the client plugin compiler, archive tooling, and artifact persistence. This
includes the iframe bridge protocol, client artifact format, client source file policy, and the
wire-safe capability payloads used by the direct and bridge-backed client adapters.

Reserved kernel shortcuts are bridge behavior, not a public `RyotClient` capability. The iframe
bootstrap recognizes `Mod+K` for the command center and `Mod+Shift+Space` for the desktop workspace
switcher, then sends semantic `{ type: "kernel-shortcut", shortcut: "command-center" | "workspace-switcher" }`
messages. It never sends a raw `KeyboardEvent` or key payload. The kernel owns the actions and desktop
gating; an active plugin `OverlayScope` suppresses root forwarding, and plugins must not bind either
reserved combination at their root.

The bridge protocol is exactly version 1. Entity subscriptions use strict state messages:
plugins send `{ type: "entity-interest", foreground: string[], visible: string[] }`, with at most
500 IDs total, and the kernel sends `{ type: "entity-updated", entityId, reason }`. IDs, update
reasons, and the cap come from `@ryot-app/contract`. The shared `EntityInterest` declaration schema
is uncapped; the owning runtime aggregates and selects the bounded wire state. These messages have
no request IDs, acknowledgements, tickets, credentials, user identity, or server fields.

The package builds these specialized contracts from generic HTTP-contract schemas such as entity
identifiers, JSON values, RyotQL documents, and managed asset locators. `@ryot-app/contract` must not
depend on this package.
