import {
	CLIENT_ARTIFACT_METADATA_ELEMENT_ID,
	CLIENT_ARTIFACT_ROOT_ELEMENT_ID,
	PluginBridgeInit,
	PluginClientArtifactMetadata,
	type PluginBridgeReady,
} from "@ryot/contract/modules/plugins/client";
import { Result, Schema } from "effect";
import { createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";

export type ClientPluginDefinition = {
	readonly home: ComponentType;
};

const decodeArtifactMetadata = Schema.decodeUnknownResult(
	Schema.fromJsonString(PluginClientArtifactMetadata),
);

export const defineClientPlugin = (definition: ClientPluginDefinition) => Object.freeze(definition);

export const bootstrapClientPlugin = (definition: ClientPluginDefinition) => {
	const metadataElement = document.getElementById(CLIENT_ARTIFACT_METADATA_ELEMENT_ID);
	const metadata = decodeArtifactMetadata(metadataElement?.textContent ?? "");
	if (Result.isFailure(metadata)) {
		return;
	}

	const artifactMetadata = metadata.success;
	let initialized = false;

	window.addEventListener("message", (event) => {
		if (initialized || event.source !== window.parent || event.ports.length !== 1) {
			return;
		}

		const decoded = Schema.decodeUnknownResult(PluginBridgeInit)(event.data);
		if (Result.isFailure(decoded)) {
			return;
		}

		const init = decoded.success;
		if (init.artifactHash !== artifactMetadata.hash) {
			return;
		}

		const rootElement = document.getElementById(CLIENT_ARTIFACT_ROOT_ELEMENT_ID);
		if (!rootElement) {
			return;
		}

		const port = event.ports[0];
		if (!port) {
			return;
		}

		initialized = true;
		port.start();
		port.postMessage({
			sessionId: init.sessionId,
			format: artifactMetadata.format,
			artifactHash: artifactMetadata.hash,
			apiVersion: artifactMetadata.apiVersion,
			bridgeVersion: artifactMetadata.bridgeVersion,
			compilerVersion: artifactMetadata.compilerVersion,
		} satisfies PluginBridgeReady);
		createRoot(rootElement).render(createElement(definition.home));
	});
};
