import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	column,
	count,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	inArray,
	join,
	literal,
	maximum,
	parameters,
	relationshipSchemaPredicate,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId, type PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import {
	entityId,
	entityIdentitySelection,
	propertyJson,
	propertyNumber,
	propertyText,
	type Table,
} from "./entity-selections";
import {
	episodicCoverageSelection,
	episodicEpisodeMembership,
	episodicEpisodeSelection,
	episodicEpisodesRecipe,
	episodicScopedCoverageSelection,
	mediaEpisodicRecipes,
} from "./episodic-recipes";
import {
	entitySchemaIs,
	relationshipConnects,
	sameSchemaOwner,
	type ScalarExpression,
	showEpisodicKindConfig,
} from "./lifecycle-expressions";
import { MediaImageListSchema } from "./media-image";
import {
	creditCharacterSelection,
	mediaEpisodeCreditsRecipe,
	mediaPeopleRecipe,
	mediaWatchProviderSelection,
} from "./media-recipes";
import { ShowEpisodeOrderListSchema } from "./show-episode-order";

const SHOW_SEASON_RELATIONSHIP = "show-to-show-season";

const SHOW_EPISODE_RELATIONSHIP = "show-season-to-show-episode";

const showSeasonNumber = (entity: Table) => ({
	seasonNumber: selectedField(propertyNumber(entity, "seasonNumber"), Schema.Finite),
});

const showSeasonScope = (show: Table) => {
	const season = table("entity", "presentationSeason");
	const relationship = table("relationship", "presentationShowSeason");
	return {
		season,
		joins: [
			join("inner", relationship, eq(column(relationship, "targetEntityId"), column(season, "id"))),
		],
		where: and(
			entitySchemaIs(season, "show-season"),
			sameSchemaOwner(season, "entitySchemaPluginId", show),
			sameSchemaOwner(relationship, "relationshipSchemaPluginId", show),
			eq(column(relationship, "sourceEntityId"), column(show, "id")),
			eq(column(relationship, "relationshipSchemaSlug"), literal("show-to-show-season")),
		),
	};
};

const showSeasonCount = (show: Table) => {
	const scope = showSeasonScope(show);
	return count(scope.season, scope);
};

const showSeasonMetadata = (show: Table) => {
	const scope = showSeasonScope(show);
	return {
		seasonTotal: selectedField(count(scope.season, scope), Schema.Finite),
		lastSeasonNumber: selectedField(
			maximum(scope.season, propertyNumber(scope.season, "seasonNumber"), scope),
			Schema.NullOr(Schema.Finite),
		),
	};
};

const showSeasonCoverageQuery = (input: {
	readonly limit: number;
	readonly entityId: ScalarExpression;
	readonly reference: PluginIdentityReference;
}) => {
	const season = table("entity", "coverageSeason");
	const show = table("entity", "coverageShow");
	const showSeason = table("relationship", "coverageShowSeason");
	return selectedRows(season, {
		limit: input.limit,
		orderBy: [ascending(propertyNumber(season, "seasonNumber")), ascending(column(season, "id"))],
		joins: [
			join("inner", showSeason, eq(column(showSeason, "targetEntityId"), column(season, "id"))),
			join("inner", show, eq(column(show, "id"), column(showSeason, "sourceEntityId"))),
		],
		where: and(
			entitySchemaPredicate(season, "show-season", input.reference),
			eq(column(showSeason, "sourceEntityId"), input.entityId),
			relationshipSchemaPredicate(showSeason, "show-to-show-season", input.reference),
		),
		selection: {
			id: selectedField(column(season, "id"), EntityId),
			...showSeasonNumber(season),
			...episodicCoverageSelection({
				parent: show,
				container: season,
				alias: "seasonCoverage",
				episodeSchemaSlug: "show-episode",
				relationshipSlug: SHOW_EPISODE_RELATIONSHIP,
			}),
		},
	});
};

export const showRecipes = mediaEpisodicRecipes({
	slug: "show",
	alias: "show",
	config: showEpisodicKindConfig,
	episodeFields: showSeasonNumber,
	extraOverviewQueries: () => ({}),
	orderProperties: ["seasonNumber"],
	coverageQuery: showSeasonCoverageQuery,
	presentationFields: (entity) => ({
		storedSeasons: selectedField(showSeasonCount(entity), Schema.Finite),
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
			Schema.NullOr(Schema.Finite),
		),
	}),
});

export const showEpisodeCreditRecipes = {
	overviewRecipe: mediaEpisodeCreditsRecipe({ slug: "show-episode" }),
	peopleRecipe: mediaPeopleRecipe({ slug: "show-episode", personFields: creditCharacterSelection }),
};

export const showSeasonEpisodesRecipe = episodicEpisodesRecipe({
	order: "asc",
	alias: "showEpisode",
	extraFields: showSeasonNumber,
	episodeSchemaSlug: "show-episode",
	relationshipSlug: SHOW_EPISODE_RELATIONSHIP,
	parentRelationshipSlug: SHOW_SEASON_RELATIONSHIP,
});

