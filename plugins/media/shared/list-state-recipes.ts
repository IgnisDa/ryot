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
	selectedField,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/plugin-kit/ryotql";
import { EventId } from "@ryot-app/plugin-kit/schema";

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

export const listStateSnapshotsRecipe = defineRecipe(
	(input: {
		readonly after?: string | undefined;
		readonly limit: number;
		readonly sourceAccountId: string;
		readonly sourceEntryIds: readonly string[];
	}) => {
		const event = table("event", "listStateSnapshot");
		const entity = table("entity", "listStateSnapshotEntity");
		return {
			map: ({ snapshots }) => Result.succeed(snapshots),
			queries: {
				snapshots: selectedRows(event, {
					limit: input.limit,
					...(input.after === undefined ? {} : { after: input.after }),
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
						eq(column(event, "eventSchemaSlug"), literal("list-state")),
						eq(propertyText(event, "source"), literal("anilist")),
						eq(propertyText(event, "sourceAccountId"), literal(input.sourceAccountId)),
						inArray(
							propertyText(event, "sourceEntryId"),
							input.sourceEntryIds.map((sourceEntryId) => literal(sourceEntryId)),
						),
						inArray(column(entity, "entitySchemaSlug"), [literal("anime"), literal("manga")]),
					),
				}),
			},
		};
	},
);

export type ListStateSnapshots = Recipe.Success<typeof listStateSnapshotsRecipe>;
