import { PluginDependencies } from "@ryot-app/contract/modules/plugins/manifest";
import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { CLIENT_API_VERSION } from "@ryot-app/plugin-client-contract";
import { Schema } from "effect";

export const ClientPluginExportKind = Schema.Literals([
	"component",
	"page",
	"presentation",
	"analytics-section",
]);
export type ClientPluginExportKind = Schema.Schema.Type<typeof ClientPluginExportKind>;

export const ClientPluginCompilerPackageExport = Schema.Struct({
	entry: Schema.String,
	kind: ClientPluginExportKind,
});
export type ClientPluginCompilerPackageExport = Schema.Schema.Type<
	typeof ClientPluginCompilerPackageExport
>;

export const clientPluginCompilerInputSchema = <Encoded, DecodingServices, EncodingServices>(
	contents: Schema.Codec<Uint8Array, Encoded, DecodingServices, EncodingServices>,
) => {
	const commonInputFields = {
		name: Schema.String,
		files: Schema.Record(Schema.String, contents),
		apiVersion: Schema.Literal(CLIENT_API_VERSION),
		pluginDependencies: Schema.optional(PluginDependencies),
		publicExports: Schema.Record(Schema.String, ClientPluginCompilerPackageExport),
	};
	return Schema.Union([
		Schema.Struct({
			...commonInputFields,
			packageId: PluginPackageId,
			kind: Schema.Literal("plugin"),
			clientDeclarationHash: Schema.String,
		}),
		Schema.Struct({ ...commonInputFields, kind: Schema.Literal("kernel") }),
		Schema.Struct({
			...commonInputFields,
			kind: Schema.Literal("page"),
			pageDeclarationHash: Schema.String,
		}),
	]);
};
export const PluginClientCompilerPackageInput = clientPluginCompilerInputSchema(Schema.Uint8Array);
export type PluginClientCompilerPackageInput = Schema.Schema.Type<
	typeof PluginClientCompilerPackageInput
>;
