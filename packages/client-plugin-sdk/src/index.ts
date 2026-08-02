import {
	CLIENT_ARTIFACT_METADATA_ELEMENT_ID,
	PluginBridgeInit,
	PluginClientArtifactMetadata,
	type PluginBridgeReady,
} from "@ryot/contract/modules/plugins/client";
import { Result, Schema } from "effect";
import { createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";

export interface ClientPluginDefinition {
	readonly home: ComponentType;
}

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
		if (
			init.artifactHash !== artifactMetadata.hash ||
			init.format !== artifactMetadata.format ||
			init.apiVersion !== artifactMetadata.apiVersion ||
			init.bridgeVersion !== artifactMetadata.bridgeVersion ||
			init.compilerVersion !== artifactMetadata.compilerVersion
		) {
			return;
		}

		const rootElement = document.getElementById("app");
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
			format: init.format,
			sessionId: init.sessionId,
			apiVersion: init.apiVersion,
			artifactHash: init.artifactHash,
			bridgeVersion: init.bridgeVersion,
			compilerVersion: init.compilerVersion,
		} satisfies PluginBridgeReady);
		createRoot(rootElement).render(createElement(definition.home));
	});
};
