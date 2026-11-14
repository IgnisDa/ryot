import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	castJson,
	column,
	conditional,
	defineRecipe,
	eq,
	eventOrderDescending,
	inArray,
	IsoDateString,
	join,
	literal,
	parameters,
	type Recipe,
	schemaOwnerPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { EventId } from "@ryot-app/plugin-kit/schema";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import { propertyText, type Table } from "./entity-selections";
import { ListStatePropertiesSchema } from "./list-state";

export const listStateActivityPropertiesField = (event: Table) =>
	selectedField(
		conditional(
			eq(column(event, "eventSchemaSlug"), literal("list-state")),
			castJson(column(event, "properties")),
			literal(null),
		),
		Schema.NullOr(ListStatePropertiesSchema),
	);
export const listStateSnapshotsRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
	const inputParameters = parameters({
		fields: {
			sourceAccountId: {
				type: "string",
				label: "sourceAccountId",
				validation: { required: true },
				description: "sourceAccountId for this selection",
			},
			sourceEntryIds: {
				type: "array",
				label: "sourceEntryIds",
				validation: { required: true },
				description: "sourceEntryIds for this selection",
				items: { label: "ID", type: "string", description: "Selected ID" },
			},
		},
	});
	const event = table("event", "listStateSnapshot");
	const entity = table("entity", "listStateSnapshotEntity");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ snapshots }) => Result.succeed(snapshots),
		queries: {
			snapshots: selectedRows(event, {
				limit: 100,
				orderBy: eventOrderDescending(event),
				joins: [join("inner", entity, eq(column(event, "entityId"), column(entity, "id")))],
				selection: {
					id: selectedField(column(event, "id"), EventId),
					occurredAt: selectedField(column(event, "occurredAt"), IsoDateString),
					properties: selectedField(
						castJson(column(event, "properties")),
						ListStatePropertiesSchema,
					),
				},
				where: and(
					schemaOwnerPredicate(entity, "entitySchemaPluginId", input.reference),
					schemaOwnerPredicate(event, "eventSchemaPluginId", input.reference),
					eq(column(event, "eventSchemaSlug"), literal("list-state")),
					eq(propertyText(event, "source"), literal("anilist")),
					eq(propertyText(event, "sourceAccountId"), inputParameters.value("sourceAccountId")),
					inArray(propertyText(event, "sourceEntryId"), inputParameters.list("sourceEntryIds")),
					inArray(column(entity, "entitySchemaSlug"), [literal("anime"), literal("manga")]),
				),
			}),
		},
	});
};
export type ListStateSnapshots = Recipe.Success<ReturnType<typeof listStateSnapshotsRecipe>>;
