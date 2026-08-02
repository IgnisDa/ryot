import type { DbError } from "@ryot/contract/errors";
import type {
	AutomationOperation,
	AutomationOrigin,
} from "@ryot/contract/modules/automations/schemas";
import type { JsonValue } from "@ryot/contract/modules/ryotql/language";
import type {
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	RelationshipId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

export type LifecycleEntityReference = {
	id: EntityId;
	name: string;
	entitySchemaSlug: string;
};

export type LifecycleEntitySnapshot = {
	id: EntityId;
	name: string;
	entitySchemaSlug: EntitySchemaSlug;
	properties: Record<string, unknown>;
};

export type LifecycleEventSnapshot = {
	id: EventId;
	occurredAt: string;
	eventSchemaSlug: EventSchemaSlug;
	subject: LifecycleEntityReference;
	properties: Record<string, unknown>;
};

export type LifecycleRelationshipSnapshot = {
	id: RelationshipId;
	source: LifecycleEntityReference;
	target: LifecycleEntityReference;
	properties: Record<string, unknown>;
	relationshipSchemaSlug: RelationshipSchemaSlug;
};

export type LifecycleSource =
	| { kind: "entity"; after?: LifecycleEntitySnapshot; before?: LifecycleEntitySnapshot }
	| { kind: "event"; after?: LifecycleEventSnapshot; before?: LifecycleEventSnapshot }
	| {
			kind: "relationship";
			after?: LifecycleRelationshipSnapshot;
			before?: LifecycleRelationshipSnapshot;
	  };

export type LifecyclePopulationContext = {
	rootPreviouslyPopulated: boolean;
	batch?: {
		id: string;
		isLeader: boolean;
		afterCount: number;
		beforeCount: number;
		createdCount: number;
		deletedCount: number;
		updatedCount: number;
	};
	parentEntity?: {
		name: string;
		entitySchemaSlug: EntitySchemaSlug;
		properties: Record<string, JsonValue>;
	};
	scopeEntity: {
		id: EntityId;
		name: string;
		entitySchemaSlug: EntitySchemaSlug;
	};
};

/**
 * A committed lifecycle create occurrence handed to the automation dispatcher
 * after the write transaction commits. Origins and recipients are always
 * server-derived; public callers can never populate this input directly.
 */
export type LifecycleDispatchInput = {
	recordId: string;
	occurredAt: string;
	occurrenceId: string;
	source: LifecycleSource;
	origin: AutomationOrigin;
	rowUserId: UserId | null;
	population?: LifecyclePopulationContext;
	operation?: Exclude<AutomationOperation, "signal">;
};

export type LifecycleDispatchValue = {
	dispatch: (input: LifecycleDispatchInput) => Effect.Effect<void, DbError>;
};

export class LifecycleDispatch extends Context.Service<LifecycleDispatch, LifecycleDispatchValue>()(
	"LifecycleDispatch",
) {}

/**
 * A dispatch seam that drops every occurrence. Used by write paths that are
 * intentionally occurrence-free and by tests that do not exercise automation.
 */
export const LifecycleDispatchNoop = Layer.succeed(LifecycleDispatch, {
	dispatch: () => Effect.void,
});
