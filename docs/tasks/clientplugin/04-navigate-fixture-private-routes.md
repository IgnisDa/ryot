# Navigate Fixture Private Routes

**Parent Plan:** [Web Client Plugin Tracer](./README.md)

**Status:** todo

## What to build

Extend the mounted fixture from Task 03 with one declared private route and complete kernel-owned history behavior. The fixture home and private page remain inside the same long-lived iframe. Plugin code deals only in relative logical locations and must not know its installed slug or call browser history for Ryot navigation.

Define the minimum route contribution and plugin-facing location API needed by the fixture. Keep TanStack Router as the kernel's real browser-history owner. The plugin runtime may own an in-memory router implementation, but third-party code must consume Ryot SDK route, params, search, link, push, and replace APIs rather than importing kernel router internals. The kernel prefixes the installed slug, validates that requested locations stay inside the installation namespace, updates the global URL, and sends the resulting logical location back to the iframe.

Implement direct entry, link navigation, SDK push/replace, browser Back/Forward, refresh, and kernel-originated location changes for `/fixture` and one route such as `/fixture/details/$itemId`. Preserve the iframe and bridge session while moving between those locations. A workspace change remains replace-style navigation, while private child navigation uses normal history semantics.

Task 03 left the kernel side of the bridge untested, and this task must close that gap because preserving one bridge session across navigation cannot be asserted without addressing the bridge directly. Extract the handshake and session lifecycle out of `PluginHost` into a transport-agnostic kernel bridge that takes a `postMessage`-capable target instead of reading `iframe.contentWindow` itself, then drive it in tests over a real `MessageChannel`. The extraction is required rather than cosmetic: jsdom's `window.postMessage` drops the transfer list, so a port posted at a real iframe never reaches the peer and the component-level handshake cannot be exercised in the existing jsdom suite. Keep the observable states and the V1 handshake unchanged; this is a seam, not a protocol change.

## Acceptance criteria

- [ ] The fixture declares one relative private route with a parameter and a search value without hardcoding `fixture` in plugin source.
- [ ] Directly opening the private global URL resolves the fixture installation and renders the expected logical plugin location.
- [ ] Plugin links and SDK push/replace calls request relative locations through the bridge; the iframe never mutates Ryot browser history directly.
- [ ] The kernel validates and prefixes plugin paths so `..`, absolute origins, reserved kernel routes, and another plugin namespace cannot be reached through plugin navigation.
- [ ] TanStack Router remains the only owner of real browser history and search state.
- [ ] Browser Back and Forward update the existing plugin document's in-memory location and rendered route.
- [ ] Navigating between fixture home and the private route does not recreate the iframe, React tree, or bridge session.
- [ ] The kernel handshake and bridge session lifecycle live in a transport-agnostic module that `PluginHost` drives, without changing the V1 messages or the kernel-owned states.
- [ ] Kernel-side bridge tests cover port transfer, ready validation against the initiating session and artifact hash, the handshake timeout, teardown on unmount, and the loading-to-ready transition.
- [ ] A full browser refresh on either route restores the correct surface through catalog and route resolution.
- [ ] Plugin-facing params and search values are decoded through the SDK contract rather than read from the parent window.
- [ ] Focus moves to an appropriate page landmark or heading after logical route changes without breaking browser keyboard navigation.
- [ ] Focused route-resolver, path-validation, bridge-location, history, direct-entry, refresh, and persistent-iframe tests pass with all earlier tracer tests.

## User stories addressed

- User story 5

## Implementor Notes

Do not expose TanStack Router objects as plugin ABI. Keep the SDK surface semantic so the internal in-memory router can change without changing plugin source.

The bridge extraction inherited from Task 03 is a prerequisite for the persistent-session criteria, not a parallel refactor. Do it before adding location messages so the new messages land on an already-testable seam.
