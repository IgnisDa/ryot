import type { PluginCalendarSource } from "@ryot-app/contract/modules/plugins/manifest";
import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/authored";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	and,
	castDate,
	castNumber,
	coalesce,
	column,
	conditional,
	entitySchemaPredicate,
	eq,
	field,
	gte,
	inArray,
	isNull,
	join,
	jsonElementsJoin,
	jsonPath,
	literal,
	neq,
	or,
	schemaOwnerPredicate,
	table,
} from "@ryot-app/ryotql";

import { preferredMediaImageExpression } from "../shared/entity-presentations";
import { libraryLinkExists } from "../shared/entity-selections";
import {
	episodeDisplayStateExpression,
	episodicEpisodeQuery,
	mediaLifecycleExpressions,
	occursAt,
	podcastEpisodicKindConfig,
	publishDate,
	showEpisodicKindConfig,
} from "../shared/lifecycle-expressions";
import { latestPosition } from "../shared/lifecycle-list-recipes";
import { flatMediaSchemaSlugs } from "../shared/media-schema-slugs";
import { catalogMessage, catalogRowText } from "../shared/messages.generated";

export const self = { kind: "self" } as const;

const asTrue = (predicate: Parameters<typeof conditional>[0]) =>
	conditional(predicate, literal(true), literal(false));

const nonEmpty = <Item>(items: readonly Item[]): [Item, ...Item[]] => {
	const [first, ...rest] = items;
	if (first === undefined) {
		throw new Error("Expected at least one item");
	}
	return [first, ...rest];
};

export const subjectOf = (entityAlias: string, slugs: readonly string[]) => ({
	entityAlias,
	schemas: nonEmpty(slugs.map((slug) => ({ owner: self, slug: EntitySchemaSlug.make(slug) }))),
});

export const episodeSource = (
	config: typeof showEpisodicKindConfig | typeof podcastEpisodicKindConfig,
) => {
	const episode = table("entity", "episode");
	const parent = table("entity", config.parentSchemaSlug);
	const scope = episodicEpisodeQuery(config, parent, episode, "calendar", "any", "all");
	const episodeNumber = scope.position.at(-1);
	const seasonNumber = config.kind === "show" ? scope.position[0] : undefined;
	if (!episodeNumber || (config.kind === "show" && !seasonNumber)) {
		throw new Error("Episodes are positioned by season and episode number");
	}
	return {
		parent,
		episode,
		seasonNumber,
		episodeNumber,
		parentJoins: scope.parentJoins,
		state: episodeDisplayStateExpression(episode, parent, "calendarEpisodeState"),
		query: {
			from: episode,
			joins: nonEmpty([
				...scope.joins,
				join("inner", parent, eq(scope.parentId, column(parent, "id"))),
			]),
			where: and(
				scope.where,
				entitySchemaPredicate(parent, config.parentSchemaSlug, self),
				libraryLinkExists(parent, `calendar${config.kind}Library`, "in-media-library"),
			),
		},
	};
};

const episodeFields = (source: ReturnType<typeof episodeSource>) => [
	field("startAt", occursAt(source.episode)),
	field("episode", source.episodeNumber),
	...(source.seasonNumber ? [field("season", source.seasonNumber)] : []),
	field(
		"art",
		coalesce(
			preferredMediaImageExpression(source.episode),
			preferredMediaImageExpression(source.parent),
		),
	),
	field("done", asTrue(eq(source.state, literal("complete")))),
];

const showEpisodes = () => {
	const source = episodeSource(showEpisodicKindConfig);
	return {
		art: "art",
		done: "done",
		precision: "date",
		startAt: "startAt",
		icon: "monitor-play",
		slug: "show-episodes",
		subject: subjectOf("show", ["show"]),
		name: catalogMessage("calendar-source.show-episodes.name"),
		query: { ...source.query, output: { type: "rows", fields: episodeFields(source) } },
		caption: catalogRowText("calendar-source.show-episodes.caption", {
			season: "season",
			episode: "episode",
		}),
	} satisfies PluginCalendarSource;
};

