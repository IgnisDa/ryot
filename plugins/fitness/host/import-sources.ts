import type { DefinitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type { PluginId } from "@ryot-app/contract/schema/brands";
import { strictStruct } from "@ryot-app/contract/schema/utils";
import { Schema } from "effect";

const uploadTokenInput = <const Source extends string>(source: Source) =>
	strictStruct({ source: Schema.Literal(source), uploadToken: Schema.NonEmptyString }).pipe(
		Schema.annotate({ identifier: `FitnessImportInput_${source}` }),
	);

const timezoneUploadTokenInput = <const Source extends string>(source: Source) =>
	strictStruct({
		source: Schema.Literal(source),
		timezone: Schema.NonEmptyString,
		uploadToken: Schema.NonEmptyString,
	}).pipe(Schema.annotate({ identifier: `FitnessImportInput_${source}` }));

export const FitnessCreateImportRunBody = Schema.Union([
	uploadTokenInput("open_scale"),
	timezoneUploadTokenInput("hevy"),
	timezoneUploadTokenInput("strong_app"),
]);

export type FitnessCreateImportRunBody = typeof FitnessCreateImportRunBody.Type;

export const createFitnessImportRunBody = <
	const Source extends FitnessCreateImportRunBody["source"],
>(
	pluginId: PluginId,
	body: Extract<FitnessCreateImportRunBody, { readonly source: Source }>,
) => ({
	...body,
	source: { slug: body.source, owner: { pluginId, kind: "plugin" } satisfies DefinitionOwner },
});
