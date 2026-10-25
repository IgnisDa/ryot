import { Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	and,
	ascending,
	castDate,
	castText,
	column,
	concat,
	conditional,
	defineRecipe,
	eq,
	gt,
	inArray,
	isNotNull,
	join,
	jsonPath,
	literal,
	or,
	schemaOwnerPredicate,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";

import { ConsumptionObservation } from "../../shared/consumption-allocation";
import type { ConsumptionPosition } from "../../shared/consumption-projection";
import { consumptionEventSlugs } from "../../shared/consumption-projection";
import { CompletionOccurrence } from "../../shared/history-correction";

export const consumptionPageSize = 50;

export const consumptionPageRecipe = defineRecipe(
	(input: { entityId: string; after: null | ConsumptionPosition }) => {
		const event = table("event", "consumptionSource");
		const entity = table("entity", "consumptionEntity");
		const occurrence = table("event", "consumptionBoundary");
		const automatic = table("event", "consumptionAutomatic");
		const property = (ref: typeof event, key: string) =>
			castText(jsonPath(column(ref, "properties"), key));
		const own = (ref: typeof event) =>
			schemaOwnerPredicate(ref, "eventSchemaPluginId", { kind: "self" });
		const group = conditional(
			isNotNull(property(event, "sourceRun")),
			concat(literal("source:"), property(event, "sourceRun")),
			conditional(
				eq(column(event, "eventSchemaSlug"), literal("item-complete")),
				concat(literal("item:"), column(event, "id")),
				literal(""),
			),
		);
		const order = [
			group,
			column(event, "occurredAt"),
			column(event, "orderCreatedAt"),
			column(event, "orderKey"),
			column(event, "id"),
		];
		const after =
			input.after === null
				? []
				: [
						literal(input.after.group),
						castDate(literal(input.after.occurredAt)),
						castDate(literal(input.after.orderCreatedAt)),
						literal(input.after.orderKey),
						literal(input.after.id),
					];
		const seek = order.flatMap((expr, index) => {
			const value = after[index];
			if (value === undefined) {
				return [];
			}
			return [
				and(
					...order.slice(0, index).flatMap((earlier, earlierIndex) => {
						const previous = after[earlierIndex];
						return previous === undefined ? [] : [eq(earlier, previous)];
					}),
					gt(expr, value),
				),
			];
		});
		return {
			map: ({ rows }) => Result.succeed(rows),
			queries: {
				rows: selectedRows(event, {
					limit: consumptionPageSize,
					orderBy: order.map(ascending),
					where: and(
						own(event),
						eq(column(event, "entityId"), literal(input.entityId)),
						inArray(column(event, "eventSchemaSlug"), consumptionEventSlugs.map(literal)),
						...(seek.length === 0 ? [] : [or(...seek)]),
					),
					joins: [
						join("inner", entity, eq(column(entity, "id"), column(event, "entityId"))),
						join(
							"left",
							occurrence,
							and(
								own(occurrence),
								eq(column(occurrence, "eventSchemaSlug"), literal("completion-occurrence")),
								eq(property(occurrence, "entityId"), literal(input.entityId)),
								eq(property(occurrence, "sourceEventId"), column(event, "id")),
								eq(property(occurrence, "rule"), literal("progress")),
							),
						),
						join(
							"left",
							automatic,
							and(
								own(automatic),
								eq(column(automatic, "eventSchemaSlug"), literal("completion-occurrence")),
								eq(column(automatic, "id"), property(event, "completionKey")),
							),
						),
					],
					selection: {
						group: selectedField(group, Schema.String),
						id: selectedField(column(event, "id"), Schema.String),
						entityId: selectedField(column(event, "entityId"), Schema.String),
						orderKey: selectedField(column(event, "orderKey"), Schema.String),
						occurredAt: selectedField(column(event, "occurredAt"), Schema.String),
						orderCreatedAt: selectedField(column(event, "orderCreatedAt"), Schema.String),
						entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
						boundary: selectedField(
							column(occurrence, "properties"),
							Schema.NullOr(CompletionOccurrence),
						),
						automatic: selectedField(
							column(automatic, "properties"),
							Schema.NullOr(CompletionOccurrence),
						),
						properties: selectedField(
							column(event, "properties"),
							ConsumptionObservation.fields.properties,
						),
						eventSchemaSlug: selectedField(
							column(event, "eventSchemaSlug"),
							ConsumptionObservation.fields.eventSchemaSlug,
						),
					},
				}),
			},
		};
	},
);
