import { PluginClientDependencies } from "@ryot-app/contract/modules/plugins/manifest";
import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { CLIENT_API_VERSION } from "@ryot-app/plugin-client-contract";
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

const commonInputFields = {
	name: Schema.String,
	apiVersion: Schema.Literal(CLIENT_API_VERSION),
	files: Schema.Record(Schema.String, Schema.Uint8Array),
	pluginDependencies: Schema.optional(PluginClientDependencies),
	publicExports: Schema.Record(Schema.String, ClientPluginCompilerPackageExport),
};
export const PluginClientCompilerPackageInput = Schema.Union([
	Schema.Struct({
		...commonInputFields,
		packageId: PluginPackageId,
		kind: Schema.Literal("plugin"),
		clientDeclarationHash: Schema.String,
	}),
	Schema.Struct({ ...commonInputFields, kind: Schema.Literal("kernel") }),
]);
export type PluginClientCompilerPackageInput = Schema.Schema.Type<
	typeof PluginClientCompilerPackageInput
>;
