import type { GenericImportWriteItem } from "@ryot-app/sandbox-sdk/imports";

import { measurementMetricUnit } from "../../shared/measurement-metrics";
import { measurementReadingProperties } from "../../shared/measurement-reading-operations";
import { measurementOperationId, measurementRecordId } from "./identity";
import type { OpenScaleNormalizedItem } from "./open-scale";

export const toMeasurementWriteItem = (
	measurement: OpenScaleNormalizedItem,
): GenericImportWriteItem => {
	const operationId = (...parts: Array<string | number>) =>
		measurementOperationId(measurement.itemIndex, ...parts);
	const { comment, recordedAt, statistics } = measurement.properties;
	const attribution = {
		sourceLabel: measurement.sourceLabel,
		sourceIdentifier: measurement.sourceIdentifier,
		recordId: measurementRecordId(measurement.itemIndex),
	};
	return {
		relationships: [],
		subjectEntityAlias: "metric-0",
		itemIndex: measurement.itemIndex,
		sourceLabel: measurement.sourceLabel,
		sourceIdentifier: measurement.sourceIdentifier,
		recordId: measurementRecordId(measurement.itemIndex),
		events: statistics.map((statistic, index) => ({
			attribution,
			occurredAt: recordedAt,
			entityAlias: `metric-${index}`,
			eventSchemaSlug: "measurement-reading",
			operationId: operationId("reading", index),
			properties: measurementReadingProperties(statistic.value, comment),
			...(index === 0 ? { outcome: { unit: "measurements", recordKind: "measurements" } } : {}),
		})),
		entities: statistics.map((statistic, index) => {
			const unit = measurementMetricUnit(statistic.key);
			return {
				name: statistic.label,
				scope: "user" as const,
				alias: `metric-${index}`,
				entitySchemaSlug: "measurement-metric",
				operationId: operationId("metric", index),
				properties: { key: statistic.key, ...(unit === undefined ? {} : { unit }) },
				match: {
					name: statistic.label,
					nameNormalization: "slug" as const,
					properties: { key: statistic.key },
				},
			};
		}),
	};
};
