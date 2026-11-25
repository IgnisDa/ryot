import type { PluginSignalSchedule } from "@ryot-app/contract/modules/plugins/manifest";
import type {
	Join,
	Predicate,
	ScalarExpression,
	TableReference,
} from "@ryot-app/contract/modules/ryotql/authored";
import { SignalSchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	and,
	castDate,
	castText,
	coalesce,
	column,
	concat,
	conditional,
	entitySchemaPredicate,
	eq,
	field,
	gt,
	inArray,
	isNull,
	jsonPath,
	literal,
	localDate,
	lt,
	not,
	or,
	schemaOwnerPredicate,
	table,
} from "@ryot-app/ryotql";
import { reportingTimeZone } from "@ryot-app/ryotql/authoring";

import { libraryLinkExists, libraryLinkSource } from "../shared/entity-selections";
import {
	occursAt,
	podcastEpisodicKindConfig,
	showEpisodicKindConfig,
} from "../shared/lifecycle-expressions";
import { builtinMediaEntitySchemaSlugs, flatMediaSchemaSlugs } from "../shared/media-schema-slugs";
import {
	animeAiringSource,
	episodeSource,
	flatReleaseSource,
	self,
	subjectOf,
} from "./calendar-sources";

const RELEASED_SIGNAL = SignalSchemaSlug.make("media.released");
const STALE_SIGNAL = SignalSchemaSlug.make("media.progress-stale");
const AVAILABLE_SIGNAL = SignalSchemaSlug.make("media.episodes-available");

const PROVIDER_FRESHNESS_HOURS = 72;

const releaseSchedule = (input: {
	readonly slug: string;
	readonly where: Predicate;
	readonly root: TableReference;
	readonly dueAt: ScalarExpression;
	readonly joins?: readonly Join[];
	readonly instantAt?: ScalarExpression;
	readonly occurrence: ScalarExpression;
	readonly precision: "date" | "instant";
	readonly confirmedAt?: ScalarExpression;
	readonly subject: ReturnType<typeof subjectOf>;
	readonly positions?: Readonly<Record<string, ScalarExpression>>;
}) => {
	const positions = Object.entries(input.positions ?? {});
	const monitored = libraryLinkSource(
		input.root,
		`${input.root.alias}Monitoring`,
		"media-monitoring",
	);
	return {
		dueAt: "dueAt",
		...(input.instantAt === undefined ? {} : { instantAt: "instantAt" }),
		slug: input.slug,
		subject: input.subject,
		signal: RELEASED_SIGNAL,
		occurrence: "occurrence",
		precision: input.precision,
		freshness: { confirmedAt: "confirmedAt", maxAgeHours: PROVIDER_FRESHNESS_HOURS },
		properties: {
			entityName: "entityName",
			...Object.fromEntries(positions.map(([property]) => [property, property])),
		},
		query: {
			from: monitored.from,
			where: and(monitored.where, input.where),
			joins: [...monitored.joins, ...(input.joins ?? [])],
			output: {
				type: "rows",
				fields: [
					field("dueAt", input.dueAt),
					...(input.instantAt === undefined ? [] : [field("instantAt", input.instantAt)]),
					field("occurrence", input.occurrence),
					field("entityName", column(input.root, "name")),
					field(
						"confirmedAt",
						coalesce(
							input.confirmedAt ?? literal(null),
							column(input.root, "providerCheckedAt"),
							castDate(literal("1970-01-01T00:00:00.000Z")),
						),
					),
					...positions.map(([property, expression]) => field(property, expression)),
				],
			},
		},
	} satisfies PluginSignalSchedule;
};

const episodeReleases = (
	config: typeof showEpisodicKindConfig | typeof podcastEpisodicKindConfig,
) => {
	const source = episodeSource(config);
	return releaseSchedule({
		precision: "date",
		root: source.parent,
		dueAt: source.time.date,
		joins: source.parentJoins,
		instantAt: source.time.instant,
		...(config.kind === "show"
			? {
					confirmedAt: castDate(
						jsonPath(column(source.episode, "properties"), "airingConfirmedAt"),
					),
				}
			: {}),
		slug: `${config.kind}-episode-releases`,
		occurrence: column(source.episode, "id"),
		subject: subjectOf(config.parentSchemaSlug, [config.parentSchemaSlug]),
		where: source.seasonNumber
			? and(source.query.where, gt(source.seasonNumber, literal(0)))
			: source.query.where,
		positions: {
			episodeNumber: source.episodeNumber,
			...(source.seasonNumber ? { seasonNumber: source.seasonNumber } : {}),
		},
	});
};

