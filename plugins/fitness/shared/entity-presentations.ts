import type { Result } from "@ryot-app/plugin-kit/effect";
import { Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	castDate,
	castText,
	column,
	eq,
	jsonPath,
	latestEventField,
	literal,
	NullableNumber,
	selectedField,
	selectedRowsSource,
	table,
	titleCase,
} from "@ryot-app/plugin-kit/ryotql";
import { LocalAssetLocator, RemoteAssetLocator, S3AssetLocator } from "@ryot-app/plugin-kit/schema";

import { propertyNumber } from "./entity-selections";

type Table = Parameters<typeof column>[0];

const AssetLocator = Schema.Union([LocalAssetLocator, RemoteAssetLocator, S3AssetLocator]);

const latestMetricReading = (
	metric: Table,
	select: (reading: Table) => Parameters<typeof latestEventField>[1]["select"],
) => {
	const reading = table("event", "presentationReading");
	return latestEventField(reading, {
		select: select(reading),
		where: and(
			eq(column(reading, "entityId"), column(metric, "id")),
			eq(column(reading, "eventSchemaPluginId"), column(metric, "entitySchemaPluginId")),
			eq(column(reading, "eventSchemaSlug"), literal("measurement-reading")),
		),
	});
};

const presentationPrimary = (slug: string, entity: Table) => {
	if (slug === "exercise") {
		return titleCase(jsonPath(column(entity, "properties"), "kind"));
	}
	if (slug === "measurement-metric") {
		return castText(jsonPath(column(entity, "properties"), "unit"));
	}
	return castDate(column(entity, "createdAt"));
};

const fitnessSelection = (slug: string) => {
	const entity = table("entity", "entity");
	const property = (key: string) => jsonPath(column(entity, "properties"), key);
	const isExercise = slug === "exercise";
	const isMetric = slug === "measurement-metric";
	const primary = presentationPrimary(slug, entity);
	return {
		presentationId: selectedField(column(entity, "id"), Schema.String),
		presentationName: selectedField(column(entity, "name"), Schema.String),
		presentationPrimary: selectedField(primary, Schema.NullOr(Schema.String)),
		presentationCallout: selectedField(
			isExercise ? titleCase(property("level")) : literal(null),
			Schema.NullOr(Schema.String),
		),
		presentationSecondary: selectedField(
			isExercise || isMetric ? literal(null) : castText(property("comment")),
			Schema.NullOr(Schema.String),
		),
		presentationImage: selectedField(
			isExercise ? jsonPath(column(entity, "properties"), "images", 0) : literal(null),
			Schema.NullOr(AssetLocator),
		),
		presentationLatestValue: selectedField(
			isMetric
				? latestMetricReading(entity, (reading) => propertyNumber(reading, "value"))
				: literal(null),
			NullableNumber,
		),
		presentationLatestAt: selectedField(
			isMetric
				? latestMetricReading(entity, (reading) => column(reading, "occurredAt"))
				: literal(null),
			Schema.NullOr(Schema.String),
		),
	};
};

export const fitnessPresentationSource = (slug: string) =>
	selectedRowsSource(table("entity", "entity"), { selection: fitnessSelection(slug) });
export const fitnessEntityPresentationSource = (slug: string) => {
	const {
		presentationLatestAt: _at,
		presentationLatestValue: _value,
		...selection
	} = fitnessSelection(slug);
	return selectedRowsSource(table("entity", "entity"), { selection });
};

export type FitnessPresentationSourceData = Result.Result.Success<
	ReturnType<ReturnType<typeof fitnessPresentationSource>["decode"]>
>;

export type FitnessEntityPresentationData = Result.Result.Success<
	ReturnType<ReturnType<typeof fitnessEntityPresentationSource>["decode"]>
>;
