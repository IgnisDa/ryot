import type { PluginSignalSchedule } from "@ryot-app/contract/modules/plugins/manifest";
import type {
	Join,
	Predicate,
	ScalarExpression,
	TableReference,
} from "@ryot-app/contract/modules/ryotql/language";
import { SignalSchemaSlug } from "@ryot-app/contract/schema/brands";
import {
	and,
	castDate,
	castText,
	coalesce,
	column,
	concat,
	entitySchemaPredicate,
	eq,
	field,
	gt,
	inArray,
	jsonPath,
	literal,
	not,
	schemaOwnerPredicate,
	table,
} from "@ryot-app/ryotql";

import { libraryLinkExists } from "../shared/entity-selections";
import { libraryMembershipJoin } from "../shared/library-summary";
import {
	podcastEpisodicKindConfig,
	publishDate,
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
	readonly from: TableReference;
	readonly dueAt: ScalarExpression;
	readonly occurrence: ScalarExpression;
	readonly precision: "date" | "instant";
	readonly joins?: readonly [Join, ...Join[]];
	readonly subject: ReturnType<typeof subjectOf>;
	readonly positions?: Readonly<Record<string, ScalarExpression>>;
}) => {
	const positions = Object.entries(input.positions ?? {});
	return {
		dueAt: "dueAt",
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
			from: input.from,
			...(input.joins ? { joins: input.joins } : {}),
			where: and(
				input.where,
				libraryLinkExists(input.root, `${input.root.alias}Monitoring`, "media-monitoring"),
			),
			output: {
				type: "rows",
				fields: [
					field("dueAt", input.dueAt),
					field("occurrence", input.occurrence),
					field("entityName", column(input.root, "name")),
					field(
						"confirmedAt",
						coalesce(
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
		from: source.query.from,
		joins: source.query.joins,
		dueAt: publishDate(source.episode),
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
		from: source.anime,
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
		from: source.entity,
		root: source.entity,
		where: source.where,
		slug: "flat-releases",
		dueAt: publishDate(source.entity),
		occurrence: column(source.entity, "id"),
		subject: subjectOf("entity", flatMediaSchemaSlugs),
	});
};

const summaryValue = (membership: TableReference, name: string) =>
	jsonPath(column(membership, "projection"), name);

const staleProgress = (state: "on_hold" | "in_progress", days: number) => {
	const entity = table("entity", "entity");
	const library = libraryMembershipJoin(entity, "staleLibrary");
	const lastActivityAt = summaryValue(library.membership, "lastActivityAt");
	return {
		dueAt: "dueAt",
		delayDays: days,
		precision: "instant",
		requiresProKey: true,
		signal: STALE_SIGNAL,
		occurrence: "occurrence",
		slug: `${state.replace("_", "-")}-stale`,
		subject: subjectOf("entity", builtinMediaEntitySchemaSlugs),
		properties: { days: "days", entityName: "entityName", lifecycleState: "lifecycleState" },
		query: {
			from: entity,
			joins: [library.join],
			where: and(
				schemaOwnerPredicate(entity, "entitySchemaPluginId", self),
				inArray(
					column(entity, "entitySchemaSlug"),
					builtinMediaEntitySchemaSlugs.map((slug) => literal(slug)),
				),
				eq(castText(summaryValue(library.membership, "lifecycleState")), literal(state)),
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

const episodesAvailable = (
	config: typeof showEpisodicKindConfig | typeof podcastEpisodicKindConfig,
) => {
	const parent = table("entity", config.parentSchemaSlug);
	const library = libraryMembershipJoin(parent, "availableLibrary");
	const nextAiringAt = summaryValue(library.membership, "nextAiringAt");
	return {
		dueAt: "dueAt",
		precision: "date",
		occurrence: "occurrence",
		signal: AVAILABLE_SIGNAL,
		properties: { entityName: "entityName" },
		slug: `${config.kind}-episodes-available`,
		subject: subjectOf(config.parentSchemaSlug, [config.parentSchemaSlug]),
		query: {
			from: parent,
			joins: [library.join],
			output: {
				type: "rows",
				fields: [
					field("dueAt", castDate(nextAiringAt)),
					field("entityName", column(parent, "name")),
					field("occurrence", concat(column(parent, "id"), literal(":"), castText(nextAiringAt))),
				],
			},
			where: and(
				entitySchemaPredicate(parent, config.parentSchemaSlug, self),
				eq(castText(summaryValue(library.membership, "lifecycleState")), literal("caught_up")),
				not(libraryLinkExists(parent, "availableMonitoring", "media-monitoring")),
			),
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
