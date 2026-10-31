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

export const consumptionRoundSize = 100;

export const consumptionBatchRecipe = defineRecipe(
	(input: { streams: ReadonlyArray<{ entityId: string; after: null | ConsumptionPosition }> }) => {
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
		const seek = (after: ConsumptionPosition) => {
			const keys = [
				{ expr: group, value: literal(after.group) },
				{ expr: column(event, "occurredAt"), value: castDate(literal(after.occurredAt)) },
				{ expr: column(event, "orderCreatedAt"), value: castDate(literal(after.orderCreatedAt)) },
				{ value: literal(after.orderKey), expr: column(event, "orderKey") },
				{ value: literal(after.id), expr: column(event, "id") },
			];
			return or(
				...keys.map(({ expr, value }, index) =>
					and(...keys.slice(0, index).map((key) => eq(key.expr, key.value)), gt(expr, value)),
				),
			);
		};
		return {
			map: ({ rows }) => Result.succeed(rows),
			queries: {
				rows: selectedRows(event, {
					limit: consumptionRoundSize,
					orderBy: [column(event, "entityId"), ...order].map(ascending),
					where: and(
						own(event),
						inArray(column(event, "eventSchemaSlug"), consumptionEventSlugs.map(literal)),
						or(
							...input.streams.map(({ after, entityId }) =>
								and(
									eq(column(event, "entityId"), literal(entityId)),
									...(after === null ? [] : [seek(after)]),
								),
							),
						),
					),
					joins: [
						join("inner", entity, eq(column(entity, "id"), column(event, "entityId"))),
						join(
							"left",
							occurrence,
							and(
								own(occurrence),
								eq(column(occurrence, "eventSchemaSlug"), literal("completion-occurrence")),
								eq(property(occurrence, "entityId"), column(event, "entityId")),
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
