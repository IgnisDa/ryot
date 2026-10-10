import type { GenericImportWriteItem } from "@ryot-app/sandbox-sdk/imports";

import { measurementOperationId, measurementRecordId } from "./identity";
import type { OpenScaleNormalizedItem } from "./open-scale";

const openScaleUnits: Readonly<Record<string, string>> = {
	fat: "%",
	hip: "cm",
	lbm: "kg",
	bone: "kg",
	water: "%",
	muscle: "%",
	waist: "cm",
	bmi: "kg/m²",
	weight: "kg",
};

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
			properties: { value: statistic.value, ...(comment ? { comment } : {}) },
			...(index === 0 ? { outcome: { unit: "measurements", recordKind: "measurements" } } : {}),
		})),
		entities: statistics.map((statistic, index) => {
			const unit = openScaleUnits[statistic.key];
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
