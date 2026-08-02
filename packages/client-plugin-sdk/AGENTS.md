# Client Plugin SDK

- Read the embedded artifact metadata element and validate it before registering the `message` listener; never listen first.
- Accept exactly one `MessagePort` from `window.parent` and ignore any other message source or port count.
- Let the `PluginBridgeInit` decode enforce the V1 markers, and compare only the artifact hash against the embedded metadata before starting the port.
