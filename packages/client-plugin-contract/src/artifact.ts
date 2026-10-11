import {
	CLIENT_API_VERSION,
	type PluginClientEntry,
} from "@ryot-app/contract/modules/plugins/manifest";
import { PluginPackageReference } from "@ryot-app/contract/modules/plugins/references";
import { CanonicalBase64 } from "@ryot-app/contract/schema/base64";
import { PluginPackageId } from "@ryot-app/contract/schema/brands";
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

export const pluginExportSpecifier = (reference: PluginPackageReference, exportName: string) =>
	`@ryot-app/plugins/${reference.scope}/${reference.packageId}/${exportName}`;

export const PluginClientImport = strictStruct({
	reference: PluginPackageReference,
	exportName: Schema.String.pipe(
		Schema.check(
			Schema.makeFilter((name) =>
				/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(name)
					? true
					: "Expected a canonical public client export name",
			),
		),
	),
});
export type PluginClientImport = typeof PluginClientImport.Type;

const clientImports = Schema.Array(PluginClientImport).pipe(
	Schema.check(
		Schema.makeFilter((imports) =>
			new Set(
				imports.map(({ reference, exportName }) => pluginExportSpecifier(reference, exportName)),
			).size === imports.length
				? true
				: "Expected unique client import targets",
		),
	),
);

export const clientDeclarationHash = (client: PluginClientEntry) =>
	sha256Hex(stableStringify(client));

export const PluginClientArtifactMetadata = strictStruct({
	hash: Schema.String,
	imports: clientImports,
	packageId: PluginPackageId,
	clientDeclarationHash: Schema.String,
	...clientVersionFields,
});

export type PluginClientArtifactMetadata = Schema.Schema.Type<typeof PluginClientArtifactMetadata>;

/** Metadata embedded in a composition document; `hash` is the composition hash. */
export const ClientCompositionMetadata = strictStruct({
	hash: Schema.String,
	...clientVersionFields,
});

export type ClientCompositionMetadata = Schema.Schema.Type<typeof ClientCompositionMetadata>;

export const ClientRuntimeArtifactMetadata = strictStruct({
	...ClientCompositionMetadata.fields,
	imports: clientImports,
});
export type ClientRuntimeArtifactMetadata = typeof ClientRuntimeArtifactMetadata.Type;

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
	packageId: PluginPackageId,
	files: readonly PluginClientArtifactFile[],
	identity: Pick<PluginClientArtifactMetadata, "clientDeclarationHash" | "imports">,
): PluginClientArtifactMetadata => ({
	...artifactMetadata(
		pluginName,
		files,
		{ packageId, clientDeclarationHash: identity.clientDeclarationHash },
		identity.imports,
	),
	packageId,
	clientDeclarationHash: identity.clientDeclarationHash,
});

export const clientRuntimeArtifactMetadata = (
	name: string,
	files: readonly PluginClientArtifactFile[],
	imports: readonly PluginClientImport[] = [],
): ClientRuntimeArtifactMetadata => artifactMetadata(name, files, { kind: "kernel" }, imports);

const artifactMetadata = (
	pluginName: string,
	files: readonly PluginClientArtifactFile[],
	owner:
		| Pick<PluginClientArtifactMetadata, "packageId" | "clientDeclarationHash">
		| { readonly kind: "kernel" },
	imports: readonly PluginClientImport[],
): ClientRuntimeArtifactMetadata => {
	const versions = {
		format: CLIENT_ARTIFACT_FORMAT,
		apiVersion: CLIENT_API_VERSION,
		compilerVersion: CLIENT_COMPILER_VERSION,
		bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
	};
	const sortedImports = imports.slice().sort((left, right) => {
		const leftSpecifier = pluginExportSpecifier(left.reference, left.exportName);
		const rightSpecifier = pluginExportSpecifier(right.reference, right.exportName);
		if (leftSpecifier < rightSpecifier) {
			return -1;
		}
		return leftSpecifier > rightSpecifier ? 1 : 0;
	});
	const identity = { ...versions, ...owner, imports: sortedImports };
	const fileIdentity = files
		.map(({ name, contents, contentType }) => ({ name, contentType, sha256: sha256Hex(contents) }))
		.sort((left, right) => {
			if (left.name < right.name) {
				return -1;
			}
			return left.name > right.name ? 1 : 0;
		});
	return {
		...versions,
		imports: sortedImports,
		hash: sha256Hex(stableStringify({ name: pluginName, metadata: identity, files: fileIdentity })),
	};
};

const artifactFiles = <Encoded, DecodingServices, EncodingServices>(
	contents: Schema.Codec<Uint8Array, Encoded, DecodingServices, EncodingServices>,
) =>
	Schema.Array(pluginClientArtifactFile(contents)).pipe(
		Schema.check(
			Schema.makeFilter((files) =>
				new Set(files.map(({ name }) => name)).size === files.length
					? true
					: "Expected unique client artifact file names",
			),
		),
	);

const pluginClientArtifact = <Encoded, DecodingServices, EncodingServices>(
	contents: Schema.Codec<Uint8Array, Encoded, DecodingServices, EncodingServices>,
) => strictStruct({ ...PluginClientArtifactMetadata.fields, files: artifactFiles(contents) });

const clientRuntimeArtifact = <Encoded, DecodingServices, EncodingServices>(
	contents: Schema.Codec<Uint8Array, Encoded, DecodingServices, EncodingServices>,
) => strictStruct({ ...ClientRuntimeArtifactMetadata.fields, files: artifactFiles(contents) });

export const PluginClientArtifact = pluginClientArtifact(Schema.Uint8Array);

export type PluginClientArtifact = Schema.Schema.Type<typeof PluginClientArtifact>;

export const ClientRuntimeArtifact = clientRuntimeArtifact(Schema.Uint8Array);
export type ClientRuntimeArtifact = Schema.Schema.Type<typeof ClientRuntimeArtifact>;

export const ClientArtifact = Schema.Union([PluginClientArtifact, ClientRuntimeArtifact]);
export type ClientArtifact = Schema.Schema.Type<typeof ClientArtifact>;

const CanonicalUint8ArrayFromBase64 = CanonicalBase64.pipe(
	Schema.decodeTo(Schema.Uint8ArrayFromBase64),
);

export const PluginClientArtifactFromBase64 = pluginClientArtifact(CanonicalUint8ArrayFromBase64);
export const ClientRuntimeArtifactFromBase64 = clientRuntimeArtifact(CanonicalUint8ArrayFromBase64);
export const ClientArtifactFromBase64 = Schema.Union([
	PluginClientArtifactFromBase64,
	ClientRuntimeArtifactFromBase64,
]);
