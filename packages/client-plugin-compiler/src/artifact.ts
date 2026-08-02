import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_ARTIFACT_METADATA_ELEMENT_ID,
	CLIENT_ARTIFACT_ROOT_ELEMENT_ID,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type PluginClientArtifactFile,
	type PluginClientArtifactMetadata,
} from "@ryot/contract/modules/plugins/client";
import { sha256Hex } from "@ryot/ts-utils/crypto";
import { stableStringify } from "@ryot/ts-utils/json";

export const CLIENT_ARTIFACT_SCRIPT_NAME = "plugin.js";
export const CLIENT_ARTIFACT_STYLE_NAME = "plugin.css";
export const CLIENT_ARTIFACT_DOCUMENT_NAME = "index.html";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
	svg: "image/svg+xml",
	css: "text/css; charset=utf-8",
	html: "text/html; charset=utf-8",
	js: "text/javascript; charset=utf-8",
};

export const clientArtifactContentType = (name: string) =>
	CONTENT_TYPES[name.slice(name.lastIndexOf(".") + 1)] ?? "application/octet-stream";

export const clientAssetName = (path: string, contents: string) =>
	`asset-${sha256Hex(contents)}.${path.slice(path.lastIndexOf(".") + 1)}`;

export const clientArtifactFile = (name: string, contents: string): PluginClientArtifactFile => ({
	name,
	contents,
	contentType: clientArtifactContentType(name),
});

export const clientArtifactMetadata = (
	files: readonly PluginClientArtifactFile[],
): PluginClientArtifactMetadata => {
	const identity = {
		format: CLIENT_ARTIFACT_FORMAT,
		apiVersion: CLIENT_API_VERSION,
		compilerVersion: CLIENT_COMPILER_VERSION,
		bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
	};
	return { ...identity, hash: sha256Hex(stableStringify({ files, metadata: identity })) };
};

export const clientArtifactDocument = (metadata: PluginClientArtifactMetadata) => `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Ryot client plugin</title>
		<link rel="stylesheet" href="./${CLIENT_ARTIFACT_STYLE_NAME}" />
		<script type="application/json" id="${CLIENT_ARTIFACT_METADATA_ELEMENT_ID}">${stableStringify(metadata)}</script>
	</head>
	<body>
		<div id="${CLIENT_ARTIFACT_ROOT_ELEMENT_ID}"></div>
		<script type="module" src="./${CLIENT_ARTIFACT_SCRIPT_NAME}"></script>
	</body>
</html>
`;
