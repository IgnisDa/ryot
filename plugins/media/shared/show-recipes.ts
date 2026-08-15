import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castBoolean,
	coalesce,
	column,
	count,
	dateBucket,
	defineRecipe,
	descending,
	eq,
	eventOrderDescending,
	exists,
	first,
	groupAscending,
	groupDescending,
	inArray,
	isNull,
	IsoDateString,
	join,
	jsonPath,
	literal,
	selectedAggregate,
	selectedField,
	selectedInclude,
	selectedMeasure,
	selectedOptionalRow,
	selectedRows,
	sum,
	table,
	type Recipe,
	type SelectedRow,
} from "@ryot-app/plugin-kit/ryotql";
import { EntityId, EntitySchemaSlug, EventId } from "@ryot-app/plugin-kit/schema";

import {
	entityId,
	entityIdentitySelection,
	entitySyncSelection,
	entitySchema,
	libraryLinkExists,
	propertyBoolean,
	propertyJson,
	propertyNumber,
	propertyText,
	relationshipTo,
	type Table,
} from "./entity-selections";
import {
	EpisodeLifecycleStateSchema,
	EpisodicLifecycleStateSchema,
	episodeLifecycleStateExpression,
	episodicLifecycleExpressions,
	showEpisodicKindConfig,
} from "./lifecycle-expressions";
import { MediaImageListSchema, MediaImageSchema } from "./media-image";

const showEpisodeInclude = (season: Table, episodeLimit: number) => {
	const episode = table("entity", "episode");
	const episodeNumber = propertyNumber(episode, "episodeNumber");
	const episodeRelationship = table("relationship", "episodeRelationship");

	return selectedInclude(episode, {
		limit: episodeLimit,
		orderBy: [ascending(episodeNumber)],
		where: and(
			entitySchema(episode, "show-episode"),
			relationshipTo(episodeRelationship, season, episode, "show-season-to-show-episode"),
		),
		joins: [
			join(
				"inner",
				episodeRelationship,
				eq(column(episodeRelationship, "targetEntityId"), column(episode, "id")),
			),
		],
		selection: {
			...entityIdentitySelection(episode),
			state: selectedField(
				episodeLifecycleStateExpression(episode, "showEpisodeDetailLifecycle"),
				EpisodeLifecycleStateSchema,
			),
			episodeNumber: selectedField(episodeNumber, Schema.Number),
			seasonNumber: selectedField(propertyNumber(episode, "seasonNumber"), Schema.Number),
			images: selectedField(propertyJson(episode, "images"), MediaImageListSchema),
			runtime: selectedField(propertyNumber(episode, "runtime"), Schema.NullOr(Schema.Number)),
			publishDate: selectedField(
				propertyText(episode, "publishDate"),
				Schema.NullOr(Schema.String),
			),
			description: selectedField(
				propertyText(episode, "description"),
				Schema.NullOr(Schema.String),
			),
		},
	});
};

const showSeasonInclude = (seasonLimit: number) => {
	const season = table("entity", "season");
	const seasonNumber = propertyNumber(season, "seasonNumber");
	const seasonRelationship = table("relationship", "seasonRelationship");

	return selectedInclude(season, {
		limit: seasonLimit,
		orderBy: [ascending(seasonNumber)],
		selection: {
			...entityIdentitySelection(season),
			seasonNumber: selectedField(seasonNumber, Schema.Number),
			images: selectedField(propertyJson(season, "images"), MediaImageListSchema),
			releaseDate: selectedField(propertyText(season, "releaseDate"), Schema.NullOr(Schema.String)),
			description: selectedField(propertyText(season, "description"), Schema.NullOr(Schema.String)),
		},
		where: and(
			entitySchema(season, "show-season"),
			relationshipTo(seasonRelationship, table("entity", "entity"), season, "show-to-show-season"),
		),
		joins: [
			join(
				"inner",
				seasonRelationship,
				eq(column(seasonRelationship, "targetEntityId"), column(season, "id")),
			),
		],
	});
};

