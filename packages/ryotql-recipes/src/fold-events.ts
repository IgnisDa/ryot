import type { Predicate, ScalarExpression } from "@ryot-app/contract/modules/ryotql/authored";
import { EntityId, EventId } from "@ryot-app/contract/schema/brands";
import {
	and,
	column,
	eq,
	exists,
	inArray,
	literal,
	not,
	or,
	schemaOwnerPredicate,
	selectedField,
	table,
} from "@ryot-app/ryotql";
import { Schema } from "effect";

import { IsoDateString } from "./codecs";

/** A plugin's fold declarations: each folding entity schema with the event schemas it folds. */
export type FoldDeclarations = ReadonlyArray<{
	readonly entitySchemaSlug: string;
	readonly eventSchemaSlugs: ReadonlyArray<string>;
}>;

type Table = ReturnType<typeof table>;

/**
 * Keeps the plugin's `event` rows of `eventSchemaSlugs` that belong to `subject` as the kernel routes
 * them: to the event's session when `folds` lists the session's schema with the event's schema, and
 * otherwise to the event's own entity.
 */
export const foldSubjectEventPredicate = (
	event: Table,
	input: {
		readonly folds: FoldDeclarations;
		readonly subject: ScalarExpression;
		readonly eventSchemaSlugs: ReadonlyArray<string>;
	},
): Predicate => {
	const session = table("entity", `${event.alias}Session`);
	const sessionFolds = exists(session, {
		where: and(
			eq(column(session, "id"), column(event, "sessionEntityId")),
			schemaOwnerPredicate(session, "entitySchemaPluginId", { kind: "self" }),
			or(
				...input.folds.map(({ entitySchemaSlug, eventSchemaSlugs }) =>
					and(
						eq(column(session, "entitySchemaSlug"), literal(entitySchemaSlug)),
						inArray(column(event, "eventSchemaSlug"), eventSchemaSlugs.map(literal)),
					),
				),
			),
		),
	});
	return and(
		schemaOwnerPredicate(event, "eventSchemaPluginId", { kind: "self" }),
		inArray(column(event, "eventSchemaSlug"), input.eventSchemaSlugs.map(literal)),
		or(
			eq(column(event, "sessionEntityId"), input.subject),
			and(eq(column(event, "entityId"), input.subject), not(sessionFolds)),
		),
	);
};

/** Selects `event`, on `entity`, as the fold image a change carries. */
export const foldEventImageSelection = (event: Table, entity: Table) => ({
	id: selectedField(column(event, "id"), EventId),
	entityId: selectedField(column(event, "entityId"), EntityId),
	revision: selectedField(column(event, "revision"), Schema.Int),
	orderKey: selectedField(column(event, "orderKey"), Schema.String),
	occurredAt: selectedField(column(event, "occurredAt"), IsoDateString),
	orderCreatedAt: selectedField(column(event, "orderCreatedAt"), IsoDateString),
	eventSchemaSlug: selectedField(column(event, "eventSchemaSlug"), Schema.String),
	entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
	sessionEntityId: selectedField(column(event, "sessionEntityId"), Schema.NullOr(EntityId)),
	properties: selectedField(column(event, "properties"), Schema.Record(Schema.String, Schema.Json)),
});
