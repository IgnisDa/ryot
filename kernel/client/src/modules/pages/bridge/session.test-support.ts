import {
	CLIENT_BRIDGE_BOOTSTRAP,
	CLIENT_BRIDGE_NONCE_ELEMENT_ID,
	CLIENT_COMPOSITION_METADATA_ELEMENT_ID,
	PluginBridgeBootstrapProof,
	PluginBridgeInit,
} from "@ryot-app/plugin-client-contract";
import { fireEvent } from "@testing-library/dom";
import { Effect, Result, Schema } from "effect";

export function offerFramePort(
	frame: HTMLIFrameElement,
	proof = frameBootstrapProof(frame),
	origin = "null",
) {
	const channel = new MessageChannel();
	const message = new MessageEvent("message", {
		origin,
		ports: [channel.port2],
		source: frame.contentWindow,
		data: CLIENT_BRIDGE_BOOTSTRAP,
	});
	fireEvent(window, message);
	channel.port1.postMessage(proof);
	return channel.port1;
}

export function frameBootstrapProof(frame: HTMLIFrameElement) {
	const document = new DOMParser().parseFromString(frame.srcdoc, "text/html");
	const nonce: unknown = JSON.parse(
		document.getElementById(CLIENT_BRIDGE_NONCE_ELEMENT_ID)?.textContent ?? "null",
	);
	const composition: unknown = JSON.parse(
		document.getElementById(CLIENT_COMPOSITION_METADATA_ELEMENT_ID)?.textContent ?? "null",
	);
	const proof = Schema.decodeUnknownResult(PluginBridgeBootstrapProof)({ nonce, composition });
	if (Result.isFailure(proof)) {
		throw new Error("The iframe document has no bridge proof");
	}
	return proof.success;
}

const decodeInit = Schema.decodeUnknownEffect(PluginBridgeInit);

export const receiveBridgeInit = (port: MessagePort) =>
	Effect.callback<PluginBridgeInit, Schema.SchemaError>((resume) => {
		const onInit = ({ data }: MessageEvent<unknown>) => resume(decodeInit(data));
		port.addEventListener("message", onInit, { once: true });
		port.start();
		return Effect.sync(() => port.close());
	});

export const connectFrame = Effect.fnUntraced(function* (frame: HTMLIFrameElement) {
	const port = offerFramePort(frame);
	const init = yield* receiveBridgeInit(port);
	const messages: unknown[] = [];
	port.addEventListener("message", (event) => messages.push(event.data));
	const {
		dir: _dir,
		mode: _mode,
		page: _page,
		locale: _locale,
		safeAreaTop: _top,
		catalogs: _catalogs,
		safeAreaBottom: _bottom,
		documentKey: _documentKey,
		pendingNamespaces: _pendingNamespaces,
		...ready
	} = init;
	return { init, port, ready, messages };
});
