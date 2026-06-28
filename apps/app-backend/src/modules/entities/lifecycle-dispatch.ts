import type { DbError } from "@ryot/contract/errors";
import type { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import type {
	EntityId,
	EntitySchemaId,
	EventId,
	EventSchemaId,
	RelationshipId,
	RelationshipSchemaId,
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
	entitySchemaSlug: string;
	entitySchemaId: EntitySchemaId;
	properties: Record<string, unknown>;
};

export type LifecycleEventSnapshot = {
	id: EventId;
	occurredAt: string;
	eventSchemaSlug: string;
	eventSchemaId: EventSchemaId;
	subject: LifecycleEntityReference;
	properties: Record<string, unknown>;
};

export type LifecycleRelationshipSnapshot = {
	id: RelationshipId;
	relationshipSchemaSlug: string;
	source: LifecycleEntityReference;
	target: LifecycleEntityReference;
	properties: Record<string, unknown>;
	relationshipSchemaId: RelationshipSchemaId;
};

export type LifecycleSource =
	| { kind: "entity"; after: LifecycleEntitySnapshot }
	| { kind: "event"; after: LifecycleEventSnapshot }
	| { kind: "relationship"; after: LifecycleRelationshipSnapshot };

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
};

export type LifecycleDispatchValue = {
	dispatch: (input: LifecycleDispatchInput) => Effect.Effect<void, DbError>;
};

export class LifecycleDispatch extends Context.Tag("LifecycleDispatch")<
	LifecycleDispatch,
	LifecycleDispatchValue
>() {}

/**
 * A dispatch seam that drops every occurrence. Used by write paths that are
 * intentionally occurrence-free and by tests that do not exercise automation.
 */
export const LifecycleDispatchNoop = Layer.succeed(LifecycleDispatch, {
	dispatch: () => Effect.void,
});
