import {
	CreateEventsResponse,
	EventPropertiesPatch,
	EventWritePrecondition,
} from "@ryot-app/contract/modules/events/schemas";
import {
	EventStreamProcessorReference,
	EventStreamWorkRequest,
} from "@ryot-app/contract/modules/events/stream-work";
import { PluginId } from "@ryot-app/contract/schema/brands";
import { Effect, Option, Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { hostResultSchema, jsonValueSchema, strictStruct } from "../wire";
import { sandboxEntitySchemaSlugListSchema } from "./entities";
import { EVENT_MUTATION_SANDBOX_LIMITS } from "./limits";
import { nonEmptyString, sandboxIdSchema } from "./primitives";
import { optionalSubmissionOptions, submissionOptionsSchema } from "./writes";

export const eventSchemaRecordSchema = strictStruct({
	id: Schema.String,
	name: Schema.String,
	slug: Schema.String,
	entitySchemaSlug: Schema.String,
	pluginId: Schema.NullOr(PluginId),
	propertiesSchema: jsonValueSchema,
});
export type EventSchemaRecord = Schema.Schema.Type<typeof eventSchemaRecordSchema>;
export const eventRecordSchema = strictStruct({
	id: Schema.String,
	entityId: Schema.String,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	occurredAt: Schema.String,
	properties: jsonValueSchema,
	eventSchemaName: Schema.String,
	eventSchemaSlug: Schema.String,
	eventSchemaPluginId: Schema.NullOr(PluginId),
	sessionEntityId: Schema.optional(Schema.String),
});
export type EventRecord = Schema.Schema.Type<typeof eventRecordSchema>;
export const createEventItemSchema = strictStruct({
	entityId: sandboxIdSchema,
	properties: jsonValueSchema,
	eventSchemaSlug: sandboxIdSchema,
	occurredAt: Schema.optional(Schema.String),
	sessionEntityId: Schema.optional(sandboxIdSchema),
});
export type CreateEventItem = Schema.Schema.Type<typeof createEventItemSchema>;
export const createEventsResultDataSchema = strictStruct({
	outcomes: CreateEventsResponse.fields.outcomes,
	count: Schema.Number.pipe(Schema.check(Schema.isInt())),
});
const partialCreateEventsResult = Schema.decodeUnknownOption(
	Schema.Struct({ ...createEventsResultDataSchema.fields, partial: Schema.Literal(true) }),
);
export const recoverPartialCreateEvents = <Error extends { readonly data?: unknown }>(
	error: Error,
): Effect.Effect<{ readonly count: number }, Error> => {
	const partial = partialCreateEventsResult(error.data);
	return Option.isSome(partial)
		? Effect.succeed({ count: partial.value.count })
		: Effect.fail(error);
};
const eventUpdatePatchSchema = strictStruct({
	entityId: Schema.optional(sandboxIdSchema),
	occurredAt: Schema.optional(Schema.String),
	properties: Schema.optional(EventPropertiesPatch),
	sessionEntityId: Schema.optional(Schema.NullOr(sandboxIdSchema)),
}).pipe(Schema.check(Schema.makeFilter((patch) => Object.keys(patch).length > 0)));
export const updateEventItemSchema = strictStruct({
	eventId: sandboxIdSchema,
	patch: eventUpdatePatchSchema,
	expected: Schema.optional(EventWritePrecondition),
});
export type UpdateEventItem = Schema.Schema.Type<typeof updateEventItemSchema>;
export const updateEventsArgsSchema = Schema.Tuple([
	Schema.Array(updateEventItemSchema).pipe(
		Schema.check(Schema.isMaxLength(EVENT_MUTATION_SANDBOX_LIMITS.items)),
	),
	optionalSubmissionOptions,
]);
export const deleteEventsArgsSchema = Schema.Tuple([
	Schema.Array(sandboxIdSchema).pipe(
		Schema.check(Schema.isMaxLength(EVENT_MUTATION_SANDBOX_LIMITS.items)),
	),
	Schema.optional(
		Schema.UndefinedOr(
			strictStruct({
				...submissionOptionsSchema.fields,
				expected: Schema.optional(Schema.Record(Schema.String, EventWritePrecondition)),
			}),
		),
	),
]);
export const updateEventsResultDataSchema = strictStruct({
	count: Schema.Number.pipe(Schema.check(Schema.isInt())),
});
export const deleteEventsResultDataSchema = updateEventsResultDataSchema;
export const updateEventsResultSchema = hostResultSchema(updateEventsResultDataSchema);
export const deleteEventsResultSchema = hostResultSchema(deleteEventsResultDataSchema);
export const listEventSchemasDataSchema = Schema.Array(eventSchemaRecordSchema);
export const createEventsResultSchema = hostResultSchema(createEventsResultDataSchema);
export const createEventsArgsSchema = Schema.Tuple([
	Schema.Array(createEventItemSchema),
	optionalSubmissionOptions,
]);
export const requestEventStreamWorkArgsSchema = Schema.Tuple([
	EventStreamWorkRequest,
	EventStreamProcessorReference,
]);
export const requestEventStreamWorkDataSchema = strictStruct({ workId: nonEmptyString });
export const requestEventStreamWorkResultSchema = hostResultSchema(
	requestEventStreamWorkDataSchema,
);
export const listEventSchemasArgsSchema = Schema.Tuple([sandboxEntitySchemaSlugListSchema]);
export const listEventSchemasResultSchema = hostResultSchema(listEventSchemasDataSchema);