export const showSeasonsRecipe = defineRecipe(
	(input: { readonly entityId: string; readonly seasonLimit: number }) => {
		const entity = table("entity", "entity");
		return {
			queries: {
				show: selectedOptionalRow(entity, {
					include: { seasons: showSeasonInclude(input.seasonLimit) },
					selection: entityIdentitySelection(entity),
					orderBy: [ascending(column(entity, "id"))],
					where: and(entitySchema(entity, "show"), entityId(entity, input.entityId)),
				}),
			},
			map: ({ show }) => Result.succeed(show ?? null),
		};
	},
);

export const showSeasonEpisodesRecipe = defineRecipe(
	(input: { readonly seasonId: string; readonly episodeLimit: number }) => {
		const entity = table("entity", "season");
		return {
			queries: {
				season: selectedOptionalRow(entity, {
					include: { episodes: showEpisodeInclude(entity, input.episodeLimit) },
					selection: entityIdentitySelection(entity),
					orderBy: [ascending(column(entity, "id"))],
					where: and(entitySchema(entity, "show-season"), entityId(entity, input.seasonId)),
				}),
			},
			map: ({ season }) => Result.succeed(season ?? null),
		};
	},
);

const libraryOwnership = (entity: Table) => {
	const library = table("entity", "ownershipLibrary");
	const relationship = table("relationship", "ownershipRelationship");
	return castBoolean(
		first(relationship, {
			select: jsonPath(column(relationship, "properties"), "owned"),
			joins: [
				join("inner", library, eq(column(relationship, "targetEntityId"), column(library, "id"))),
			],
			orderBy: [
				descending(column(relationship, "createdAt")),
				ascending(column(relationship, "id")),
			],
			where: and(
				entitySchema(library, "library"),
				eq(column(relationship, "sourceEntityId"), column(entity, "id")),
				eq(column(relationship, "relationshipSchemaSlug"), literal("in-library")),
			),
		}),
	);
};

const collectionMembershipInclude = (collectionLimit: number) => {
	const entity = table("entity", "entity");
	const collection = table("entity", "memberCollection");
	const membership = table("relationship", "memberCollectionRelationship");

	return selectedInclude(collection, {
		limit: collectionLimit,
		orderBy: [ascending(column(collection, "name")), ascending(column(collection, "id"))],
		selection: {
			id: selectedField(column(collection, "id"), EntityId),
			name: selectedField(column(collection, "name"), Schema.String),
		},
		joins: [
			join("inner", membership, eq(column(membership, "targetEntityId"), column(collection, "id"))),
		],
		where: and(
			entitySchema(collection, "collection"),
			eq(column(membership, "sourceEntityId"), column(entity, "id")),
			eq(column(membership, "relationshipSchemaSlug"), literal("member-of")),
		),
	});
};

