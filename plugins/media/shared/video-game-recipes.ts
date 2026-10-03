import { Schema } from "@ryot-app/plugin-kit/effect";
import {
	ascending,
	column,
	conditional,
	eq,
	literal,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import {
	entitySyncSelection,
	propertyJson,
	propertyNumber,
	propertyText,
	type Table,
} from "./entity-selections";
import type { ScalarExpression } from "./lifecycle-expressions";
import { MediaImageListSchema } from "./media-image";
import {
	mediaFlatRecipes,
	mediaTimeSpentMeasure,
	relatedRows,
	type MediaFlatOverviewInput,
} from "./media-recipes";
import {
	PlatformReleaseListSchema,
	TimeToBeatValueSchema,
	videoGameRelationKinds,
} from "./video-game";

const DERIVATIVE_LIMIT = 60;

const relationKindPriority = (kind: ScalarExpression) =>
	videoGameRelationKinds.reduceRight<ScalarExpression>(
		(rest, name, index) => conditional(eq(kind, literal(name)), literal(index), rest),
		literal(videoGameRelationKinds.length),
	);

const relatedSelection = (entity: Table, edge: Table) => ({
	id: selectedField(column(entity, "id"), EntityId),
	name: selectedField(column(entity, "name"), Schema.String),
	images: selectedField(propertyJson(entity, "images"), MediaImageListSchema),
	kind: selectedField(propertyText(edge, "kind"), Schema.NullOr(Schema.String)),
	...entitySyncSelection(entity),
});

const videoGameRelatedOverviewQueries = (input: MediaFlatOverviewInput) => {
	const related = table("entity", "relatedVideoGame");
	const relationship = table("relationship", "videoGameRelationship");
	const rows = (
		relatedSide: "sourceEntityId" | "targetEntityId",
		limit: number,
		orderBy: ReturnType<typeof ascending>[],
	) =>
		selectedRows(relationship, {
			...relatedRows({
				limit,
				related,
				orderBy,
				relatedSide,
				relationship,
				entityId: input.entityId,
				relatedSchemaSlug: "video-game",
				relationshipSchemaSlug: "video-game-to-video-game",
			}),
			selection: relatedSelection(related, relationship),
		});
	return {
		originals: rows("sourceEntityId", input.recommendationLimit, [
			ascending(column(related, "name")),
			ascending(column(related, "id")),
		]),
		derivatives: rows("targetEntityId", DERIVATIVE_LIMIT, [
			ascending(relationKindPriority(propertyText(relationship, "kind"))),
			ascending(propertyNumber(related, "publishYear")),
			ascending(column(related, "name")),
			ascending(column(related, "id")),
		]),
	};
};

export const videoGameRecipes = mediaFlatRecipes({
	slug: "video-game",
	alias: "videoGame",
	groupSlug: "video-game-group",
	measure: mediaTimeSpentMeasure(),
	extraOverviewQueries: videoGameRelatedOverviewQueries,
	presentationFields: (entity) => ({
		timeToBeatNormally: selectedField(
			propertyNumber(entity, "timeToBeat", "normally"),
			Schema.NullOr(Schema.Finite),
		),
	}),
	summaryFields: (entity) => ({
		timeToBeat: selectedField(propertyJson(entity, "timeToBeat"), TimeToBeatValueSchema),
		gameType: selectedField(propertyText(entity, "gameType"), Schema.NullOr(Schema.String)),
		platformReleases: selectedField(
			propertyJson(entity, "platformReleases"),
			PlatformReleaseListSchema,
		),
	}),
});
