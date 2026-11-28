import type {
	EntityBadRequest,
	EntityNotFound,
	EntityStale,
} from "@ryot-app/contract/modules/entities/schemas";
import type {
	EntityUserDataBadRequest,
	EntityUserDataNotFound,
} from "@ryot-app/contract/modules/entity-user-data/schemas";
import type {
	EventBadRequest,
	EventCreateItemError,
	EventNotFound,
	EventStale,
} from "@ryot-app/contract/modules/events/schemas";
import type {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import { EntityId, EventId } from "@ryot-app/contract/schema/brands";
import { strictStruct } from "@ryot-app/contract/schema/utils";
import { Effect, Schema } from "effect";

/** What conflicted, with the event or entities it names. */
export const CommitConflictReason = Schema.Union([
	strictStruct({ eventId: EventId, code: Schema.Literal("event-stale") }),
	strictStruct({ eventId: EventId, code: Schema.Literal("event-not-found") }),
	strictStruct({ entityId: EntityId, code: Schema.Literal("entity-stale") }),
	strictStruct({
		code: Schema.Literal("entity-not-found"),
		entityIds: Schema.NonEmptyArray(EntityId),
	}),
	strictStruct({
		entityIds: Schema.Array(EntityId),
		code: Schema.Literal("child-mapping-conflict"),
	}),
	strictStruct({
		code: Schema.Literals([
			"state-conflict",
			"mutation-conflict",
			"concurrent-relationship-change",
		]),
	}),
]);
export type CommitConflictReason = typeof CommitConflictReason.Type;

/**
 * The change set's baseline changed or vanished concurrently, or the user data it clears or merges no
 * longer allows the change; nothing committed. Routes map it to their own wire errors.
 */
export class CommitConflict extends Schema.TaggedError<
	CommitConflict,
	{ readonly brand: unique symbol }
>()("CommitConflict", { reason: CommitConflictReason }) {}

const conflict = (reason: CommitConflictReason) => Effect.fail(new CommitConflict({ reason }));

const unlessConflict =
	<E extends { readonly reason: { readonly code: string } }>(
		reasonOf: (error: E) => null | CommitConflictReason,
	) =>
	(error: E) => {
		const reason = reasonOf(error);
		return reason === null ? Effect.fail(error) : conflict(reason);
	};

const mutationConflict = (error: { readonly reason: { readonly code: string } }) =>
	error.reason.code === "mutation-conflict" ? { code: "mutation-conflict" as const } : null;

/** The `catchTags` cases that turn the commit failures that are conflicts into `CommitConflict`. */
export const commitConflicts = {
	EventStale: (error: EventStale) => conflict(error.reason),
	EntityStale: (error: EntityStale) => conflict(error.reason),
	EventNotFound: (error: EventNotFound) => conflict(error.reason),
	EntityUserDataNotFound: (error: EntityUserDataNotFound) => conflict(error.reason),
	EventBadRequest: unlessConflict((error: EventBadRequest) => mutationConflict(error)),
	EntityBadRequest: unlessConflict((error: EntityBadRequest) => mutationConflict(error)),
	RelationshipNotFound: unlessConflict((error: RelationshipNotFound) =>
		error.reason.code === "entity-not-found" ? error.reason : null,
	),
	EntityNotFound: unlessConflict((error: EntityNotFound) =>
		error.reason.code === "entity-not-found"
			? { code: "entity-not-found", entityIds: [error.reason.entityId] }
			: null,
	),
	EntityUserDataBadRequest: unlessConflict((error: EntityUserDataBadRequest) =>
		error.reason.code === "state-conflict" || error.reason.code === "child-mapping-conflict"
			? error.reason
			: null,
	),
	RelationshipBadRequest: unlessConflict((error: RelationshipBadRequest) =>
		error.reason.code === "concurrent-relationship-change"
			? { code: "concurrent-relationship-change" as const }
			: null,
	),
	EventCreateItemError: unlessConflict((error: EventCreateItemError) => {
		if (error.reason.code === "entity-not-found") {
			return { code: "entity-not-found", entityIds: [error.reason.entityId] };
		}
		return mutationConflict(error);
	}),
};
