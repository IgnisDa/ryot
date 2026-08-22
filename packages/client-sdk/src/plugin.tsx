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

export type ClientPluginDefinition = {
	readonly home: ComponentType;
	readonly routes?: readonly PluginRouteDefinition[];
};

const decodeArtifactMetadata = Schema.decodeUnknownResult(
	Schema.fromJsonString(PluginClientArtifactMetadata),
);

export const defineClientPlugin = (definition: ClientPluginDefinition) => Object.freeze(definition);

export const bootstrapClientPlugin = (definition: ClientPluginDefinition) => {
	const listener = new AbortController();
	let root: Root | undefined;
	let runtime: ReturnType<typeof createPluginRuntime> | undefined;
	const mount = () => {
		if (!root && runtime) {
			const rootElement = document.getElementById(CLIENT_ARTIFACT_ROOT_ELEMENT_ID);
			if (!rootElement) {
				return;
			}
			root = createRoot(rootElement);
			root.render(
				<RyotProvider client={runtime.client}>
					<PluginRouter definition={definition} locations={runtime.locations} />
				</RyotProvider>,
			);
		}
	};
	const unmount = () => {
		root?.unmount();
		root = undefined;
	};
	const dispose = () => {
		listener.abort();
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
			const init = decoded.success;
			runtime = createPluginRuntime(
				port,
				init,
				artifactMetadata,
				document.documentElement.style,
				mount,
				unmount,
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
