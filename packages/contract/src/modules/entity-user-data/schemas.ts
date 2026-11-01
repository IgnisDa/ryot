import { Schema } from "effect";

import { EntityId } from "../../schema/brands";
import { IsoUtcString } from "../../schema/utils";
import { AutomationWarning } from "../automations/lifecycle";

const EntityUserDataBadRequestReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("command-identity-conflict") }),
	Schema.Struct({ code: Schema.Literal("same-entity-merge") }),
	Schema.Struct({ code: Schema.Literal("entity-schema-mismatch") }),
	Schema.Struct({ code: Schema.Literal("relationship-merge-failed") }),
	Schema.Struct({ message: Schema.String, code: Schema.Literal("state-conflict") }),
	Schema.Struct({
		message: Schema.String,
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

export const ClearEntityUserDataResponse = Schema.Struct({
	entityId: EntityId,
	deletedEventsCount: Schema.Finite,
	deletedRelationshipsCount: Schema.Finite,
	warnings: Schema.Array(AutomationWarning),
});

export type ClearEntityUserDataResponse = typeof ClearEntityUserDataResponse.Type;

export const ClearEntityUserDataRequest = Schema.Struct({
	submittedAt: IsoUtcString,
	idempotencyKey: Schema.NonEmptyString,
});

export type ClearEntityUserDataRequest = typeof ClearEntityUserDataRequest.Type;

export const MergeEntityUserDataBody = Schema.Struct({ mergeFrom: EntityId, mergeInto: EntityId });

export type MergeEntityUserDataBody = typeof MergeEntityUserDataBody.Type;

export const MergeEntityUserDataRequest = Schema.Struct({
	...MergeEntityUserDataBody.fields,
	submittedAt: IsoUtcString,
	idempotencyKey: Schema.NonEmptyString,
});

export type MergeEntityUserDataRequest = typeof MergeEntityUserDataRequest.Type;

export const MergeEntityUserDataResponse = Schema.Struct({
	mergeFrom: EntityId,
	mergeInto: EntityId,
	movedEventsCount: Schema.Finite,
	movedRelationshipsCount: Schema.Finite,
	warnings: Schema.Array(AutomationWarning),
});

export type MergeEntityUserDataResponse = typeof MergeEntityUserDataResponse.Type;
