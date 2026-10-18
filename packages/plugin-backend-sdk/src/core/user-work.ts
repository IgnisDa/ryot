import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { hostResultSchema, jsonValueSchema, strictStruct } from "../wire";

export const requestUserWorkArgsSchema = Schema.Tuple([
	strictStruct({
		input: jsonValueSchema,
		key: Schema.NonEmptyString.check(Schema.isMaxLength(512)),
		scope: Schema.NonEmptyString.check(Schema.isMaxLength(512)),
	}),
	strictStruct({ scriptSlug: Schema.NonEmptyString, referenceKind: Schema.Literal("script") }),
]);
export const requestUserWorkDataSchema = strictStruct({ workId: Schema.String });
export const requestUserWorkResultSchema = hostResultSchema(requestUserWorkDataSchema);
