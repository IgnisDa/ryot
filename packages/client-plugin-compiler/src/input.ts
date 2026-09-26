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

export const ClientPluginCompilerPackageInput = Schema.Struct({
	name: Schema.String,
	apiVersion: Schema.Literal(CLIENT_API_VERSION),
	files: Schema.Record(Schema.String, Schema.Uint8Array),
	pluginDependencies: Schema.optional(Schema.Array(Schema.String)),
	publicExports: Schema.Record(Schema.String, ClientPluginCompilerPackageExport),
});
export type ClientPluginCompilerPackageInput = Schema.Schema.Type<
	typeof ClientPluginCompilerPackageInput
>;
