import { CLIENT_API_VERSION } from "@ryot-app/client-plugin-contract";
import { PluginPackageReference } from "@ryot-app/contract/modules/plugins/references";
import { PluginPackageId } from "@ryot-app/contract/schema/brands";
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
	publicExports: Schema.Record(Schema.String, ClientPluginCompilerPackageExport),
	pluginDependencies: Schema.optional(Schema.Record(Schema.String, PluginPackageReference)),
};
export const ClientPluginCompilerPackageInput = Schema.Union([
	Schema.Struct({
		...commonInputFields,
		packageId: PluginPackageId,
		kind: Schema.Literal("plugin"),
		clientDeclarationHash: Schema.String,
	}),
	Schema.Struct({ ...commonInputFields, kind: Schema.Literal("kernel") }),
]);
export type ClientPluginCompilerPackageInput = Schema.Schema.Type<
	typeof ClientPluginCompilerPackageInput
>;