export const showSummaryRecipe = defineRecipe(
	(input: { readonly entityId: string; readonly collectionLimit: number }) => {
		const entity = table("entity", "entity");
		const requested = table("entity", "requested");
		const provider = table("sandboxProvider", "provider");
		const lifecycle = episodicLifecycleExpressions(
			showEpisodicKindConfig,
			entity,
			"showSummaryLifecycle",
		);
		return {
			queries: {
				requested: selectedOptionalRow(requested, {
					orderBy: [ascending(column(requested, "id"))],
					where: entityId(requested, input.entityId),
					selection: {
						schemaSlug: selectedField(column(requested, "entitySchemaSlug"), EntitySchemaSlug),
					},
				}),
				show: selectedOptionalRow(entity, {
					orderBy: [ascending(column(entity, "id"))],
					include: { collections: collectionMembershipInclude(input.collectionLimit) },
					where: and(entitySchema(entity, "show"), entityId(entity, input.entityId)),
					joins: [join("left", provider, eq(column(entity, "providerId"), column(provider, "id")))],
					selection: {
						...entityIdentitySelection(entity),
						state: selectedField(lifecycle.state, EpisodicLifecycleStateSchema),
						owned: selectedField(libraryOwnership(entity), Schema.NullOr(Schema.Boolean)),
						genres: selectedField(
							propertyJson(entity, "genres"),
							Schema.NullOr(Schema.Array(Schema.String)),
						),
						images: selectedField(
							propertyJson(entity, "images"),
							Schema.NullOr(Schema.Array(MediaImageSchema)),
						),
						providerName: selectedField(column(provider, "name"), Schema.NullOr(Schema.String)),
						description: selectedField(
							propertyText(entity, "description"),
							Schema.NullOr(Schema.String),
						),
						publishDate: selectedField(
							propertyText(entity, "publishDate"),
							Schema.NullOr(Schema.String),
						),
						productionStatus: selectedField(
							propertyText(entity, "productionStatus"),
							Schema.NullOr(Schema.String),
						),
						publishYear: selectedField(
							propertyNumber(entity, "publishYear"),
							Schema.NullOr(Schema.Number),
						),
						totalSeasons: selectedField(
							propertyNumber(entity, "totalSeasons"),
							Schema.NullOr(Schema.Number),
						),
						totalEpisodes: selectedField(
							propertyNumber(entity, "totalEpisodes"),
							Schema.NullOr(Schema.Number),
						),
						providerRating: selectedField(
							propertyNumber(entity, "providerRating"),
							Schema.NullOr(Schema.Number),
						),
						isMonitored: selectedField(
							libraryLinkExists(entity, "monitoringLibrary", "media-monitoring"),
							Schema.Boolean,
						),
						isInLibrary: selectedField(
							libraryLinkExists(entity, "inLibraryLibrary", "in-library"),
							Schema.Boolean,
						),
					},
				}),
			},
			map: ({ requested: requestedRow, show }) =>
				Result.succeed({ show: show ?? null, entitySchemaSlug: requestedRow?.schemaSlug ?? null }),
		};
	},
);

