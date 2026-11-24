import { Message } from "@ryot-app/i18n/message";
import { Schema } from "effect";

import { AutomationRunId, EntityId } from "../../schema/brands";

const EntityUserDataBadRequestReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("same-entity-merge") }),
	Schema.Struct({ code: Schema.Literal("entity-schema-mismatch") }),
	Schema.Struct({ code: Schema.Literal("relationship-merge-failed") }),
	Schema.Struct({ code: Schema.Literal("state-conflict") }),
	Schema.Struct({
		entityIds: Schema.Array(EntityId),
		code: Schema.Literal("child-mapping-conflict"),
	}),
	Schema.Struct({ property: Schema.String, code: Schema.Literal("identity-property-mismatch") }),
	Schema.Struct({
		code: Schema.Literal("required-field"),
		field: Schema.Literals(["entityId", "mergeFrom", "mergeInto"]),
	}),
	Schema.Struct({
		code: Schema.Literal("operation-denied"),
		operation: Schema.Literals(["clear", "merge"]),
	}),
	Schema.Struct({ message: Message, code: Schema.Literal("policy-rejected") }),
	Schema.Struct({ runId: AutomationRunId, code: Schema.Literal("policy-execution-failed") }),
]);

const EntityUserDataNotFoundReason = Schema.Union([
	Schema.Struct({
		code: Schema.Literal("entity-not-found"),
		entityIds: Schema.NonEmptyArray(EntityId),
	}),
]);

export class EntityUserDataNotFound extends Schema.TaggedError<
	EntityUserDataNotFound,
	{ readonly brand: unique symbol }
>()("EntityUserDataNotFound", { reason: EntityUserDataNotFoundReason }) {}

export class EntityUserDataBadRequest extends Schema.TaggedError<
	EntityUserDataBadRequest,
	{ readonly brand: unique symbol }
>()("EntityUserDataBadRequest", { reason: EntityUserDataBadRequestReason }) {}

/** A policy the change needs could not run for now; the same request may succeed later. */
export class EntityUserDataUnavailable extends Schema.TaggedError<
	EntityUserDataUnavailable,
	{ readonly brand: unique symbol }
>()("EntityUserDataUnavailable", {
	reason: Schema.Struct({ code: Schema.Literal("resource-unavailable") }),
}) {}

export const ClearEntityUserDataResponse = Schema.Struct({
	entityId: EntityId,
	deletedEventsCount: Schema.Finite,
	deletedRelationshipsCount: Schema.Finite,
});

export type ClearEntityUserDataResponse = typeof ClearEntityUserDataResponse.Type;

export const MergeEntityUserDataBody = Schema.Struct({ mergeFrom: EntityId, mergeInto: EntityId });

export type MergeEntityUserDataBody = typeof MergeEntityUserDataBody.Type;

export const MergeEntityUserDataResponse = Schema.Struct({
	mergeFrom: EntityId,
	mergeInto: EntityId,
	movedEventsCount: Schema.Finite,
	movedRelationshipsCount: Schema.Finite,
});

export type MergeEntityUserDataResponse = typeof MergeEntityUserDataResponse.Type;
