import { CLIENT_API_VERSION } from "@ryot-app/contract/modules/plugins/manifest";
import { CanonicalBase64 } from "@ryot-app/contract/schema/base64";
import { strictStruct } from "@ryot-app/contract/schema/utils";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Schema } from "effect";

export const CLIENT_ARTIFACT_FORMAT = 1 as const;
export const CLIENT_COMPILER_VERSION = 1 as const;
export const CLIENT_BRIDGE_PROTOCOL_VERSION = 1 as const;

const pluginClientArtifactFile = <Encoded, DecodingServices, EncodingServices>(
	contents: Schema.Codec<Uint8Array, Encoded, DecodingServices, EncodingServices>,
) => strictStruct({ contents, name: Schema.String, contentType: Schema.String });

export const PluginClientArtifactFile = pluginClientArtifactFile(Schema.Uint8Array);

export type PluginClientArtifactFile = Schema.Schema.Type<typeof PluginClientArtifactFile>;

export const clientVersionFields = {
	format: Schema.Literal(CLIENT_ARTIFACT_FORMAT),
	apiVersion: Schema.Literal(CLIENT_API_VERSION),
	compilerVersion: Schema.Literal(CLIENT_COMPILER_VERSION),
	bridgeVersion: Schema.Literal(CLIENT_BRIDGE_PROTOCOL_VERSION),
};

export const PluginClientArtifactMetadata = strictStruct({
	hash: Schema.String,
	...clientVersionFields,
});

export type PluginClientArtifactMetadata = Schema.Schema.Type<typeof PluginClientArtifactMetadata>;

/** Metadata embedded in a composition document; `hash` is the composition hash. */
export const ClientCompositionMetadata = strictStruct({
	hash: Schema.String,
	...clientVersionFields,
});

export type ClientCompositionMetadata = Schema.Schema.Type<typeof ClientCompositionMetadata>;

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

const pluginClientArtifact = <Encoded, DecodingServices, EncodingServices>(
	contents: Schema.Codec<Uint8Array, Encoded, DecodingServices, EncodingServices>,
) =>
	strictStruct({
		...PluginClientArtifactMetadata.fields,
		files: Schema.Array(pluginClientArtifactFile(contents)).pipe(
			Schema.check(
				Schema.makeFilter((files) =>
					new Set(files.map(({ name }) => name)).size === files.length
						? true
						: "Expected unique client artifact file names",
				),
			),
		),
	});

export const PluginClientArtifact = pluginClientArtifact(Schema.Uint8Array);

export type PluginClientArtifact = Schema.Schema.Type<typeof PluginClientArtifact>;

const CanonicalUint8ArrayFromBase64 = CanonicalBase64.pipe(
	Schema.decodeTo(Schema.Uint8ArrayFromBase64),
);

export const PluginClientArtifactFromBase64 = pluginClientArtifact(CanonicalUint8ArrayFromBase64);
