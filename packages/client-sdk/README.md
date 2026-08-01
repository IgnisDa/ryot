# Client SDK

`@ryot-app/client-sdk` is the environment-neutral application API shared by kernel and plugin call
sites. It is bundled into each plugin artifact, so it avoids animation and gesture dependencies.

## Bridge Bootstrap

The plugin bootstrap validates embedded artifact metadata before registering a `message` listener. It
accepts exactly one `MessagePort` from `window.parent`; all other sources and port counts are ignored.
`PluginBridgeInit` validates protocol markers and its artifact hash must match the embedded metadata.
`PluginBridgeReady` reports the embedded metadata, not values echoed from init. The bridge and client
compiler versions are currently exactly 1.

The port carries no bearer token, server URL, user identity, plugin identity, or installation
identity. Reserved `Mod+K` and `Mod+Shift+Space` shortcuts are forwarded as semantic kernel messages,
not raw keyboard events or public `RyotClient` capabilities. An active plugin `OverlayScope`
suppresses forwarding.

## Capabilities

`uploads` is one capability that hides intent creation, byte transfer, and completion. The direct
adapter provides it; the MessageChannel adapter returns `unsupported-capability` because bridge
payloads are JSON and cannot carry `Blob` values.

`assets.resolve` accepts 1 to 64 managed local or S3 locators and returns signed URLs with expiry.
Remote images do not use it. Disposing a bridge session aborts pending resolution, but an issued URL
remains valid until expiry. Failures expose only `asset-failed`.

## Entity Interest

`ryot.entities.watch({ foreground, visible }, onUpdate)` returns
`{ update(interest), dispose() }`. The callback receives
`{ entityId, reason: "populated" | "translated" }`. Disposal is idempotent, suppresses later
callbacks, and makes later updates fail with `disposed`. Invalid declarations fail synchronously with
`invalid-input`, a missing adapter fails with `unsupported-capability`, and transport failures use
`RyotClientError("transport")`.

Declarations may exceed 500 IDs. The runtime normalizes and deduplicates them, gives foreground
priority, sorts within each priority, and sends at most 500 selected IDs. The strict version 1 state
messages contain no request IDs, acknowledgements, credentials, tickets, user IDs, or server fields.
The host owns connectivity and reconnection.

`createRyotQuery` can derive interest from its input and last successful data. Active consumers of
the same registry/query atom share one watch. Updates and document-foreground hints coalesce for 250
ms; an in-flight request finishes before one queued refresh. Hidden retained screens withdraw demand,
and reactivation requests catch-up without discarding cached data.

`useEntityRefresh` supports controller-owned data and passes a deduplicated batch of updates to
`onRefresh`. `useEntitySettle` provides the same staging for query-owned screens. Both reveal settle
marks only on `commit()`, after refreshed values are rendered, and expire marks automatically.
Identity changes and unmount discard queued work. Transient transport and disposal failures do not
crash a screen; invalid input and unsupported capabilities remain explicit.

## Plugin Routing

`PluginRouter` retains a stack of screens and reconciles it only from the kernel history `index` and
`key`; paths never imply push, pop, or replace. Route targets contain `path` and optional `search`.
Entity targets contain only `entityId`; the kernel builds the canonical URL and returns an entity
location with `entitySchemaSlug`.

`home` is required. Entity renderers register by schema slug and receive `entityId` and
`entitySchemaSlug`; an unregistered slug renders the SDK unavailable state.

```tsx
import { bootstrapClientPlugin, type EntityRendererProps } from "@ryot-app/client-sdk/plugin";

const ShowEntity = ({ entityId }: EntityRendererProps) => <h2>{entityId}</h2>;

bootstrapClientPlugin({
	home: { component: Home },
	entities: { show: { component: ShowEntity } },
});
```

Retained screens keep their React keys and use `visibility: hidden`, preserving state, layout, and
scroll position. `leading` selects visible back, drawer, or no control; `edgeBack` independently
enables a kernel-granted interactive edge. A gesture commit requests kernel navigation and owns its
settling animation. Pop animation runs only for compact layouts and when reduced motion is not
requested; screen retention is unconditional.

The kernel supplies `compact`, safe-area insets, and history identity. Plugins must not substitute
iframe media queries or browser history inference for those values.
