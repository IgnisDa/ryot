import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	castNumber,
	column,
	count,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	exists,
	first,
	gt,
	gte,
	inArray,
	isNull,
	IsoDateString,
	jsonArrayCount,
	jsonArrayExists,
	jsonArrayFirst,
	jsonElement,
	jsonElementsJoin,
	jsonPath,
	literal,
	lt,
	lte,
	neq,
	or,
	schemaOwnerPredicate,
	selectedField,
	selectedInclude,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import {
	entityIdentitySelection,
	libraryLinkExists,
	propertyJson,
	propertyNumber,
	propertyText,
	type Table,
} from "./entity-selections";
import { libraryMembershipJoin, librarySummary } from "./library-summary";
import {
	episodeDisplayStateExpression,
	episodicEpisodeQuery,
	type EpisodicKindConfig,
	podcastEpisodicKindConfig,
	publishDate,
	type ScalarExpression,
	showEpisodicKindConfig,
} from "./lifecycle-expressions";
import { latestPosition } from "./lifecycle-list-recipes";
import { MediaImageListSchema } from "./media-image";
import { flatMediaSchemaSlugs } from "./media-schema-slugs";

type UpcomingInput = {
	readonly limit: number;
	readonly fromDate: string;
	readonly untilDate: string;
	readonly fromInstant: string;
	readonly onePerTitle: boolean;
	readonly untilInstant: string;
	readonly reference: PluginIdentityReference;
};

const upcomingEntitySelection = (entity: Table) => ({
	...entityIdentitySelection(entity),
	images: selectedField(propertyJson(entity, "images"), MediaImageListSchema),
});

const perTitle = (input: UpcomingInput) => (input.onePerTitle ? 1 : input.limit);

const inDateWindow = (date: ScalarExpression, input: UpcomingInput) =>
	and(gte(date, castDate(literal(input.fromDate))), lte(date, castDate(literal(input.untilDate))));

const followed = (entity: Table, alias: string) => {
	const library = libraryMembershipJoin(entity, `${alias}Library`);
	return {
		join: library.join,
		lifecycleState: librarySummary(library.membership).lifecycleState,
		monitored: libraryLinkExists(entity, `${alias}Monitoring`, "media-monitoring"),
	};
};

const windowEpisodes = (
	config: EpisodicKindConfig,
	parent: Table,
	alias: string,
	input: UpcomingInput,
) => {
	const episode = table("entity", alias);
	const scope = episodicEpisodeQuery(config, parent, episode, alias, "any");
	return {
		episode,
		joins: scope.joins,
		order: [
			ascending(publishDate(episode)),
			...scope.position.map((position) => ascending(position)),
			ascending(column(episode, "id")),
		] as const,
		where: and(
			scope.where,
			inDateWindow(publishDate(episode), input),
			neq(episodeDisplayStateExpression(episode, parent, `${alias}State`), literal("complete")),
		),
	};
};

const episodicTitles = (config: EpisodicKindConfig, input: UpcomingInput) => {
	const alias = `upcoming${config.kind}`;
	const parent = table("entity", alias);
	const follow = followed(parent, alias);
	const candidate = windowEpisodes(config, parent, `${alias}Candidate`, input);
	const soonest = windowEpisodes(config, parent, `${alias}Soonest`, input);
	const counted = windowEpisodes(config, parent, `${alias}Counted`, input);
	const listed = windowEpisodes(config, parent, `${alias}Listed`, input);
	return selectedRows(parent, {
		limit: input.limit,
		joins: [follow.join],
		selection: {
			...upcomingEntitySelection(parent),
			total: selectedField(
				count(counted.episode, { joins: counted.joins, where: counted.where }),
				Schema.Finite,
			),
		},
		orderBy: [
			ascending(
				first(soonest.episode, {
					joins: soonest.joins,
					where: soonest.where,
					orderBy: soonest.order,
					select: publishDate(soonest.episode),
				}),
			),
			ascending(column(parent, "id")),
		],
		where: and(
			entitySchemaPredicate(parent, config.parentSchemaSlug, input.reference),
			or(
				inArray(follow.lifecycleState, [literal("in_progress"), literal("caught_up")]),
				follow.monitored,
			),
			exists(candidate.episode, { joins: candidate.joins, where: candidate.where }),
		),
		include: {
			occurrences: selectedInclude(listed.episode, {
				joins: listed.joins,
				where: listed.where,
				limit: perTitle(input),
				orderBy: [...listed.order],
				selection: {
					id: selectedField(column(listed.episode, "id"), Schema.String),
					images: selectedField(propertyJson(listed.episode, "images"), MediaImageListSchema),
					publishDate: selectedField(propertyText(listed.episode, "publishDate"), Schema.String),
					episodeNumber: selectedField(
						propertyNumber(listed.episode, "episodeNumber"),
						Schema.Finite,
					),
					seasonNumber: selectedField(
						propertyNumber(listed.episode, "seasonNumber"),
						Schema.NullOr(Schema.Finite),
					),
				},
			}),
		},
	});
};

const airingSchedule = (entity: Table) => jsonPath(column(entity, "properties"), "airingSchedule");

/**
 * Scheduled episodes airing in the instant window after the latest watched episode. An entry at
 * UTC midnight of the premiere date is the provider's date-only premiere, which the release
 * source already lists.
 */
