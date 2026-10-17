import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { hostResultSchema, jsonValueSchema, strictStruct } from "../wire";
import { nonEmptyString, sandboxIdSchema } from "./primitives";

export const emitSignalRequestSchema = strictStruct({
	schemaSlug: nonEmptyString,
	discriminator: nonEmptyString,
	subjectEntityId: Schema.optional(sandboxIdSchema),
	properties: Schema.Record(Schema.String, jsonValueSchema),
});
export const emitSignalArgsSchema = Schema.Tuple([emitSignalRequestSchema]);
export const emitSignalDataSchema = strictStruct({
	triggerId: Schema.String,
	wasCreated: Schema.Boolean,
});
export const emitSignalResultSchema = hostResultSchema(emitSignalDataSchema);
export const sendNotificationArgsSchema = Schema.Tuple([
	Schema.Trim.pipe(Schema.check(Schema.isMinLength(1))),
]);
