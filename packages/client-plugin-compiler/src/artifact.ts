import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_ARTIFACT_METADATA_ELEMENT_ID,
	CLIENT_ARTIFACT_ROOT_ELEMENT_ID,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	pluginClientAssetMimeType,
	type PluginClientArtifactFile,
	type PluginClientArtifactMetadata,
} from "@ryot-app/client-plugin-contract";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";

export const CLIENT_ARTIFACT_SCRIPT_NAME = "plugin.js";
export const CLIENT_ARTIFACT_STYLE_NAME = "plugin.css";
export const CLIENT_ARTIFACT_DOCUMENT_NAME = "index.html";

const GENERATED_CONTENT_TYPES: Readonly<Record<string, string>> = {
	css: "text/css; charset=utf-8",
	html: "text/html; charset=utf-8",
	js: "text/javascript; charset=utf-8",
};

const encoder = new TextEncoder();

export const clientAssetName = (path: string, contents: Uint8Array) =>
	`asset-${sha256Hex(contents)}.${path.slice(path.lastIndexOf(".") + 1)}`;

export const clientGeneratedArtifactFile = (
	name: string,
	contents: string,
): PluginClientArtifactFile => {
	const contentType = GENERATED_CONTENT_TYPES[name.slice(name.lastIndexOf(".") + 1)];
	if (contentType === undefined) {
		throw new Error(`Unknown generated client artifact type for "${name}"`);
	}
	return { name, contentType, contents: encoder.encode(contents) };
};

export const clientAssetArtifactFile = (
	path: string,
	name: string,
	contents: Uint8Array,
): PluginClientArtifactFile => {
	const contentType = pluginClientAssetMimeType(path);
	if (contentType === undefined) {
		throw new Error(`Unknown client asset type for "${path}"`);
	}
	return { name, contents, contentType };
};

export const clientArtifactMetadata = (
	pluginName: string,
	files: readonly PluginClientArtifactFile[],
): PluginClientArtifactMetadata => {
	const identity = {
		format: CLIENT_ARTIFACT_FORMAT,
		apiVersion: CLIENT_API_VERSION,
		compilerVersion: CLIENT_COMPILER_VERSION,
		bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
	};
	const fileIdentity = files
		.map(({ name, contents, contentType }) => ({ name, contentType, sha256: sha256Hex(contents) }))
		.sort((left, right) => {
			if (left.name < right.name) {
				return -1;
			}
			return left.name > right.name ? 1 : 0;
		});
	return {
		...identity,
		hash: sha256Hex(stableStringify({ name: pluginName, files: fileIdentity, metadata: identity })),
	};
};

const escapeHtmlText = (value: string) =>
	value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export const clientArtifactDocument = (
	name: string,
	metadata: PluginClientArtifactMetadata,
) => `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${escapeHtmlText(name)}</title>
		<link rel="stylesheet" href="./${CLIENT_ARTIFACT_STYLE_NAME}" />
		<script type="application/json" id="${CLIENT_ARTIFACT_METADATA_ELEMENT_ID}">${stableStringify(metadata)}</script>
	</head>
	<body>
		<div id="${CLIENT_ARTIFACT_ROOT_ELEMENT_ID}"></div>
		<script type="module" src="./${CLIENT_ARTIFACT_SCRIPT_NAME}"></script>
	</body>
</html>
`;