const animeWindow = (
	anime: Table,
	entry: ScalarExpression,
	airingAt: ScalarExpression,
	input: UpcomingInput,
) => {
	const watched = latestPosition(anime, "animeEpisode");
	const premiere = publishDate(anime);
	return and(
		or(isNull(watched), gt(castNumber(jsonPath(entry, "episode")), watched)),
		or(isNull(premiere), neq(airingAt, premiere)),
		gte(airingAt, castDate(literal(input.fromInstant))),
		lt(airingAt, castDate(literal(input.untilInstant))),
	);
};

const animeTitles = (input: UpcomingInput) => {
	const anime = table("entity", "upcomingAnime");
	const follow = followed(anime, "upcomingAnime");
	const entry = jsonElement();
	const airingAt = castDate(jsonPath(entry, "airingAt"));
	const inWindow = animeWindow(anime, entry, airingAt, input);
	const listed = table("entity", "upcomingAnimeListed");
	const element = jsonElementsJoin("inner", "upcomingAnimeElement", airingSchedule(listed));
	const listedEntry = column(element, "value");
	const listedAiringAt = castDate(jsonPath(listedEntry, "airingAt"));
	const listedEpisode = castNumber(jsonPath(listedEntry, "episode"));
	return selectedRows(anime, {
		limit: input.limit,
		joins: [follow.join],
		selection: {
			...upcomingEntitySelection(anime),
			total: selectedField(jsonArrayCount(airingSchedule(anime), inWindow), Schema.Finite),
		},
		where: and(
			entitySchemaPredicate(anime, "anime", input.reference),
			or(eq(follow.lifecycleState, literal("in_progress")), follow.monitored),
			jsonArrayExists(airingSchedule(anime), inWindow),
		),
		orderBy: [
			ascending(
				jsonArrayFirst(airingSchedule(anime), {
					where: inWindow,
					select: airingAt,
					orderBy: [ascending(airingAt), ascending(castNumber(jsonPath(entry, "episode")))],
				}),
			),
			ascending(column(anime, "id")),
		],
		include: {
			occurrences: selectedInclude(listed, {
				joins: [element],
				limit: perTitle(input),
				orderBy: [ascending(listedAiringAt), ascending(listedEpisode)],
				where: and(
					eq(column(listed, "id"), column(anime, "id")),
					animeWindow(listed, listedEntry, listedAiringAt, input),
				),
				selection: {
					airingAt: selectedField(listedAiringAt, IsoDateString),
					episodeNumber: selectedField(listedEpisode, Schema.Finite),
				},
			}),
		},
	});
};

const releaseTitles = (input: UpcomingInput) => {
	const entity = table("entity", "upcomingRelease");
	const follow = followed(entity, "upcomingRelease");
	const date = publishDate(entity);
	return selectedRows(entity, {
		limit: input.limit,
		joins: [follow.join],
		orderBy: [ascending(date), ascending(column(entity, "id"))],
		selection: {
			...upcomingEntitySelection(entity),
			publishDate: selectedField(propertyText(entity, "publishDate"), Schema.String),
		},
		where: and(
			schemaOwnerPredicate(entity, "entitySchemaPluginId", input.reference),
			inArray(
				column(entity, "entitySchemaSlug"),
				flatMediaSchemaSlugs.map((slug) => literal(slug)),
			),
			follow.monitored,
			or(isNull(follow.lifecycleState), neq(follow.lifecycleState, literal("complete"))),
			inDateWindow(date, input),
		),
	});
};

/**
 * Upcoming titles from show and podcast episodes, anime airings and monitored releases, each
 * source soonest first. Dates are the client's local `fromDate`..`untilDate`; anime airings are
 * instants in `fromInstant`..`untilInstant`. `total` counts a title's occurrences in the window and
 * `occurrences` lists the soonest, one per title when `onePerTitle`.
 */
export const upcomingRecipe = defineRecipe((input: UpcomingInput) => ({
	queries: {
		anime: animeTitles(input),
		releases: releaseTitles(input),
		shows: episodicTitles(showEpisodicKindConfig, input),
		podcasts: episodicTitles(podcastEpisodicKindConfig, input),
	},
	map: ({ anime, shows, podcasts, releases }) =>
		Result.succeed([
			...[...shows.items, ...podcasts.items].map(({ total, occurrences, ...entity }) => ({
				total,
				entity,
				occurrences: occurrences.items.map(({ id, images, publishDate: day, ...episode }) => ({
					images,
					episode,
					key: id,
					airsAt: day,
					dateOnly: true,
				})),
			})),
			...anime.items.map(({ total, occurrences, ...entity }) => ({
				total,
				entity,
				occurrences: occurrences.items.map(({ airingAt, episodeNumber }) => ({
					images: null,
					dateOnly: false,
					airsAt: airingAt,
					episode: { episodeNumber, seasonNumber: null },
					key: `${entity.id}:${episodeNumber}:${airingAt}`,
				})),
			})),
			...releases.items.map(({ publishDate: day, ...entity }) => ({
				entity,
				total: 1,
				occurrences: [{ airsAt: day, images: null, episode: null, dateOnly: true, key: entity.id }],
			})),
		]),
}));
