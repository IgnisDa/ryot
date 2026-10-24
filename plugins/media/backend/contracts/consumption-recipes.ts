import { Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	and,
	ascending,
	castDate,
	castText,
	coalesce,
	column,
	concat,
	conditional,
	defineRecipe,
	eq,
	exists,
	gt,
	inArray,
	isNotNull,
	join,
	jsonPath,
	literal,
	neq,
	not,
	or,
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";

import { ConsumptionObservation } from "../../shared/consumption-allocation";
import type { ConsumptionPosition } from "../../shared/consumption-projection";
import { consumptionEventSlugs } from "../../shared/consumption-projection";
import { CompletionOccurrence, HistoryCorrection } from "../../shared/history-correction";

export const consumptionPageRecipe = defineRecipe(
	(input: {
		entityId: string;
		after: null | ConsumptionPosition;
		dependenciesAfter?: string | undefined;
	}) => {
		const event = table("event", "consumptionSource");
		const entity = table("entity", "consumptionEntity");
		const occurrence = table("event", "consumptionBoundary");
		const automatic = table("event", "consumptionAutomatic");
		const scope = table("eventScope", "consumptionScope");
		const work = table("event", "consumptionCorrection");
		const dependency = table("event", "consumptionDependency");
		const parentWork = table("event", "consumptionParentCorrection");
		const parentScope = table("eventScope", "consumptionParentScope");
		const source = table("event", "consumptionDependencySource");
		const missing = table("event", "consumptionMissingDependency");
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
			map: ({ rows, context, correction, dependencies, scope: current }) =>
				Result.succeed({
					rows,
					context,
					correction,
					dependencies,
					revision: current?.revision ?? 0,
				}),
			queries: {
				scope: selectedOptionalRow(scope, {
					orderBy: [ascending(column(scope, "id"))],
					selection: { revision: selectedField(column(scope, "revision"), Schema.Int) },
					where: and(own(scope), eq(column(scope, "entityId"), literal(input.entityId))),
				}),
				correction: selectedOptionalRow(work, {
					orderBy: [ascending(column(work, "id"))],
					selection: { properties: selectedField(column(work, "properties"), HistoryCorrection) },
					where: and(
						own(work),
						eq(column(work, "eventSchemaSlug"), literal("history-correction")),
						eq(property(work, "subjectEntityId"), literal(input.entityId)),
					),
				}),
				context: selectedOptionalRow(entity, {
					orderBy: [ascending(column(entity, "id"))],
					where: eq(column(entity, "id"), literal(input.entityId)),
					selection: {
						dependenciesMissing: selectedField(
							exists(source, {
								where: and(
									own(source),
									eq(column(source, "entityId"), literal(input.entityId)),
									isNotNull(column(source, "sessionEntityId")),
									neq(column(source, "sessionEntityId"), literal(input.entityId)),
									not(
										exists(missing, {
											where: and(
												own(missing),
												eq(column(missing, "eventSchemaSlug"), literal("consumption-dependency")),
												eq(property(missing, "subjectEntityId"), literal(input.entityId)),
												eq(
													property(missing, "correctionSubjectEntityId"),
													column(source, "sessionEntityId"),
												),
											),
										}),
									),
								),
							}),
							Schema.Boolean,
						),
					},
				}),
				dependencies: selectedRows(dependency, {
					limit: 50,
					after: input.dependenciesAfter,
					orderBy: [ascending(column(dependency, "id"))],
					where: and(
						own(dependency),
						eq(column(dependency, "eventSchemaSlug"), literal("consumption-dependency")),
						eq(property(dependency, "subjectEntityId"), literal(input.entityId)),
					),
					selection: {
						revision: selectedField(
							coalesce(column(parentScope, "revision"), literal(0)),
							Schema.Int,
						),
						correction: selectedField(
							column(parentWork, "properties"),
							Schema.NullOr(HistoryCorrection),
						),
					},
					joins: [
						join(
							"left",
							parentScope,
							and(
								own(parentScope),
								eq(
									column(parentScope, "entityId"),
									property(dependency, "correctionSubjectEntityId"),
								),
							),
						),
						join(
							"left",
							parentWork,
							and(
								own(parentWork),
								eq(column(parentWork, "eventSchemaSlug"), literal("history-correction")),
								eq(
									property(parentWork, "subjectEntityId"),
									property(dependency, "correctionSubjectEntityId"),
								),
							),
						),
					],
				}),
				rows: selectedRows(event, {
					limit: 50,
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
