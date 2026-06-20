import { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import { EntityId, EntitySchemaId } from "@ryot/contract/schema/brands";
import { Schema } from "effect";

/**
 * Shared mutation envelope for automation-producing writes.
 *
 * Every durable business operation is owned by exactly one workflow or
 * durable-queue worker. Its write Activity performs the transaction and
 * returns typed `MutationOutcome`s plus one `MutationContext` per committed
 * material mutation; the workflow body — never the Activity, a service, or a
 * repository — dispatches lifecycle subscription children from that envelope.
 *
 * Occurrence IDs must be derived from the owning workflow execution ID plus
 * stable item indices and stable business identity — never from randomness or
 * database return order, so replay resolves to the same occurrence.
 */

export const MutationScopeEntity = Schema.Struct({
	id: EntityId,
	name: Schema.String,
	entitySchemaId: EntitySchemaId,
	entitySchemaSlug: Schema.String,
});

export type MutationScopeEntity = typeof MutationScopeEntity.Type;

export const MutationOwningSeason = Schema.Struct({
	name: Schema.NullOr(Schema.String),
	number: Schema.NullOr(Schema.Number),
});

export type MutationOwningSeason = typeof MutationOwningSeason.Type;

export const ProviderMutationContext = Schema.Struct({
	scopeEntity: Schema.optional(MutationScopeEntity),
	owningSeason: Schema.optional(MutationOwningSeason),
	rootPreviouslyPopulated: Schema.optional(Schema.Boolean),
});

export type ProviderMutationContext = typeof ProviderMutationContext.Type;

export const MutationContext = Schema.Struct({
	origin: AutomationOrigin,
	occurrenceId: Schema.String,
	correlationId: Schema.String,
	providerContext: Schema.optional(ProviderMutationContext),
	automationDepth: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});

export type MutationContext = typeof MutationContext.Type;

export const MutationOutcome = <Value extends Schema.Schema.Any>(value: Value) =>
	Schema.Union(
		Schema.Struct({ operation: Schema.Literal("noop"), current: value }),
		Schema.Struct({ operation: Schema.Literal("create"), after: value }),
		Schema.Struct({ operation: Schema.Literal("delete"), before: value }),
		Schema.Struct({ operation: Schema.Literal("update"), before: value, after: value }),
	);

export type MutationOutcome<T> =
	| { operation: "create"; after: T }
	| { operation: "noop"; current: T }
	| { operation: "delete"; before: T }
	| { operation: "update"; before: T; after: T };

export type MaterialMutationOutcome<T> = Exclude<MutationOutcome<T>, { operation: "noop" }>;

export const isMaterialMutation = <T>(
	outcome: MutationOutcome<T>,
): outcome is MaterialMutationOutcome<T> => outcome.operation !== "noop";