const showSeasonRows = (input: {
	readonly seasonLimit: number;
	readonly entityId: ScalarExpression;
	readonly after?: string | undefined;
	readonly reference: PluginIdentityReference;
}) => {
	const show = table("entity", "seasonShow");
	const season = table("entity", "season");
	const seasonNumber = propertyNumber(season, "seasonNumber");
	const seasonRelationship = table("relationship", "seasonRelationship");

	return selectedRows(season, {
		limit: input.seasonLimit,
		orderBy: [ascending(seasonNumber), ascending(column(season, "id"))],
		where: and(
			entitySchemaPredicate(season, "show-season", input.reference),
			relationshipConnects(seasonRelationship, show, season, SHOW_SEASON_RELATIONSHIP),
		),
		joins: [
			join("inner", show, entityId(show, input.entityId)),
			join(
				"inner",
				seasonRelationship,
				eq(column(seasonRelationship, "targetEntityId"), column(season, "id")),
			),
		],
		selection: {
			...entityIdentitySelection(season),
			seasonNumber: selectedField(seasonNumber, Schema.Finite),
			images: selectedField(propertyJson(season, "images"), MediaImageListSchema),
			releaseDate: selectedField(propertyText(season, "releaseDate"), Schema.NullOr(Schema.String)),
			description: selectedField(propertyText(season, "description"), Schema.NullOr(Schema.String)),
			...episodicCoverageSelection({
				parent: show,
				container: season,
				alias: "seasonEpisodes",
				episodeSchemaSlug: "show-episode",
				relationshipSlug: SHOW_EPISODE_RELATIONSHIP,
			}),
		},
	});
};
export const SHOW_SEASON_LIMIT = 40;

export const showSeasonsRecipe = (structural: { readonly reference: PluginIdentityReference }) => {
	const args = parameters({
		fields: {
			entityId: {
				label: "Show",
				type: "string",
				description: "Show to read",
				validation: { required: true },
			},
		},
	});
	const input = {
		seasonLimit: SHOW_SEASON_LIMIT,
		reference: structural.reference,
		entityId: args.value("entityId"),
	};
	const entity = table("entity", "entity");
	return defineRecipe({
		parameters: args.schema,
		map: ({ show, seasons }) => Result.succeed(show === undefined ? null : { ...show, seasons }),
		queries: {
			seasons: showSeasonRows(input),
			show: selectedOptionalRow(entity, {
				orderBy: [ascending(column(entity, "id"))],
				where: and(
					entitySchemaPredicate(entity, "show", input.reference),
					entityId(entity, input.entityId),
				),
				selection: {
					...entityIdentitySelection(entity),
					...showSeasonMetadata(entity),
					episodeOrders: selectedField(
						propertyJson(entity, "episodeOrders"),
						ShowEpisodeOrderListSchema,
					),
				},
			}),
		},
	});
};
/** Episodes of one show whose provider external id is among the requested ones. */
const showEpisodesByExternalId = (
	episode: Table,
	input: {
		readonly entityId: ScalarExpression;
		readonly reference: PluginIdentityReference;
		readonly externalIds: Parameters<typeof inArray>[1];
	},
	alias: string,
) =>
	and(
		entitySchemaPredicate(episode, "show-episode", input.reference),
		episodicEpisodeMembership(showEpisodicKindConfig, episode, input.entityId, alias),
		inArray(column(episode, "externalId"), input.externalIds),
	);

/**
 * One episode order group's episodes, selected like a season's episodes plus their external id.
 * Rows come back in season order; callers order them by their position in the group.
 */
export const showOrderEpisodesRecipe = (structural: {
	readonly reference: PluginIdentityReference;
}) => {
	const args = parameters({
		fields: {
			entityId: {
				label: "Show",
				type: "string",
				description: "Show to read",
				validation: { required: true },
			},
			externalIds: {
				type: "array",
				label: "Provider episodes",
				validation: { required: true },
				description: "Provider episodes to read",
				items: { label: "ID", type: "string", description: "Selected ID" },
			},
		},
	});
	const input = {
		reference: structural.reference,
		entityId: args.value("entityId"),
		externalIds: args.list("externalIds"),
	};
	const episode = table("entity", "orderEpisode");
	const show = table("entity", "orderEpisodeShow");
	return defineRecipe({
		parameters: args.schema,
		map: ({ episodes }) => Result.succeed(episodes.items),
		queries: {
			episodes: selectedRows(episode, {
				limit: 100,
				joins: [join("inner", show, entityId(show, input.entityId))],
				where: showEpisodesByExternalId(episode, input, "orderEpisodeMember"),
				orderBy: [
					ascending(propertyNumber(episode, "seasonNumber")),
					ascending(propertyNumber(episode, "episodeNumber")),
					ascending(column(episode, "id")),
				],
				selection: {
					...episodicEpisodeSelection(episode, show, "orderEpisodeState"),
					...showSeasonNumber(episode),
					externalId: selectedField(column(episode, "externalId"), Schema.String),
				},
			}),
		},
	});
};
/** A season header's coverage counts over one episode order group's episodes. */
export const showOrderGroupCoverageRecipe = (structural: {
	readonly reference: PluginIdentityReference;
}) => {
	const args = parameters({
		fields: {
			entityId: {
				label: "Show",
				type: "string",
				description: "Show to read",
				validation: { required: true },
			},
			externalIds: {
				type: "array",
				label: "Provider episodes",
				validation: { required: true },
				description: "Provider episodes to read",
				items: { label: "ID", type: "string", description: "Selected ID" },
			},
		},
	});
	const input = {
		reference: structural.reference,
		entityId: args.value("entityId"),
		externalIds: args.list("externalIds"),
	};
	const show = table("entity", "orderGroupShow");
	return defineRecipe({
		parameters: args.schema,
		map: ({ coverage }) => Result.succeed(coverage ?? null),
		queries: {
			coverage: selectedOptionalRow(show, {
				orderBy: [ascending(column(show, "id"))],
				where: and(
					entitySchemaPredicate(show, "show", input.reference),
					entityId(show, input.entityId),
				),
				selection: episodicScopedCoverageSelection({
					parent: show,
					alias: "orderGroupCoverage",
					scope: (episode) => ({
						joins: [],
						where: showEpisodesByExternalId(episode, input, "orderGroupMember"),
					}),
				}),
			}),
		},
	});
};
