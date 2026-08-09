import { TemporaryUploadToken } from "@ryot/contract/modules/uploads/schemas";
import { strictStruct } from "@ryot/contract/schema/utils";
import { Schema } from "effect";

const uploadTokenInput = <const Source extends string>(source: Source) =>
	strictStruct({ source: Schema.Literal(source), uploadToken: TemporaryUploadToken }).pipe(
		Schema.annotate({ identifier: `FitnessImportInput_${source}` }),
	);

export const FitnessCreateImportRunBody = Schema.Union([
	uploadTokenInput("hevy"),
	uploadTokenInput("open_scale"),
	uploadTokenInput("strong_app"),
]);

export type FitnessCreateImportRunBody = typeof FitnessCreateImportRunBody.Type;

export const createFitnessImportRunBody = <
	const Source extends FitnessCreateImportRunBody["source"],
>(
	body: Extract<FitnessCreateImportRunBody, { readonly source: Source }>,
) => body;