const animeReleases = () => {
	const source = animeAiringSource();
	return releaseSchedule({
		root: source.anime,
		where: source.where,
		precision: "instant",
		dueAt: source.airingAt,
		joins: [source.element],
		slug: "anime-airing-releases",
		subject: subjectOf("anime", ["anime"]),
		positions: { episodeNumber: source.episodeNumber },
		occurrence: concat(column(source.anime, "id"), literal(":"), castText(source.episodeNumber)),
	});
};

const flatReleases = () => {
	const source = flatReleaseSource();
	return releaseSchedule({
		precision: "date",
		root: source.entity,
		where: source.where,
		slug: "flat-releases",
		dueAt: occursAt(source.entity),
		occurrence: column(source.entity, "id"),
		subject: subjectOf("entity", flatMediaSchemaSlugs),
	});
};

const summaryValue = (membership: TableReference, name: string) =>
	jsonPath(column(membership, "projection"), name);

const staleProgress = (state: "on_hold" | "in_progress", days: number) => {
	const entity = table("entity", "entity");
	const library = libraryLinkSource(entity, "staleLibrary", "in-media-library");
	const lastActivityAt = summaryValue(library.link, "lastActivityAt");
	return {
		dueAt: "dueAt",
		delayDays: days,
		entitlement: "pro",
		precision: "instant",
		signal: STALE_SIGNAL,
		occurrence: "occurrence",
		slug: `${state.replace("_", "-")}-stale`,
		subject: subjectOf("entity", builtinMediaEntitySchemaSlugs),
		properties: { days: "days", entityName: "entityName", lifecycleState: "lifecycleState" },
		query: {
			from: library.from,
			joins: library.joins,
			where: and(
				library.where,
				schemaOwnerPredicate(entity, "entitySchemaPluginId", self),
				inArray(
					column(entity, "entitySchemaSlug"),
					builtinMediaEntitySchemaSlugs.map((slug) => literal(slug)),
				),
				eq(castText(summaryValue(library.link, "lifecycleState")), literal(state)),
			),
			output: {
				type: "rows",
				fields: [
					field("dueAt", castDate(lastActivityAt)),
					field(
						"occurrence",
						concat(column(entity, "id"), literal(`:${state}:`), castText(lastActivityAt)),
					),
					field("days", literal(days)),
					field("lifecycleState", literal(state)),
					field("entityName", column(entity, "name")),
				],
			},
		},
	} satisfies PluginSignalSchedule;
};

/**
 * Due when the title's earliest unaired release arrives: its earliest instant when that falls before
 * the reporting day of its earliest date-only release, otherwise that date.
 */
const episodesAvailable = (
	config: typeof showEpisodicKindConfig | typeof podcastEpisodicKindConfig,
) => {
	const parent = table("entity", config.parentSchemaSlug);
	const library = libraryLinkSource(parent, "availableLibrary", "in-media-library");
	const date = castDate(summaryValue(library.link, "nextAiringDate"));
	const instant = castDate(summaryValue(library.link, "nextAiringAt"));
	const timedFirst = or(
		isNull(date),
		lt(castDate(localDate(instant, { timeZone: reportingTimeZone })), date),
	);
	return {
		dueAt: "dueAt",
		precision: "date",
		instantAt: "instantAt",
		occurrence: "occurrence",
		signal: AVAILABLE_SIGNAL,
		properties: { entityName: "entityName" },
		slug: `${config.kind}-episodes-available`,
		subject: subjectOf(config.parentSchemaSlug, [config.parentSchemaSlug]),
		query: {
			from: library.from,
			joins: library.joins,
			where: and(
				library.where,
				entitySchemaPredicate(parent, config.parentSchemaSlug, self),
				eq(castText(summaryValue(library.link, "lifecycleState")), literal("caught_up")),
				not(libraryLinkExists(parent, "availableMonitoring", "media-monitoring")),
			),
			output: {
				type: "rows",
				fields: [
					field("dueAt", date),
					field("instantAt", conditional(timedFirst, instant, literal(null))),
					field("entityName", column(parent, "name")),
					field(
						"occurrence",
						concat(
							column(parent, "id"),
							literal(":"),
							castText(
								conditional(
									timedFirst,
									summaryValue(library.link, "nextAiringAt"),
									summaryValue(library.link, "nextAiringDate"),
								),
							),
						),
					),
				],
			},
		},
	} satisfies PluginSignalSchedule;
};

export const mediaSignalSchedules = () => [
	episodeReleases(showEpisodicKindConfig),
	episodeReleases(podcastEpisodicKindConfig),
	animeReleases(),
	flatReleases(),
	staleProgress("in_progress", 7),
	staleProgress("on_hold", 14),
	episodesAvailable(showEpisodicKindConfig),
	episodesAvailable(podcastEpisodicKindConfig),
];