const podcastEpisodes = () => {
	const source = episodeSource(podcastEpisodicKindConfig);
	return {
		art: "art",
		done: "done",
		icon: "podcast",
		precision: "date",
		startAt: "startAt",
		slug: "podcast-episodes",
		subject: subjectOf("podcast", ["podcast"]),
		name: catalogMessage("calendar-source.podcast-episodes.name"),
		query: { ...source.query, output: { type: "rows", fields: episodeFields(source) } },
		caption: catalogRowText("calendar-source.podcast-episodes.caption", { episode: "episode" }),
	} satisfies PluginCalendarSource;
};

export const animeAiringSource = () => {
	const anime = table("entity", "anime");
	const element = jsonElementsJoin(
		"inner",
		"element",
		jsonPath(column(anime, "properties"), "airingSchedule"),
	);
	const airingAt = castDate(jsonPath(column(element, "value"), "airingAt"));
	const releaseDate = publishDate(anime);
	return {
		anime,
		element,
		airingAt,
		episodeNumber: castNumber(jsonPath(column(element, "value"), "episode")),
		where: and(
			entitySchemaPredicate(anime, "anime", self),
			libraryLinkExists(anime, "calendarAnimeLibrary", "in-media-library"),
			or(isNull(releaseDate), neq(airingAt, releaseDate)),
		),
	};
};

const animeAirings = () => {
	const { anime, where, element, airingAt, episodeNumber } = animeAiringSource();
	const lifecycle = mediaLifecycleExpressions(anime, "calendarAnimeLifecycle");
	return {
		icon: "tv",
		art: "art",
		done: "done",
		startAt: "startAt",
		precision: "instant",
		slug: "anime-airings",
		subject: subjectOf("anime", ["anime"]),
		name: catalogMessage("calendar-source.anime-airings.name"),
		caption: catalogRowText("calendar-source.anime-airings.caption", { episode: "episode" }),
		query: {
			where,
			from: anime,
			joins: [element],
			output: {
				type: "rows",
				fields: [
					field("startAt", airingAt),
					field("episode", episodeNumber),
					field("art", preferredMediaImageExpression(anime)),
					field(
						"done",
						asTrue(
							or(
								eq(lifecycle.state, literal("complete")),
								gte(latestPosition(anime), episodeNumber),
							),
						),
					),
				],
			},
		},
	} satisfies PluginCalendarSource;
};

export const flatReleaseSource = () => {
	const entity = table("entity", "entity");
	return {
		entity,
		where: and(
			schemaOwnerPredicate(entity, "entitySchemaPluginId", self),
			inArray(
				column(entity, "entitySchemaSlug"),
				flatMediaSchemaSlugs.map((slug) => literal(slug)),
			),
			libraryLinkExists(entity, "calendarReleaseLibrary", "in-media-library"),
		),
	};
};

const releases = () => {
	const { where, entity } = flatReleaseSource();
	const lifecycle = mediaLifecycleExpressions(entity, "calendarReleaseLifecycle");
	const kind = flatMediaSchemaSlugs.reduceRight<ScalarExpression>(
		(otherwise, slug) =>
			conditional(
				eq(column(entity, "entitySchemaSlug"), literal(slug)),
				literal(slug.replaceAll("-", "_")),
				otherwise,
			),
		literal(null),
	);
	return {
		art: "art",
		done: "done",
		icon: "calendar",
		slug: "releases",
		precision: "date",
		startAt: "startAt",
		subject: subjectOf("entity", flatMediaSchemaSlugs),
		name: catalogMessage("calendar-source.releases.name"),
		caption: catalogRowText("calendar-source.releases.caption", { kind: "kind" }),
		query: {
			where,
			from: entity,
			output: {
				type: "rows",
				fields: [
					field("startAt", occursAt(entity)),
					field("kind", kind),
					field("art", preferredMediaImageExpression(entity)),
					field("done", asTrue(eq(lifecycle.state, literal("complete")))),
				],
			},
		},
	} satisfies PluginCalendarSource;
};

export const mediaCalendarSources = () => [
	showEpisodes(),
	podcastEpisodes(),
	animeAirings(),
	releases(),
];