const showPresentationSeasonCount = (show: Table) => {
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

const showPresentationEpisodeCount = (
	show: Table,
	alias: string,
	state?: "complete" | "in_progress",
) => {
	const episode = table("entity", `${alias}Episode`);
	const season = table("entity", `${alias}Season`);
	const showSeason = table("relationship", `${alias}ShowSeason`);
	const seasonEpisode = table("relationship", `${alias}SeasonEpisode`);
	return count(episode, {
		joins: [
			join(
				"inner",
				seasonEpisode,
				eq(column(seasonEpisode, "targetEntityId"), column(episode, "id")),
			),
			join("inner", season, eq(column(seasonEpisode, "sourceEntityId"), column(season, "id"))),
			join("inner", showSeason, eq(column(showSeason, "targetEntityId"), column(season, "id"))),
		],
		where: and(
			entitySchema(episode, "show-episode"),
			entitySchema(season, "show-season"),
			eq(column(showSeason, "sourceEntityId"), column(show, "id")),
			eq(column(showSeason, "relationshipSchemaSlug"), literal("show-to-show-season")),
			eq(column(seasonEpisode, "relationshipSchemaSlug"), literal("show-season-to-show-episode")),
			...(state === undefined
				? []
				: [eq(episodeLifecycleStateExpression(episode, `${alias}Lifecycle`), literal(state))]),
		),
	});
};

export const showPresentationRecipe = defineRecipe((entityIds: readonly string[]) => {
	const show = table("entity", "presentationShow");
	const lifecycle = episodicLifecycleExpressions(
		showEpisodicKindConfig,
		show,
		"showPresentationLifecycle",
	);
	return {
		queries: {
			shows: selectedRows(show, {
				limit: 100,
				orderBy: [ascending(column(show, "id"))],
				where: and(
					entitySchema(show, "show"),
					inArray(
						column(show, "id"),
						entityIds.map((requestedId) => literal(requestedId)),
					),
				),
				selection: {
					...entityIdentitySelection(show),
					state: selectedField(lifecycle.state, EpisodicLifecycleStateSchema),
					images: selectedField(propertyJson(show, "images"), MediaImageListSchema),
					publishDate: selectedField(
						propertyText(show, "publishDate"),
						Schema.NullOr(Schema.String),
					),
					publishYear: selectedField(
						propertyNumber(show, "publishYear"),
						Schema.NullOr(Schema.Number),
					),
					productionStatus: selectedField(
						propertyText(show, "productionStatus"),
						Schema.NullOr(Schema.String),
					),
					storedSeasons: selectedField(showPresentationSeasonCount(show), Schema.Number),
					storedEpisodes: selectedField(
						showPresentationEpisodeCount(show, "presentationStored"),
						Schema.Number,
					),
					watchedEpisodes: selectedField(
						showPresentationEpisodeCount(show, "presentationWatched", "complete"),
						Schema.Number,
					),
					inProgressEpisodes: selectedField(
						showPresentationEpisodeCount(show, "presentationProgress", "in_progress"),
						Schema.Number,
					),
				},
			}),
		},
		map: ({ shows }) => Result.succeed(shows.items),
	};
});

const creditSelection = (credit: Table, relationship: Table) => ({
	id: selectedField(column(credit, "id"), EntityId),
	name: selectedField(column(credit, "name"), Schema.String),
	images: selectedField(propertyJson(credit, "images"), MediaImageListSchema),
	order: selectedField(propertyNumber(relationship, "order"), Schema.NullOr(Schema.Number)),
	roles: selectedField(
		propertyJson(relationship, "roles"),
		Schema.NullOr(Schema.Array(Schema.String)),
	),
	...entitySyncSelection(credit),
});

const creditRows = (input: {
	readonly limit: number;
	readonly credit: Table;
	readonly entityId: string;
	readonly relationship: Table;
	readonly creditSchemaSlug: string;
	readonly relationshipSchemaSlug: string;
}) => ({
	limit: input.limit,
	orderBy: [
		ascending(propertyNumber(input.relationship, "order")),
		ascending(column(input.credit, "name")),
	],
	joins: [
		join(
			"inner",
			input.credit,
			eq(column(input.relationship, "sourceEntityId"), column(input.credit, "id")),
		),
	],
	where: and(
		entitySchema(input.credit, input.creditSchemaSlug),
		eq(column(input.relationship, "targetEntityId"), literal(input.entityId)),
		eq(column(input.relationship, "relationshipSchemaSlug"), literal(input.relationshipSchemaSlug)),
	),
});

export const showOverviewRecipe = defineRecipe(
	(input: {
		readonly entityId: string;
		readonly peopleLimit: number;
		readonly companyLimit: number;
		readonly recommendationLimit: number;
	}) => {
		const person = table("entity", "person");
		const company = table("entity", "company");
		const suggested = table("entity", "suggested");
		const personRelationship = table("relationship", "personRelationship");
		const companyRelationship = table("relationship", "companyRelationship");
		const suggestionRelationship = table("relationship", "suggestionRelationship");
		return {
			queries: {
				people: selectedRows(personRelationship, {
					...creditRows({
						credit: person,
						entityId: input.entityId,
						limit: input.peopleLimit,
						creditSchemaSlug: "person",
						relationship: personRelationship,
						relationshipSchemaSlug: "person-to-show",
					}),
					selection: {
						...creditSelection(person, personRelationship),
						character: selectedField(
							propertyText(personRelationship, "character"),
							Schema.NullOr(Schema.String),
						),
					},
				}),
				companies: selectedRows(companyRelationship, {
					...creditRows({
						credit: company,
						entityId: input.entityId,
						limit: input.companyLimit,
						creditSchemaSlug: "company",
						relationship: companyRelationship,
						relationshipSchemaSlug: "company-to-show",
					}),
					selection: creditSelection(company, companyRelationship),
				}),
				recommendations: selectedRows(suggestionRelationship, {
					limit: input.recommendationLimit,
					orderBy: [ascending(column(suggested, "name"))],
					joins: [
						join(
							"inner",
							suggested,
							eq(column(suggestionRelationship, "targetEntityId"), column(suggested, "id")),
						),
					],
					where: and(
						entitySchema(suggested, "show"),
						eq(column(suggestionRelationship, "sourceEntityId"), literal(input.entityId)),
						eq(
							column(suggestionRelationship, "relationshipSchemaSlug"),
							literal("media-suggestion"),
						),
					),
					selection: {
						id: selectedField(column(suggested, "id"), EntityId),
						name: selectedField(column(suggested, "name"), Schema.String),
						images: selectedField(propertyJson(suggested, "images"), MediaImageListSchema),
						...entitySyncSelection(suggested),
					},
				}),
			},
		};
	},
);

const showActivityEpisodeSlugs = ["review"] as const;

const showActivityParentSlugs = ["backlog", "on_hold", "dropped", "complete", "review"] as const;

const showActivityCollectionSlugs = [
	"add-entity-to-collection",
	"remove-entity-from-collection",
] as const;

const eventSchemaIsOneOf = (event: Table, slugs: readonly string[]) =>
	inArray(
		column(event, "eventSchemaSlug"),
		slugs.map((slug) => literal(slug)),
	);

const showEpisodeMembership = (episode: Table, showEntityId: string, alias: string) => {
	const season = table("entity", `${alias}Season`);
	const showSeason = table("relationship", `${alias}ShowSeason`);
	const seasonEpisode = table("relationship", `${alias}SeasonEpisode`);
	return exists(showSeason, {
		joins: [
			join("inner", season, eq(column(showSeason, "targetEntityId"), column(season, "id"))),
			join(
				"inner",
				seasonEpisode,
				eq(column(seasonEpisode, "sourceEntityId"), column(season, "id")),
			),
		],
		where: and(
			entitySchema(season, "show-season"),
			eq(column(showSeason, "sourceEntityId"), literal(showEntityId)),
			eq(column(showSeason, "relationshipSchemaSlug"), literal("show-to-show-season")),
			relationshipTo(seasonEpisode, season, episode, "show-season-to-show-episode"),
		),
	});
};

const showActivityEventSelection = (event: Table) => ({
	id: selectedField(column(event, "id"), EventId),
	createdAt: selectedField(column(event, "createdAt"), IsoDateString),
	occurredAt: selectedField(column(event, "occurredAt"), IsoDateString),
	text: selectedField(propertyText(event, "text"), Schema.NullOr(Schema.String)),
	rating: selectedField(propertyNumber(event, "rating"), Schema.NullOr(Schema.Number)),
	timeSpent: selectedField(propertyNumber(event, "timeSpent"), Schema.NullOr(Schema.Number)),
	isSpoiler: selectedField(propertyBoolean(event, "isSpoiler"), Schema.NullOr(Schema.Boolean)),
	consumedOn: selectedField(propertyText(event, "consumedOn"), Schema.NullOr(Schema.String)),
});

const showActivityEpisodeSelection = (episode: Table) => ({
	episodeId: selectedField(column(episode, "id"), EntityId),
	episodeName: selectedField(column(episode, "name"), Schema.String),
	seasonNumber: selectedField(propertyNumber(episode, "seasonNumber"), Schema.Number),
	episodeNumber: selectedField(propertyNumber(episode, "episodeNumber"), Schema.Number),
	episodeRuntime: selectedField(propertyNumber(episode, "runtime"), Schema.NullOr(Schema.Number)),
});

const showActivityEpisode = (
	row: SelectedRow<ReturnType<typeof showActivityEpisodeSelection>>,
) => ({
	id: row.episodeId,
	name: row.episodeName,
	runtime: row.episodeRuntime,
	seasonNumber: row.seasonNumber,
	episodeNumber: row.episodeNumber,
});

const showActivitySeasonCoverage = (season: Table) => {
	const episode = table("entity", "coverageEpisode");
	const seasonEpisode = table("relationship", "coverageSeasonEpisode");
	const runtime = propertyNumber(episode, "runtime");
	const joins = [
		join(
			"inner",
			seasonEpisode,
			eq(column(seasonEpisode, "targetEntityId"), column(episode, "id")),
		),
	];
	const inSeason = and(
		entitySchema(episode, "show-episode"),
		relationshipTo(seasonEpisode, season, episode, "show-season-to-show-episode"),
	);
	const isWatched = and(
		inSeason,
		eq(episodeLifecycleStateExpression(episode, "coverageEpisodeLifecycle"), literal("complete")),
	);
	const completion = table("event", "coverageCompletion");
	const loggedMinutes = first(completion, {
		select: propertyNumber(completion, "timeSpent"),
		orderBy: eventOrderDescending(completion),
		where: and(
			eq(column(completion, "entityId"), column(episode, "id")),
			eq(column(completion, "eventSchemaSlug"), literal("complete")),
		),
	});
	return {
		episodeTotal: selectedField(count(episode, { joins, where: inSeason }), Schema.Number),
		watchedTotal: selectedField(count(episode, { joins, where: isWatched }), Schema.Number),
		watchedMinutes: selectedField(
			sum(episode, coalesce(loggedMinutes, runtime), { joins, where: isWatched }),
			Schema.NullOr(Schema.Number),
		),
		watchedUnknownRuntime: selectedField(
			count(episode, { joins, where: and(isWatched, isNull(runtime)) }),
			Schema.Number,
		),
	};
};

const compareShowActivityDescending = (
	left: { readonly id: string; readonly createdAt: string; readonly occurredAt: string },
	right: { readonly id: string; readonly createdAt: string; readonly occurredAt: string },
) =>
	right.occurredAt.localeCompare(left.occurredAt) ||
	right.createdAt.localeCompare(left.createdAt) ||
	right.id.localeCompare(left.id);

export const showActivityRecipe = defineRecipe(
	(input: {
		readonly entityId: string;
		readonly timeZone: string;
		readonly seasonLimit: number;
		readonly watchDayLimit: number;
		readonly parentEventLimit: number;
		readonly episodeEventLimit: number;
		readonly episodeProgressLimit: number;
		readonly collectionEventLimit: number;
	}) => {
		const show = table("entity", "activityShow");
		const watchDay = table("event", "watchDayEvent");
		const watchDayEpisode = table("entity", "watchDayEpisode");
		const season = table("entity", "coverageSeason");
		const parentEvent = table("event", "parentEvent");
		const watchEvent = table("event", "watchCountEvent");
		const episodeEvent = table("event", "episodeEvent");
		const eventEpisode = table("entity", "eventEpisode");
		const progressEvent = table("event", "progressEvent");
		const progressProbe = table("event", "progressProbe");
		const collectionEvent = table("event", "collectionEvent");
		const eventCollection = table("entity", "eventCollection");
		const progressEpisode = table("entity", "progressEpisode");
		const showSeason = table("relationship", "coverageShowSeason");
		const isProgressOf = (event: Table) =>
			and(
				eq(column(event, "entityId"), column(progressEpisode, "id")),
				eq(column(event, "eventSchemaSlug"), literal("progress")),
			);
		return {
			queries: {
				watchDays: selectedAggregate(watchDay, {
					limit: input.watchDayLimit,
					orderBy: [
						groupDescending("day"),
						groupAscending("seasonNumber"),
						groupAscending("episodeNumber"),
					],
					joins: [
						join(
							"inner",
							watchDayEpisode,
							eq(column(watchDay, "entityId"), column(watchDayEpisode, "id")),
						),
					],
					groupBy: {
						day: selectedField(
							dateBucket(column(watchDay, "occurredAt"), {
								bucket: "day",
								timeZone: input.timeZone,
							}),
							IsoDateString,
						),
						episodeId: selectedField(column(watchDayEpisode, "id"), EntityId),
						episodeName: selectedField(column(watchDayEpisode, "name"), Schema.String),
						consumedOn: selectedField(
							propertyText(watchDay, "consumedOn"),
							Schema.NullOr(Schema.String),
						),
						seasonNumber: selectedField(
							propertyNumber(watchDayEpisode, "seasonNumber"),
							Schema.Number,
						),
						episodeNumber: selectedField(
							propertyNumber(watchDayEpisode, "episodeNumber"),
							Schema.Number,
						),
						runtime: selectedField(
							propertyNumber(watchDayEpisode, "runtime"),
							Schema.NullOr(Schema.Number),
						),
					},
					measures: {
						minutes: selectedMeasure(
							{ function: "sum", expr: propertyNumber(watchDay, "timeSpent") },
							Schema.NullOr(Schema.Number),
						),
					},
					where: and(
						entitySchema(watchDayEpisode, "show-episode"),
						eq(column(watchDay, "eventSchemaSlug"), literal("complete")),
						showEpisodeMembership(watchDayEpisode, input.entityId, "watchDayShow"),
					),
				}),
				totals: selectedOptionalRow(show, {
					orderBy: [ascending(column(show, "id"))],
					where: and(entitySchema(show, "show"), entityId(show, input.entityId)),
					selection: {
						watchCount: selectedField(
							count(watchEvent, {
								where: and(
									eq(column(watchEvent, "entityId"), column(show, "id")),
									eq(column(watchEvent, "eventSchemaSlug"), literal("complete")),
								),
							}),
							Schema.Number,
						),
					},
				}),
				seasons: selectedRows(season, {
					limit: input.seasonLimit,
					orderBy: [
						ascending(propertyNumber(season, "seasonNumber")),
						ascending(column(season, "id")),
					],
					joins: [
						join(
							"inner",
							showSeason,
							eq(column(showSeason, "targetEntityId"), column(season, "id")),
						),
					],
					selection: {
						id: selectedField(column(season, "id"), EntityId),
						seasonNumber: selectedField(propertyNumber(season, "seasonNumber"), Schema.Number),
						...showActivitySeasonCoverage(season),
					},
					where: and(
						entitySchema(season, "show-season"),
						eq(column(showSeason, "sourceEntityId"), literal(input.entityId)),
						eq(column(showSeason, "relationshipSchemaSlug"), literal("show-to-show-season")),
					),
				}),
				parentEvents: selectedRows(parentEvent, {
					limit: input.parentEventLimit,
					orderBy: eventOrderDescending(parentEvent),
					selection: {
						...showActivityEventSelection(parentEvent),
						startedOn: selectedField(
							propertyText(parentEvent, "startedOn"),
							Schema.NullOr(IsoDateString),
						),
						completedOn: selectedField(
							propertyText(parentEvent, "completedOn"),
							Schema.NullOr(IsoDateString),
						),
						eventSchemaSlug: selectedField(
							column(parentEvent, "eventSchemaSlug"),
							Schema.Literals(showActivityParentSlugs),
						),
					},
					where: and(
						eq(column(parentEvent, "entityId"), literal(input.entityId)),
						eventSchemaIsOneOf(parentEvent, showActivityParentSlugs),
					),
				}),
				episodeEvents: selectedRows(episodeEvent, {
					limit: input.episodeEventLimit,
					orderBy: eventOrderDescending(episodeEvent),
					joins: [
						join(
							"inner",
							eventEpisode,
							eq(column(episodeEvent, "entityId"), column(eventEpisode, "id")),
						),
					],
					selection: {
						...showActivityEventSelection(episodeEvent),
						...showActivityEpisodeSelection(eventEpisode),
						eventSchemaSlug: selectedField(
							column(episodeEvent, "eventSchemaSlug"),
							Schema.Literals(showActivityEpisodeSlugs),
						),
					},
					where: and(
						entitySchema(eventEpisode, "show-episode"),
						eventSchemaIsOneOf(episodeEvent, showActivityEpisodeSlugs),
						showEpisodeMembership(eventEpisode, input.entityId, "episodeEventShow"),
					),
				}),
				episodeProgress: selectedRows(progressEpisode, {
					limit: input.episodeProgressLimit,
					orderBy: [
						ascending(propertyNumber(progressEpisode, "seasonNumber")),
						ascending(propertyNumber(progressEpisode, "episodeNumber")),
						ascending(column(progressEpisode, "id")),
					],
					selection: showActivityEpisodeSelection(progressEpisode),
					include: {
						milestone: selectedInclude(progressEvent, {
							limit: 1,
							where: isProgressOf(progressEvent),
							orderBy: eventOrderDescending(progressEvent),
							selection: {
								id: selectedField(column(progressEvent, "id"), EventId),
								createdAt: selectedField(column(progressEvent, "createdAt"), IsoDateString),
								occurredAt: selectedField(column(progressEvent, "occurredAt"), IsoDateString),
								consumedOn: selectedField(
									propertyText(progressEvent, "consumedOn"),
									Schema.NullOr(Schema.String),
								),
								progressPercent: selectedField(
									propertyNumber(progressEvent, "progressPercent"),
									Schema.NullOr(Schema.Number),
								),
							},
						}),
					},
					where: and(
						entitySchema(progressEpisode, "show-episode"),
						exists(progressProbe, { where: isProgressOf(progressProbe) }),
						eq(
							episodeLifecycleStateExpression(progressEpisode, "progressEpisodeLifecycle"),
							literal("in_progress"),
						),
						showEpisodeMembership(progressEpisode, input.entityId, "progressEpisodeShow"),
					),
				}),
				collectionEvents: selectedRows(collectionEvent, {
					limit: input.collectionEventLimit,
					orderBy: eventOrderDescending(collectionEvent),
					joins: [
						join(
							"inner",
							eventCollection,
							eq(column(collectionEvent, "entityId"), column(eventCollection, "id")),
						),
					],
					selection: {
						id: selectedField(column(collectionEvent, "id"), EventId),
						collectionId: selectedField(column(eventCollection, "id"), EntityId),
						collectionName: selectedField(column(eventCollection, "name"), Schema.String),
						createdAt: selectedField(column(collectionEvent, "createdAt"), IsoDateString),
						occurredAt: selectedField(column(collectionEvent, "occurredAt"), IsoDateString),
						eventSchemaSlug: selectedField(
							column(collectionEvent, "eventSchemaSlug"),
							Schema.Literals(showActivityCollectionSlugs),
						),
					},
					where: and(
						entitySchema(eventCollection, "collection"),
						eventSchemaIsOneOf(collectionEvent, showActivityCollectionSlugs),
						eq(propertyText(collectionEvent, "entityId"), literal(input.entityId)),
					),
				}),
			},
			map: ({
				totals,
				seasons,
				watchDays,
				parentEvents,
				episodeEvents,
				episodeProgress,
				collectionEvents,
			}) => {
				const events = [
					...parentEvents.items.map((row) => ({ ...row, kind: "parent" as const })),
					...episodeEvents.items.map(
						({ episodeId, episodeName, seasonNumber, episodeNumber, episodeRuntime, ...row }) => ({
							...row,
							kind: "episode" as const,
							progressPercent: null,
							episode: showActivityEpisode({
								episodeId,
								episodeName,
								seasonNumber,
								episodeNumber,
								episodeRuntime,
							}),
						}),
					),
					...episodeProgress.items.flatMap((row) =>
						row.milestone.items.map((milestone) => ({
							...milestone,
							text: null,
							rating: null,
							timeSpent: null,
							isSpoiler: null,
							kind: "episode" as const,
							episode: showActivityEpisode(row),
							eventSchemaSlug: "progress" as const,
						})),
					),
					...collectionEvents.items.map(({ collectionId, collectionName, ...row }) => ({
						...row,
						text: null,
						rating: null,
						timeSpent: null,
						isSpoiler: null,
						consumedOn: null,
						kind: "collection" as const,
						collection: { id: collectionId, name: collectionName },
					})),
				];
				return Result.succeed({
					seasons: seasons.items,
					watchDays: watchDays.items,
					watchCount: totals?.watchCount ?? 0,
					events: events.sort(compareShowActivityDescending),
					truncated:
						seasons.pageInfo.hasMore ||
						watchDays.pageInfo?.hasMore === true ||
						parentEvents.pageInfo.hasMore ||
						episodeEvents.pageInfo.hasMore ||
						episodeProgress.pageInfo.hasMore ||
						collectionEvents.pageInfo.hasMore,
				});
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
