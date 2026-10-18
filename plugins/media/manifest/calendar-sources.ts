import type { PluginCalendarSource } from "@ryot-app/contract/modules/plugins/manifest";
import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/language";
import { EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	castDate,
	castNumber,
	column,
	coalesce,
	concat,
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
	and,
} from "@ryot-app/ryotql";

import { preferredMediaImageExpression } from "../shared/entity-presentations";
import { libraryLinkExists, propertyText } from "../shared/entity-selections";
import {
	episodeDisplayStateExpression,
	episodicEpisodeQuery,
	mediaLifecycleExpressions,
	podcastEpisodicKindConfig,
	publishDate,
	showEpisodicKindConfig,
} from "../shared/lifecycle-expressions";
import { latestPosition } from "../shared/lifecycle-list-recipes";
import { flatMediaSchemaSlugs } from "../shared/media-schema-slugs";
import { mediaEntitySchemas } from "./schemas/entity";

const self = { kind: "self" } as const;

const asTrue = (predicate: Parameters<typeof conditional>[0]) =>
	conditional(predicate, literal(true), literal(false));

const nonEmpty = <Item>(items: readonly Item[]): [Item, ...Item[]] => {
	const [first, ...rest] = items;
	if (first === undefined) {
		throw new Error("Expected at least one item");
	}
	return [first, ...rest];
};

const subjectOf = (entityAlias: string, slugs: readonly string[]) => ({
	entityAlias,
	schemas: nonEmpty(slugs.map((slug) => ({ owner: self, slug: EntitySchemaSlug.make(slug) }))),
});

const episodeSource = (
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
		state: episodeDisplayStateExpression(episode, parent, "calendarEpisodeState"),
		caption: seasonNumber
			? concat(literal("S"), seasonNumber, literal(" · E"), episodeNumber)
			: concat(literal("Episode "), episodeNumber),
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
	field("startAt", publishDate(source.episode)),
	field("caption", source.caption),
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
		caption: "caption",
		icon: "monitor-play",
		slug: "show-episodes",
		name: "Show episodes",
		subject: subjectOf("show", ["show"]),
		query: { ...source.query, output: { type: "rows", fields: episodeFields(source) } },
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
		caption: "caption",
		slug: "podcast-episodes",
		name: "Podcast episodes",
		subject: subjectOf("podcast", ["podcast"]),
		query: { ...source.query, output: { type: "rows", fields: episodeFields(source) } },
	} satisfies PluginCalendarSource;
};

const animeAirings = () => {
	const anime = table("entity", "anime");
	const element = jsonElementsJoin(
		"inner",
		"element",
		jsonPath(column(anime, "properties"), "airingSchedule"),
	);
	const airingAt = castDate(jsonPath(column(element, "value"), "airingAt"));
	const episodeNumber = castNumber(jsonPath(column(element, "value"), "episode"));
	const releaseDate = castDate(propertyText(anime, "publishDate"));
	const lifecycle = mediaLifecycleExpressions(anime, "calendarAnimeLifecycle");
	return {
		icon: "tv",
		art: "art",
		done: "done",
		startAt: "startAt",
		caption: "caption",
		precision: "instant",
		slug: "anime-airings",
		name: "Anime airings",
		subject: subjectOf("anime", ["anime"]),
		query: {
			from: anime,
			joins: [element],
			where: and(
				entitySchemaPredicate(anime, "anime", self),
				libraryLinkExists(anime, "calendarAnimeLibrary", "in-media-library"),
				or(isNull(releaseDate), neq(airingAt, releaseDate)),
			),
			output: {
				type: "rows",
				fields: [
					field("startAt", airingAt),
					field("caption", concat(literal("Episode "), episodeNumber)),
					field("art", preferredMediaImageExpression(anime)),
					field(
						"done",
						asTrue(
							or(
								eq(lifecycle.state, literal("complete")),
								gte(latestPosition(anime, "animeEpisode"), episodeNumber),
							),
						),
					),
				],
			},
		},
	} satisfies PluginCalendarSource;
};

const releaseLabel = (slug: string) => {
	const schema = mediaEntitySchemas().find((candidate) => candidate.slug === slug);
	if (!schema) {
		throw new Error(`Missing media entity schema: ${slug}`);
	}
	return `${schema.name} release`;
};

const releases = () => {
	const entity = table("entity", "entity");
	const lifecycle = mediaLifecycleExpressions(entity, "calendarReleaseLifecycle");
	const caption = flatMediaSchemaSlugs.reduceRight<ScalarExpression>(
		(otherwise, slug) =>
			conditional(
				eq(column(entity, "entitySchemaSlug"), literal(slug)),
				literal(releaseLabel(slug)),
				otherwise,
			),
		literal(null),
	);
	return {
		art: "art",
		done: "done",
		icon: "calendar",
		slug: "releases",
		name: "Releases",
		precision: "date",
		startAt: "startAt",
		caption: "caption",
		subject: subjectOf("entity", flatMediaSchemaSlugs),
		query: {
			from: entity,
			where: and(
				schemaOwnerPredicate(entity, "entitySchemaPluginId", self),
				inArray(
					column(entity, "entitySchemaSlug"),
					flatMediaSchemaSlugs.map((slug) => literal(slug)),
				),
				libraryLinkExists(entity, "calendarReleaseLibrary", "in-media-library"),
			),
			output: {
				type: "rows",
				fields: [
					field("startAt", castDate(propertyText(entity, "publishDate"))),
					field("caption", caption),
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
