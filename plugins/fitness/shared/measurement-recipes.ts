import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	conditional,
	count,
	dateAdd,
	dateBucket,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	eventSchemaPredicate,
	first,
	groupAscending,
	gte,
	inArray,
	isNotNull,
	join,
	JsonValue,
	latestEventField,
	literal,
	lt,
	minimum,
	now,
	parameters,
	type Recipe,
	relationshipSchemaPredicate,
	reportingGroupingExpression,
	reportingParameterFields,
	reportingPeriodPredicate,
	reportingTimeZone,
	schemaOwnerPredicate,
	selectedAggregate,
	selectedField,
	selectedMeasure,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { type PluginIdentityReference, REPORTING_BUCKET_LIMIT } from "@ryot-app/plugin-kit/schema";

import { property, propertyNumber } from "./entity-selections";

const MEASUREMENT_SERIES_RESULT_LIMIT = 1000;
export const MEASUREMENT_SERIES_BATCH_SIZE = Math.floor(
	MEASUREMENT_SERIES_RESULT_LIMIT / REPORTING_BUCKET_LIMIT,
);
export const measurementPinRelationshipSchemaSlug = "measurement-metric-pinned";

const nullableString = Schema.NullOr(Schema.String);
export const measurementSummaryRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
	const inputParameters = parameters({ fields: reportingParameterFields });
	const metric = table("entity", "metric");
	const reading = table("event", "summaryReading");
	const pin = table("relationship", "summaryPin");
	const metricReadings = and(
		schemaOwnerPredicate(reading, "eventSchemaPluginId", input.reference),
		eq(column(reading, "entityId"), column(metric, "id")),
		eq(column(reading, "eventSchemaSlug"), literal("measurement-reading")),
	);
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ metrics }) => Result.succeed(metrics),
		queries: {
			metrics: selectedRows(metric, {
				limit: 100,
				where: entitySchemaPredicate(metric, "measurement-metric", input.reference),
				orderBy: [ascending(column(metric, "name")), ascending(column(metric, "id"))],
				selection: {
					id: selectedField(column(metric, "id"), Schema.String),
					name: selectedField(column(metric, "name"), Schema.String),
					key: selectedField(property(metric, "key"), nullableString),
					unit: selectedField(property(metric, "unit"), nullableString),
					firstAt: selectedField(
						minimum(reading, column(reading, "occurredAt"), { where: metricReadings }),
						nullableString,
					),
					latestAt: selectedField(
						latestEventField(reading, {
							where: metricReadings,
							select: column(reading, "occurredAt"),
						}),
						nullableString,
					),
					rangeCount: selectedField(
						count(reading, {
							where: and(metricReadings, reportingPeriodPredicate(column(reading, "occurredAt"))),
						}),
						Schema.Finite,
					),
					latestValue: selectedField(
						latestEventField(reading, {
							where: metricReadings,
							select: propertyNumber(reading, "value"),
						}),
						Schema.NullOr(Schema.Finite),
					),
					pinnedAt: selectedField(
						first(pin, {
							select: column(pin, "createdAt"),
							orderBy: [ascending(column(pin, "createdAt"))],
							where: and(
								eq(column(pin, "sourceEntityId"), column(metric, "id")),
								relationshipSchemaPredicate(
									pin,
									measurementPinRelationshipSchemaSlug,
									input.reference,
								),
							),
						}),
						nullableString,
					),
				},
			}),
		},
	});
};
const seriesParameters = parameters({
	fields: {
		...reportingParameterFields,
		firstAt: {
			type: "datetime",
			label: "First reading",
			description:
				"Earliest recorded reading in the selected metrics; omit when they have no readings",
		},
		metricIds: {
			type: "array",
			label: "Metrics",
			description: "Measurement metrics whose bucket averages to read",
			validation: { required: true, maxItems: MEASUREMENT_SERIES_BATCH_SIZE },
			items: { type: "string", label: "Metric", description: "Measurement metric ID" },
		},
	},
});
export const measurementSeriesRecipe = (input: { readonly reference: PluginIdentityReference }) => {
	const reading = table("event", "seriesReading");
	const metric = table("entity", "seriesMetric");
	const group = (at: Parameters<typeof dateBucket>[0]) => {
		const groupBucket = (bucket: "day" | "week" | "year" | "month") =>
			dateBucket(at, { bucket, timeZone: reportingTimeZone });
		const allTime = conditional(
			seriesParameters.whenSet(
				"firstAt",
				gte(seriesParameters.value("firstAt"), dateAdd(now(), -REPORTING_BUCKET_LIMIT * 7, "day")),
			),
			groupBucket("week"),
			conditional(
				seriesParameters.whenSet(
					"firstAt",
					gte(
						seriesParameters.value("firstAt"),
						dateAdd(now(), -REPORTING_BUCKET_LIMIT * 28, "day"),
					),
				),
				groupBucket("month"),
				groupBucket("year"),
			),
		);
		const selected = reportingGroupingExpression((bucket) =>
			dateBucket(at, { bucket, timeZone: reportingTimeZone }),
		);
		return conditional(
			eq(seriesParameters.value("consistency"), literal(true)),
			groupBucket("day"),
			conditional(eq(seriesParameters.value("range"), literal("all-time")), allTime, selected),
		);
	};
	return defineRecipe({
		parameters: seriesParameters.schema,
		map: ({ metrics, averages }) =>
			metrics.pageInfo.hasMore || averages.pageInfo.hasMore
				? Result.fail(new Error("Measurement series response is truncated"))
				: Result.succeed(
						metrics.items.map((selectedMetric) => ({
							metricId: selectedMetric.id,
							points: averages.items
								.filter((row) => row.metricId === selectedMetric.id)
								.map(({ at, value }) => ({ at, value })),
						})),
					),
		queries: {
			metrics: selectedRows(metric, {
				limit: MEASUREMENT_SERIES_BATCH_SIZE,
				orderBy: [ascending(column(metric, "id"))],
				selection: { id: selectedField(column(metric, "id"), Schema.String) },
				where: and(
					entitySchemaPredicate(metric, "measurement-metric", input.reference),
					inArray(column(metric, "id"), seriesParameters.list("metricIds")),
				),
			}),
			averages: selectedAggregate(reading, {
				limit: 1000,
				orderBy: [groupAscending("metricId"), groupAscending("at")],
				measures: {
					value: selectedMeasure(
						{ function: "average", expr: propertyNumber(reading, "value") },
						Schema.Finite,
					),
				},
				groupBy: {
					metricId: selectedField(column(reading, "entityId"), Schema.String),
					at: selectedField(group(column(reading, "occurredAt")), Schema.String),
				},
				where: and(
					schemaOwnerPredicate(reading, "eventSchemaPluginId", input.reference),
					eq(column(reading, "eventSchemaSlug"), literal("measurement-reading")),
					inArray(column(reading, "entityId"), seriesParameters.list("metricIds")),
					reportingPeriodPredicate(column(reading, "occurredAt")),
					seriesParameters.choice("range", {
						week: and(),
						year: and(),
						month: and(),
						custom: and(),
						rolling: and(),
						"all-time": lt(column(reading, "occurredAt"), now()),
					}),
				),
			}),
		},
	});
};
export type MeasurementSeries = Recipe.Success<ReturnType<typeof measurementSeriesRecipe>>[number];
export type MeasurementSummary = Recipe.Success<
	ReturnType<typeof measurementSummaryRecipe>
