# Invoke an Authenticated Operation

**Parent Plan:** [Web Client Plugin Tracer](./README.md)

**Status:** todo

## What to build

Add one real authenticated fixture operation that can be invoked from the mounted client plugin. A user action in the fixture sends a typed request through `@ryot/client-plugin-sdk`, the kernel executes it through the existing authenticated app client for the bridge session's installation, and the typed result returns to the fixture. The plugin document never receives the Better Auth cookie, API key, or another reusable Ryot credential.

Keep authority in kernel-owned bridge session state. The plugin request supplies an operation slug and operation input, not a trusted plugin ID, installation ID, artifact hash, server URL, or user ID. The kernel binds those values from the exact `PluginHost` session established in Task 03 and invokes only an operation belonging to that installation. Use the existing backend plugin-operation contract and authorization behavior rather than adding a client-specific backend bypass.

Add the minimum request/response bridge machinery required for concurrent calls, correlation IDs, structured success values, typed expected failures, unexpected transport failures, and teardown rejection. The fixture UI must exercise a successful call and a stable failure branch without displaying internal causes. Do not introduce a broad generic data API, storage, subscriptions, or native capabilities in this slice.

## Acceptance criteria

- [ ] The fixture manifest declares one backend operation and its client home invokes it through a typed client SDK method.
- [ ] The request crosses the production iframe `MessagePort`, kernel authenticated app client, existing backend operation route, and backend plugin runtime before returning a result.
- [ ] The bridge session, not plugin-controlled request data, supplies server, user, plugin, installation, package, and artifact identity.
- [ ] A plugin cannot use the operation method to invoke another installation's operation or substitute another installation ID.
- [ ] The plugin document receives no Ryot cookie, API key, bearer token, or reusable operation credential.
- [ ] Multiple in-flight calls are correlated correctly and settle once.
- [ ] Expected backend failures are represented by a stable typed SDK error; transport and malformed-result failures remain distinguishable without leaking internal diagnostics into normal UI.
- [ ] Closing or replacing the bridge rejects pending calls and releases request bookkeeping.
- [ ] The fixture renders an accessible pending state, successful result, retry action, and stable expected-error state using the client UI SDK.
- [ ] Backend authorization/integration tests, bridge protocol tests, SDK tests, and browser interaction tests cover success, expected failure, identity spoofing, teardown, and credential isolation; all earlier tracer tests still pass.

## User stories addressed

- User story 6

## Implementor Notes

Prefer a fixture operation with deterministic input and output so the test proves identity and transport rather than unrelated domain behavior.
