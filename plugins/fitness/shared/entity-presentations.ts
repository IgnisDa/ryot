import type { Result } from "@ryot-app/plugin-kit/effect";
import { Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	castDate,
	castText,
	column,
	eq,
	inArray,
	jsonPath,
	latestEventField,
	literal,
	schemaOwnerPredicate,
	selectedField,
	selectedRowsSource,
	type SelectedSelection,
	table,
	titleCase,
} from "@ryot-app/plugin-kit/ryotql";
import { LocalAssetLocator, RemoteAssetLocator, S3AssetLocator } from "@ryot-app/plugin-kit/schema";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import { propertyNumber } from "./entity-selections";

type Table = ReturnType<typeof table>;

const selectedPresentationSource = <const Selection extends SelectedSelection>(input: {
	readonly table: Table;
	readonly selection: Selection;
	readonly where: (entityIds: readonly string[]) => ReturnType<typeof and>;
}) => {
	const source = selectedRowsSource(input.table, { selection: input.selection });
	return {
		...source,
		query: (reference: PluginIdentityReference, entityIds: readonly string[]) =>
			source.query({
				limit: 100,
				where: and(
					input.where(entityIds),
					schemaOwnerPredicate(input.table, "entitySchemaPluginId", reference),
				),
			}),
	};
};

const entityIdsWhere = (entity: Table, slug: string, entityIds: readonly string[]) =>
	and(
		eq(column(entity, "entitySchemaSlug"), literal(slug)),
		inArray(
			column(entity, "id"),
			entityIds.map((entityId) => literal(entityId)),
		),
	);

const AssetLocator = Schema.Union([LocalAssetLocator, RemoteAssetLocator, S3AssetLocator]);
const nullableNumber = Schema.NullOr(Schema.Finite);

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

export const fitnessPresentationSource = (slug: string) => {
	const entity = table("entity", "entity");
	const property = (key: string) => jsonPath(column(entity, "properties"), key);
	const isExercise = slug === "exercise";
	const isMetric = slug === "measurement-metric";
	const primary = presentationPrimary(slug, entity);
	return selectedPresentationSource({
		table: entity,
		where: (entityIds) => entityIdsWhere(entity, slug, entityIds),
		selection: {
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
				nullableNumber,
			),
			presentationLatestAt: selectedField(
				isMetric
					? latestMetricReading(entity, (reading) => column(reading, "occurredAt"))
					: literal(null),
				Schema.NullOr(Schema.String),
			),
		},
	});
};

export type FitnessPresentationSourceData = Result.Result.Success<
	ReturnType<ReturnType<typeof fitnessPresentationSource>["decode"]>
>;
