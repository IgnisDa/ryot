import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	count,
	defineRecipe,
	eq,
	join,
	literal,
	selectedField,
	selectedInclude,
	selectedOptionalRow,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import {
	entityId,
	entityIdentitySelection,
	entitySchema,
	propertyJson,
	propertyNumber,
	propertyText,
	relationshipTo,
	type Table,
} from "./entity-selections";
import {
	episodicCoverageSelection,
	episodicEpisodesRecipe,
	mediaEpisodicRecipes,
} from "./episodic-recipes";
import { showEpisodicKindConfig } from "./lifecycle-expressions";
import { MediaImageListSchema } from "./media-image";
import { mediaWatchProviderSelection } from "./media-recipes";

const SHOW_EPISODE_RELATIONSHIP = "show-season-to-show-episode";

const showSeasonNumber = (entity: Table) => ({
	seasonNumber: selectedField(propertyNumber(entity, "seasonNumber"), Schema.Number),
});

const showSeasonCount = (show: Table) => {
	const season = table("entity", "presentationSeason");
	const relationship = table("relationship", "presentationShowSeason");
	return count(season, {
		joins: [
			join("inner", relationship, eq(column(relationship, "targetEntityId"), column(season, "id"))),
		],
		where: and(
			entitySchema(season, "show-season"),
			eq(column(relationship, "sourceEntityId"), column(show, "id")),
			eq(column(relationship, "relationshipSchemaSlug"), literal("show-to-show-season")),
		),
	});
};

const showSeasonCoverageQuery = (input: { readonly limit: number; readonly entityId: string }) => {
	const season = table("entity", "coverageSeason");
	const showSeason = table("relationship", "coverageShowSeason");
	return selectedRows(season, {
		limit: input.limit,
		orderBy: [ascending(propertyNumber(season, "seasonNumber")), ascending(column(season, "id"))],
		joins: [
			join("inner", showSeason, eq(column(showSeason, "targetEntityId"), column(season, "id"))),
		],
		where: and(
			entitySchema(season, "show-season"),
			eq(column(showSeason, "sourceEntityId"), literal(input.entityId)),
			eq(column(showSeason, "relationshipSchemaSlug"), literal("show-to-show-season")),
		),
		selection: {
			id: selectedField(column(season, "id"), EntityId),
			...showSeasonNumber(season),
			...episodicCoverageSelection({
				container: season,
				alias: "seasonCoverage",
				episodeSchemaSlug: "show-episode",
				relationshipSlug: SHOW_EPISODE_RELATIONSHIP,
			}),
		},
	});
};

const showRecipes = mediaEpisodicRecipes({
	slug: "show",
	alias: "show",
	config: showEpisodicKindConfig,
	episodeFields: showSeasonNumber,
	orderProperties: ["seasonNumber"],
	coverageQuery: showSeasonCoverageQuery,
	presentationFields: (entity) => ({
		storedSeasons: selectedField(showSeasonCount(entity), Schema.Number),
	}),
	activityEpisode: (row) => ({
		id: row.episodeId,
		name: row.episodeName,
		runtime: row.episodeRuntime,
		seasonNumber: row.seasonNumber,
		episodeNumber: row.episodeNumber,
	}),
	summaryFields: (entity) => ({
		...mediaWatchProviderSelection(entity),
		totalSeasons: selectedField(
			propertyNumber(entity, "totalSeasons"),
			Schema.NullOr(Schema.Number),
		),
	}),
});

export const {
	summaryRecipe: showSummaryRecipe,
	overviewRecipe: showOverviewRecipe,
	activityRecipe: showActivityRecipe,
	presentationRecipe: showPresentationRecipe,
} = showRecipes;

export const showSeasonEpisodesRecipe = episodicEpisodesRecipe({
	order: "asc",
	alias: "showEpisode",
	extraFields: showSeasonNumber,
	episodeSchemaSlug: "show-episode",
	relationshipSlug: SHOW_EPISODE_RELATIONSHIP,
});

const showSeasonInclude = (seasonLimit: number) => {
	const season = table("entity", "season");
	const seasonNumber = propertyNumber(season, "seasonNumber");
	const seasonRelationship = table("relationship", "seasonRelationship");

	return selectedInclude(season, {
		limit: seasonLimit,
		orderBy: [ascending(seasonNumber)],
		joins: [
			join(
				"inner",
				seasonRelationship,
				eq(column(seasonRelationship, "targetEntityId"), column(season, "id")),
			),
		],
		where: and(
			entitySchema(season, "show-season"),
			relationshipTo(seasonRelationship, table("entity", "entity"), season, "show-to-show-season"),
		),
		selection: {
			...entityIdentitySelection(season),
			seasonNumber: selectedField(seasonNumber, Schema.Number),
			images: selectedField(propertyJson(season, "images"), MediaImageListSchema),
			releaseDate: selectedField(propertyText(season, "releaseDate"), Schema.NullOr(Schema.String)),
			description: selectedField(propertyText(season, "description"), Schema.NullOr(Schema.String)),
			...episodicCoverageSelection({
				container: season,
				alias: "seasonEpisodes",
				episodeSchemaSlug: "show-episode",
				relationshipSlug: SHOW_EPISODE_RELATIONSHIP,
			}),
		},
	});
};

export const showSeasonsRecipe = defineRecipe(
	(input: { readonly entityId: string; readonly seasonLimit: number }) => {
		const entity = table("entity", "entity");
		return {
			map: ({ show }) => Result.succeed(show ?? null),
			queries: {
				show: selectedOptionalRow(entity, {
					selection: entityIdentitySelection(entity),
					orderBy: [ascending(column(entity, "id"))],
					include: { seasons: showSeasonInclude(input.seasonLimit) },
					where: and(entitySchema(entity, "show"), entityId(entity, input.entityId)),
				}),
			},
		};
	},
);

export type ShowActivityEvent = ShowActivityResult["events"][number];
export type ShowSeasonsResult = Recipe.Success<typeof showSeasonsRecipe>;
export type ShowSummaryResult = Recipe.Success<typeof showSummaryRecipe>;
export type ShowActivityResult = Recipe.Success<typeof showActivityRecipe>;
export type ShowOverviewResult = Recipe.Success<typeof showOverviewRecipe>;
export type ShowSeasonEpisodesResult = Recipe.Success<typeof showSeasonEpisodesRecipe>;
export type ShowPresentationData = Recipe.Success<typeof showPresentationRecipe>[number];
export type ShowActivityEpisode = Extract<ShowActivityEvent, { kind: "episode" }>["episode"];
