import {
	CLIENT_ARTIFACT_METADATA_ELEMENT_ID,
	CLIENT_ARTIFACT_ROOT_ELEMENT_ID,
	PluginBridgeInit,
	PluginClientArtifactMetadata,
} from "@ryot/contract/modules/plugins/client";
import { Result, Schema } from "effect";
import type { ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";

import { RyotProvider } from "./react";
import { PluginRouter, type PluginRouteDefinition } from "./routing";
import { createPluginRuntime } from "./runtime";

type ClientPluginDefinition = {
	readonly home: ComponentType;
	readonly notFound?: ComponentType;
	readonly routes?: readonly PluginRouteDefinition[];
};

const decodeArtifactMetadata = Schema.decodeUnknownResult(
	Schema.fromJsonString(PluginClientArtifactMetadata),
);

export const bootstrapClientPlugin = (definition: ClientPluginDefinition) => {
	const listener = new AbortController();
	let root: Root | undefined;
	let runtime: ReturnType<typeof createPluginRuntime> | undefined;
	let sessionListener: AbortController | undefined;
	const handleFatalEvent = (event: Event) => {
		event.preventDefault();
		runtime?.fatal();
	};
	const mount = () => {
		if (!root && runtime) {
			const rootElement = document.getElementById(CLIENT_ARTIFACT_ROOT_ELEMENT_ID);
			if (!rootElement) {
				return;
			}
			try {
				root = createRoot(rootElement, {
					onUncaughtError: () => runtime?.fatal(),
				});
				root.render(
					<RyotProvider client={runtime.client}>
						<PluginRouter definition={definition} locations={runtime.locations} />
					</RyotProvider>,
				);
			} catch {
				runtime.fatal();
			}
		}
	};
	const unmount = () => {
		root?.unmount();
		root = undefined;
	};
	const dispose = () => {
		listener.abort();
		sessionListener?.abort();
		sessionListener = undefined;
		const activeRuntime = runtime;
		runtime = undefined;
		activeRuntime?.dispose();
		unmount();
	};
	const metadataElement = document.getElementById(CLIENT_ARTIFACT_METADATA_ELEMENT_ID);
	const metadata = decodeArtifactMetadata(metadataElement?.textContent ?? "");
	if (Result.isFailure(metadata)) {
		return { dispose };
	}

	const artifactMetadata = metadata.success;
	window.addEventListener(
		"message",
		(event) => {
			if (runtime || event.source !== window.parent || event.ports.length !== 1) {
				return;
			}
			const decoded = Schema.decodeUnknownResult(PluginBridgeInit)(event.data);
			if (Result.isFailure(decoded) || decoded.success.artifactHash !== artifactMetadata.hash) {
				return;
			}
			const port = event.ports[0];
			if (!document.getElementById(CLIENT_ARTIFACT_ROOT_ELEMENT_ID) || !port) {
				return;
			}

			listener.abort();
			sessionListener = new AbortController();
			window.addEventListener("error", handleFatalEvent, { signal: sessionListener.signal });
			window.addEventListener("unhandledrejection", handleFatalEvent, {
				signal: sessionListener.signal,
			});
			const init = decoded.success;
			runtime = createPluginRuntime(
				port,
				init,
				artifactMetadata,
				document.documentElement.style,
				mount,
				() => {
					sessionListener?.abort();
					sessionListener = undefined;
					unmount();
				},
			);
		},
		{ signal: listener.signal },
	);
	return { dispose };
};

export {
	PluginLink,
	usePluginParams,
	usePluginSearch,
	usePluginLocation,
	type PluginRouteDefinition,
} from "./routing";
