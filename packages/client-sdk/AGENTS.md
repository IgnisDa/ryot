# Client SDK

- Read the embedded artifact metadata element and validate it before registering the `message` listener; never listen first.
- Accept exactly one `MessagePort` from `window.parent` and ignore any other message source or port count.
- Let the `PluginBridgeInit` decode enforce the protocol markers, and compare only the artifact hash against the embedded metadata before starting the port.
- Report the embedded artifact metadata in `PluginBridgeReady`; echoing the kernel's own init values would make the kernel-side identity check tautological.
