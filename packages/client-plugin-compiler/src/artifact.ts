import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type PluginClientArtifactFile,
	type PluginClientArtifactMetadata,
} from "@ryot-app/client-plugin-contract";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";

export const CLIENT_ARTIFACT_DOCUMENT_NAME = "index.html";

export const clientArtifactFile = ({
	path,
	bytes,
	contentType,
}: {
	readonly path: string;
	readonly bytes: Uint8Array;
	readonly contentType: string;
}): PluginClientArtifactFile => ({
	name: path,
	contentType,
	contents: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice(),
});

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
		hash: sha256Hex(stableStringify({ name: pluginName, metadata: identity, files: fileIdentity })),
	};
};