>["items"][number];
export const measurementEntryRecipe = (() => {
	const inputParameters = parameters({
		fields: {
			entryId: {
				type: "string",
				label: "Entry Id",
				validation: { required: true },
				description: "Entry Id for this selection",
			},
		},
	});
	const entry = table("entity", "entry");
	const reading = table("event", "reading");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ entry: found }) => Result.succeed(found ?? null),
		queries: {
			entry: selectedOptionalRow(entry, {
				orderBy: [ascending(column(entry, "id"))],
				where: and(
					eq(column(entry, "id"), inputParameters.value("entryId")),
					isNotNull(column(entry, "userId")),
					entitySchemaPredicate(entry, "measurement-entry", { kind: "self" }),
				),
				selection: {
					id: selectedField(column(entry, "id"), Schema.String),
					name: selectedField(column(entry, "name"), Schema.String),
					updatedAt: selectedField(column(entry, "updatedAt"), Schema.String),
					properties: selectedField(
						column(entry, "properties"),
						Schema.Record(Schema.String, JsonValue),
					),
					readingCount: selectedField(
						count(reading, {
							where: and(
								eq(column(reading, "sessionEntityId"), column(entry, "id")),
								schemaOwnerPredicate(reading, "eventSchemaPluginId", { kind: "self" }),
								eq(column(reading, "eventSchemaSlug"), literal("measurement-reading")),
							),
						}),
						Schema.Int,
					),
				},
			}),
		},
	});
})();
export const measurementEntryReadingsRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
	const inputParameters = parameters({
		fields: {
			entryId: {
				type: "string",
				label: "Entry Id",
				validation: { required: true },
				description: "Entry Id for this selection",
			},
		},
	});
	const reading = table("event", "reading");
	const metric = table("entity", "metric");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ readings }) => Result.succeed(readings),
		queries: {
			readings: selectedRows(reading, {
				limit: 100,
				orderBy: [ascending(column(reading, "id"))],
				joins: [join("inner", metric, eq(column(reading, "entityId"), column(metric, "id")))],
				selection: {
					id: selectedField(column(reading, "id"), Schema.String),
					metricId: selectedField(column(metric, "id"), Schema.String),
					value: selectedField(propertyNumber(reading, "value"), Schema.Finite),
				},
				where: and(
					eq(column(reading, "sessionEntityId"), inputParameters.value("entryId")),
					eventSchemaPredicate(
						reading,
						metric,
						"measurement-metric",
						"measurement-reading",
						input.reference,
					),
				),
			}),
		},
	});
};
export const measurementMetricIdsRecipe = (() => {
	const inputParameters = parameters({
		fields: {
			metricIds: {
				type: "array",
				label: "metricIds",
				validation: { required: true },
				description: "metricIds for this selection",
				items: { label: "ID", type: "string", description: "Selected ID" },
			},
		},
	});
	const metric = table("entity", "metric");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ metrics }) => Result.succeed(metrics.items.map(({ id }) => id)),
		queries: {
			metrics: selectedRows(metric, {
				limit: 100,
				orderBy: [ascending(column(metric, "id"))],
				selection: { id: selectedField(column(metric, "id"), Schema.String) },
				where: and(
					inArray(column(metric, "id"), inputParameters.list("metricIds")),
					entitySchemaPredicate(metric, "measurement-metric", { kind: "self" }),
				),
			}),
		},
	});
})();
export const measurementPageReadingsRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
	const inputParameters = parameters({
		fields: {
			entryIds: {
				type: "array",
				label: "Entry Ids",
				validation: { required: true },
				description: "Entry Ids for this selection",
				items: { type: "string", label: "Value", description: "Selection value" },
			},
		},
	});
	const reading = table("event", "reading");
	const metric = table("entity", "metric");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ readings }) => Result.succeed(readings),
		queries: {
			readings: selectedRows(reading, {
				limit: 100,
				orderBy: [ascending(column(reading, "id"))],
				joins: [join("inner", metric, eq(column(reading, "entityId"), column(metric, "id")))],
				where: and(
					inArray(column(reading, "sessionEntityId"), inputParameters.list("entryIds")),
					eventSchemaPredicate(
						reading,
						metric,
						"measurement-metric",
						"measurement-reading",
						input.reference,
					),
				),
				selection: {
					id: selectedField(column(reading, "id"), Schema.String),
					metricId: selectedField(column(metric, "id"), Schema.String),
					value: selectedField(propertyNumber(reading, "value"), Schema.Finite),
					entryId: selectedField(column(reading, "sessionEntityId"), Schema.String),
				},
			}),
		},
	});
};
export type MeasurementEntryReading = Recipe.Success<
	ReturnType<typeof measurementPageReadingsRecipe>
>["items"][number];
export const pinnedMeasurementMetricIdsRecipe = (() => {
	const pin = table("relationship", "pin");
	return defineRecipe({
		map: ({ pins }) => Result.succeed(pins.items.map(({ metricId }) => metricId)),
		queries: {
			pins: selectedRows(pin, {
				limit: 100,
				orderBy: [ascending(column(pin, "id"))],
				selection: { metricId: selectedField(column(pin, "sourceEntityId"), Schema.String) },
				where: relationshipSchemaPredicate(pin, measurementPinRelationshipSchemaSlug, {
					kind: "self",
				}),
			}),
		},
	});
})();
export const allMeasurementMetricIdsRecipe = (() => {
	const inputParameters = parameters({ fields: {} });
	const metric = table("entity", "metric");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ metrics }) => Result.succeed(metrics.items.map(({ id }) => id)),
		queries: {
			metrics: selectedRows(metric, {
				limit: 100,
				orderBy: [ascending(column(metric, "id"))],
				selection: { id: selectedField(column(metric, "id"), Schema.String) },
				where: entitySchemaPredicate(metric, "measurement-metric", { kind: "self" }),
			}),
		},
	});
})();
