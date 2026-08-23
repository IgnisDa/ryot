import { CLIENT_API_VERSION } from "@ryot-app/client-plugin-contract";
import { Schema } from "effect";

export const ClientPluginExportKind = Schema.Literals(["component", "page", "presentation"]);
export type ClientPluginExportKind = Schema.Schema.Type<typeof ClientPluginExportKind>;

export const ClientPluginCompilerPackageExport = Schema.Struct({
	entry: Schema.String,
	kind: ClientPluginExportKind,
});
export type ClientPluginCompilerPackageExport = Schema.Schema.Type<
	typeof ClientPluginCompilerPackageExport
>;

export const ClientPluginCompilerPublicExport = Schema.Struct({
	entry: Schema.String,
	contributor: Schema.String,
	kind: ClientPluginExportKind,
});
export type ClientPluginCompilerPublicExport = Schema.Schema.Type<
	typeof ClientPluginCompilerPublicExport
>;

export const ClientPluginAutomaticRegistryEntry = Schema.Struct({
	ownerPluginId: Schema.String,
	exportSpecifier: Schema.String,
	entitySchemaSlug: Schema.String,
	layout: Schema.Literals(["grid", "list"]),
});
export type ClientPluginAutomaticRegistryEntry = Schema.Schema.Type<
	typeof ClientPluginAutomaticRegistryEntry
>;

export const ClientPluginRouteRegistry = Schema.Struct({
	home: Schema.String,
	notFound: Schema.optional(Schema.String),
	routes: Schema.Array(Schema.Struct({ path: Schema.String, exportSpecifier: Schema.String })),
});
export type ClientPluginRouteRegistry = Schema.Schema.Type<typeof ClientPluginRouteRegistry>;

const ClientPluginCompilerBaseFields = {
	name: Schema.String,
	apiVersion: Schema.Literal(CLIENT_API_VERSION),
};

const compilerContributor = <Encoded, DecodingServices, EncodingServices>(
	contents: Schema.Codec<Uint8Array, Encoded, DecodingServices, EncodingServices>,
) => Schema.Struct({ files: Schema.Record(Schema.String, contents) });

export const clientPluginCompilerInputSchemas = <Encoded, DecodingServices, EncodingServices>(
	contents: Schema.Codec<Uint8Array, Encoded, DecodingServices, EncodingServices>,
) => {
	const packageInput = Schema.Struct({
		...ClientPluginCompilerBaseFields,
		files: Schema.Record(Schema.String, contents),
		pluginDependencies: Schema.optional(Schema.Array(Schema.String)),
		publicExports: Schema.Record(Schema.String, ClientPluginCompilerPackageExport),
	});
	const graphInput = Schema.Struct({
		...ClientPluginCompilerBaseFields,
		contributorOrder: Schema.Array(Schema.String),
		application: Schema.Literals(["page", "plugin-route"]),
		routeRegistry: Schema.optional(ClientPluginRouteRegistry),
		entry: Schema.Struct({ path: Schema.String, contributor: Schema.String }),
		contributors: Schema.Record(Schema.String, compilerContributor(contents)),
		publicExports: Schema.Record(Schema.String, ClientPluginCompilerPublicExport),
		automaticRegistry: Schema.optional(Schema.Array(ClientPluginAutomaticRegistryEntry)),
	});
	return { graphInput, packageInput, input: Schema.Union([packageInput, graphInput]) } as const;
};

const schemas = clientPluginCompilerInputSchemas(Schema.Uint8Array);

export const ClientPluginCompilerContributor = compilerContributor(Schema.Uint8Array);
export type ClientPluginCompilerContributor = Schema.Schema.Type<
	typeof ClientPluginCompilerContributor
>;
export const ClientPluginCompilerPackageInput = schemas.packageInput;
export type ClientPluginCompilerPackageInput = Schema.Schema.Type<
	typeof ClientPluginCompilerPackageInput
>;
export const ClientPluginCompilerGraphInput = schemas.graphInput;
export type ClientPluginCompilerGraphInput = Schema.Schema.Type<
	typeof ClientPluginCompilerGraphInput
>;
export const ClientPluginCompilerInput = schemas.input;
export type ClientPluginCompilerInput = Schema.Schema.Type<typeof ClientPluginCompilerInput>;
