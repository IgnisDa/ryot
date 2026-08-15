import {
	EntityId,
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	SandboxProviderId,
} from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	column,
	document,
	eq,
	exists,
	field,
	include,
	isNull,
	join,
	jsonPath,
	literal,
	rows,
	table,
} from "@ryot-app/ryotql";
import { DateTime, Effect } from "effect";

import { adminHeaders } from "~/fixtures/kernel/admin";
import type { Client } from "~/fixtures/kernel/auth";
import { getApiClient } from "~/fixtures/kernel/contract-client";
import { insertGlobalRelationship } from "~/fixtures/kernel/entity-graph";
import {
	findBuiltinSchemaBySlug,
	getBuiltinEntitySchemaSlug,
	makeEntitySchemaSlug,
} from "~/fixtures/kernel/entity-schemas";
import { pollUntil } from "~/fixtures/kernel/polling";
import {
	listRelationshipSchemas,
	requireRelationshipSchemaBySlug,
} from "~/fixtures/kernel/relationship-schemas";
import { createRelationship } from "~/fixtures/kernel/relationships";
import {
	executeRyotQL,
	requireRows,
	requireRyotQLText,
	requireRyotQLValue,
} from "~/fixtures/kernel/ryotql";
import {
	assertPresent,
	requireObjectRecord,
	requirePresent,
	requireString,
} from "~/support/assertions";

import { findBuiltinSchemaWithProviders } from "./entity-schemas";

export const queryInMediaLibraryRelationship = (
	client: Client,
	entityId: string,
	entitySchemaSlug: string,
) => {
	const entity = table("entity", "entity");
	const membership = table("relationship", "membership");
	const mediaLibrary = table("entity", "mediaLibrary");
	const existingLibrary = table("entity", "existingLibrary");
	return executeRyotQL(
		client,
		document({
			entity: rows(entity, {
				limit: 1,
				fields: [field("id", column(entity, "id"))],
				where: and(
					eq(column(entity, "id"), literal(entityId)),
					eq(column(entity, "entitySchemaSlug"), literal(entitySchemaSlug)),
					exists(membership, {
						joins: [
							join(
								"inner",
								existingLibrary,
								eq(column(membership, "targetEntityId"), column(existingLibrary, "id")),
							),
						],
						where: and(
							eq(column(membership, "sourceEntityId"), column(entity, "id")),
							eq(column(membership, "relationshipSchemaSlug"), literal("in-media-library")),
							eq(column(existingLibrary, "entitySchemaSlug"), literal("media-library")),
						),
					}),
				),
				include: [
					include(membership, {
						limit: 1,
						key: "libraries",
						orderBy: [ascending(column(membership, "id"))],
						joins: [
							join(
								"inner",
								mediaLibrary,
								eq(column(membership, "targetEntityId"), column(mediaLibrary, "id")),
							),
						],
						where: and(
							eq(column(membership, "sourceEntityId"), column(entity, "id")),
							eq(column(membership, "relationshipSchemaSlug"), literal("in-media-library")),
						),
						fields: [
							field("owned", jsonPath(column(membership, "properties"), "owned")),
							field(
								"ownershipSources",
								jsonPath(column(membership, "properties"), "ownershipSources"),
							),
							field(
								"ownershipSyncedAt",
								jsonPath(column(membership, "properties"), "ownershipSyncedAt"),
							),
						],
					}),
				],
			}),
		}),
	);
};

const getEntityByProvenance = (
	client: Client,
	input: { externalId: string; providerId: string; entitySchemaSlug: string },
	globalOnly: boolean,
) =>
	Effect.gen(function* () {
		const entity = table("entity", "entity");
		const result = yield* executeRyotQL(
			client,
			document({
				entities: rows(entity, {
					limit: 1,
					fields: [
						field("id", column(entity, "id")),
						field("name", column(entity, "name")),
						field("populatedAt", column(entity, "populatedAt")),
					],
					where: and(
						eq(column(entity, "entitySchemaSlug"), literal(input.entitySchemaSlug)),
						eq(column(entity, "externalId"), literal(input.externalId)),
						eq(column(entity, "providerId"), literal(input.providerId)),
						...(globalOnly ? [isNull(column(entity, "userId"))] : []),
					),
				}),
			}),
		);
		const entities = requireRows(result.data.entities, "entities");
		const entityRow = requirePresent(
			entities.items[0],
			`Missing ${globalOnly ? "global" : "visible"} entity for external id '${input.externalId}'`,
		);
		const populatedAt = requireRyotQLValue(entityRow, "populatedAt");
		return {
			id: requireRyotQLText(entityRow, "id"),
			name: requireRyotQLText(entityRow, "name"),
			populatedAt:
				populatedAt === null
					? null
					: requireString(populatedAt, "Expected 'populatedAt' to contain text"),
		};
	});

export const getGlobalEntityByProvenance = (
	client: Client,
	input: { externalId: string; providerId: string; entitySchemaSlug: string },
) => getEntityByProvenance(client, input, true);

export const getVisibleEntityByProvenance = (
	client: Client,
	input: { externalId: string; providerId: string; entitySchemaSlug: string },
) => getEntityByProvenance(client, input, false);

export const waitForEntityPopulated = (
	client: Client,
	input: { externalId: string; providerId: string; entitySchemaSlug: string },
) =>
	pollUntil(
		`global entity '${input.externalId}' populated`,
		Effect.gen(function* () {
			const entity = yield* getGlobalEntityByProvenance(client, input);
			return entity.populatedAt !== null ? entity : null;
		}),
	);

export const getRelationshipBySchemaSlug = (
	client: Client,
	input: { sourceEntityId: string; targetEntityId: string; relationshipSchemaSlug: string },
) =>
	Effect.gen(function* () {
		const schemas = yield* listRelationshipSchemas(client, {
			slugs: [input.relationshipSchemaSlug],
		});
		const relationshipSchema = requireRelationshipSchemaBySlug(
			schemas,
			input.relationshipSchemaSlug,
		);
		const relationshipTable = table("relationship", "relationship");
		const result = yield* executeRyotQL(
			client,
			document({
				relationships: rows(relationshipTable, {
					limit: 1,
					fields: [
						field("properties", column(relationshipTable, "properties")),
						field("sourceEntityId", column(relationshipTable, "sourceEntityId")),
						field("targetEntityId", column(relationshipTable, "targetEntityId")),
					],
					where: and(
						eq(column(relationshipTable, "sourceEntityId"), literal(input.sourceEntityId)),
						eq(column(relationshipTable, "targetEntityId"), literal(input.targetEntityId)),
						eq(column(relationshipTable, "relationshipSchemaSlug"), literal(relationshipSchema.id)),
					),
				}),
			}),
		);
		const relationship = requirePresent(
			requireRows(result.data.relationships, "relationships").items[0],
			`Missing relationship '${input.relationshipSchemaSlug}' for '${input.sourceEntityId}' -> '${input.targetEntityId}'`,
		);
		return {
			sourceEntityId: requireRyotQLText(relationship, "sourceEntityId"),
			targetEntityId: requireRyotQLText(relationship, "targetEntityId"),
			properties: requireObjectRecord(
				requireRyotQLValue(relationship, "properties"),
				"Expected relationship properties to be an object",
			),
		};
	});

export const seedMediaEntity = (input: {
	name: string;
	client?: Client;
	externalId: string;
	userId?: string | null;
	entitySchemaSlug: string;
	providerId: string | null;
	properties: Record<string, unknown>;
}) =>
	Effect.gen(function* () {
		const entitySchemaSlug = makeEntitySchemaSlug(input.entitySchemaSlug);
		const providerId = input.providerId ? SandboxProviderId.make(input.providerId) : undefined;
		const result = input.userId
			? yield* requirePresent(
					input.client,
					"Client is required for user-scoped entity seeding",
				).call((c) =>
					c.entities.create({
						payload: {
							providerId,
							entitySchemaSlug,
							name: input.name,
							properties: input.properties,
							externalId: input.externalId,
						},
					}),
				)
			: yield* getApiClient().call(
					(c) =>
						c.testSupport.createGlobalEntity({
							payload: {
								providerId,
								entitySchemaSlug,
								name: input.name,
								properties: input.properties,
								externalId: input.externalId,
							},
						}),
					adminHeaders(),
				);
		const entity = "entity" in result ? result.entity : result;
		const warnings = "warnings" in result ? result.warnings : undefined;

		return {
			id: entity.id,
			name: input.name,
			userId: input.userId ?? null,
			properties: input.properties,
			externalId: input.externalId,
			providerId: input.providerId,
			entitySchemaSlug: entity.entitySchemaSlug,
			...(warnings !== undefined ? { warnings } : {}),
		};
	});

export const createGlobalBookEntityFixture = (
	client: Client,
	options: { name?: string; externalId?: string } = {},
) =>
	Effect.gen(function* () {
		const { schema } = yield* findBuiltinSchemaWithProviders(client);
		const entity = yield* seedMediaEntity({
			userId: null,
			properties: {},
			entitySchemaSlug: schema.id,
			name: options.name ?? `Global Built-in Book ${crypto.randomUUID()}`,
			externalId: options.externalId ?? `global-book-${crypto.randomUUID()}`,
			providerId: requirePresent(schema.providers[0]?.providerId, "Missing book provider"),
		});
		return { entity, schema };
	});

export const seedGlobalShowEpisodeTree = (
	client: Client,
	options: { showName: string; showProperties?: Record<string, unknown> },
) =>
	Effect.gen(function* () {
		const { schema: showSchema } = yield* findBuiltinSchemaBySlug(client, "show");
		const tmdbProvider = showSchema.providers.find((provider) => provider.name === "TMDB");
		assertPresent(tmdbProvider, "Missing TMDB provider for built-in show schema");

		const [seasonSchemaId, episodeSchemaId, relationshipSchemas] = yield* Effect.all([
			getBuiltinEntitySchemaSlug(client, "show-season"),
			getBuiltinEntitySchemaSlug(client, "show-episode"),
			listRelationshipSchemas(client, {
				slugs: ["show-to-show-season", "show-season-to-show-episode"],
			}),
		]);
		const showToSeason = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"show-to-show-season",
		);
		const seasonToEpisode = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"show-season-to-show-episode",
		);

		const tmdbId = String(Math.floor(Math.random() * 1_000_000_000));
		const populatedAt = DateTime.formatIso(DateTime.nowUnsafe());
		const api = getApiClient();
		const createGlobalEntity = (input: {
			name: string;
			externalId: string;
			entitySchemaSlug: string;
			properties: Record<string, unknown>;
		}) =>
			api.call(
				(c) =>
					c.testSupport.createGlobalEntity({
						payload: {
							...input,
							populatedAt,
							providerId: SandboxProviderId.make(tmdbProvider.providerId),
							entitySchemaSlug: EntitySchemaSlug.make(input.entitySchemaSlug),
						},
					}),
				adminHeaders(),
			);
		const show = yield* createGlobalEntity({
			externalId: tmdbId,
			name: options.showName,
			entitySchemaSlug: showSchema.id,
			properties: { totalSeasons: 1, totalEpisodes: 1, ...options.showProperties },
		});
		const season = yield* createGlobalEntity({
			name: "Season 1",
			externalId: `season-${tmdbId}`,
			properties: { seasonNumber: 1 },
			entitySchemaSlug: seasonSchemaId,
		});
		const episode = yield* createGlobalEntity({
			name: "Episode 2",
			externalId: `episode-${tmdbId}`,
			entitySchemaSlug: episodeSchemaId,
			properties: { seasonNumber: 1, episodeNumber: 2 },
		});
		yield* api.call(
			(c) =>
				c.testSupport.upsertGlobalRelationship({
					payload: {
						sourceEntityId: show.id,
						targetEntityId: season.id,
						relationshipSchemaSlug: RelationshipSchemaSlug.make(showToSeason.id),
					},
				}),
			adminHeaders(),
		);
		yield* api.call(
			(c) =>
				c.testSupport.upsertGlobalRelationship({
					payload: {
						sourceEntityId: season.id,
						targetEntityId: episode.id,
						relationshipSchemaSlug: RelationshipSchemaSlug.make(seasonToEpisode.id),
					},
				}),
			adminHeaders(),
		);

		return { tmdbId, showId: show.id, seasonId: season.id, episodeId: episode.id };
	});

export const seedGlobalMovieWithCollection = (
	client: Client,
	options: {
		readonly movieName: string;
		readonly collectionName: string;
		readonly siblingName: string;
		readonly withCredits?: boolean;
		readonly movieProperties?: Record<string, unknown>;
		readonly siblingProperties?: Record<string, unknown>;
	},
) =>
	Effect.gen(function* () {
		const { schema: movieSchema } = yield* findBuiltinSchemaBySlug(client, "movie");
		const tmdbProvider = movieSchema.providers.find((provider) => provider.name === "TMDB");
		assertPresent(tmdbProvider, "Missing TMDB provider for built-in movie schema");

		const [groupSchemaId, personSchemaId, companySchemaId, relationshipSchemas] = yield* Effect.all(
			[
				getBuiltinEntitySchemaSlug(client, "movie-group"),
				getBuiltinEntitySchemaSlug(client, "person"),
				getBuiltinEntitySchemaSlug(client, "company"),
				listRelationshipSchemas(client, {
					slugs: [
						"movie-group-to-movie",
						"person-to-movie",
						"company-to-movie",
						"media-suggestion",
					],
				}),
			],
		);
		const groupToMovie = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"movie-group-to-movie",
		);
		const personToMovie = requireRelationshipSchemaBySlug(relationshipSchemas, "person-to-movie");
		const companyToMovie = requireRelationshipSchemaBySlug(relationshipSchemas, "company-to-movie");
		const suggestion = requireRelationshipSchemaBySlug(relationshipSchemas, "media-suggestion");

		const tmdbId = String(Math.floor(Math.random() * 1_000_000_000));
		const populatedAt = DateTime.formatIso(DateTime.nowUnsafe());
		const api = getApiClient();
		const createGlobalEntity = (input: {
			name: string;
			externalId: string;
			entitySchemaSlug: string;
			properties: Record<string, unknown>;
		}) =>
			api.call(
				(c) =>
					c.testSupport.createGlobalEntity({
						payload: {
							...input,
							populatedAt,
							providerId: SandboxProviderId.make(tmdbProvider.providerId),
							entitySchemaSlug: EntitySchemaSlug.make(input.entitySchemaSlug),
						},
					}),
				adminHeaders(),
			);

		const movie = yield* createGlobalEntity({
			externalId: tmdbId,
			name: options.movieName,
			entitySchemaSlug: movieSchema.id,
			properties: options.movieProperties ?? {},
		});
		const group = yield* createGlobalEntity({
			properties: {},
			name: options.collectionName,
			entitySchemaSlug: groupSchemaId,
			externalId: `movie-group-${tmdbId}`,
		});
		const sibling = yield* createGlobalEntity({
			name: options.siblingName,
			entitySchemaSlug: movieSchema.id,
			externalId: `movie-sibling-${tmdbId}`,
			properties: options.siblingProperties ?? {},
		});
		yield* insertGlobalRelationship({
			properties: { order: 1 },
			targetEntityId: movie.id,
			sourceEntityId: group.id,
			relationshipSchemaSlug: groupToMovie.id,
		});
		yield* insertGlobalRelationship({
			properties: { order: 2 },
			sourceEntityId: group.id,
			targetEntityId: sibling.id,
			relationshipSchemaSlug: groupToMovie.id,
		});

		if (options.withCredits !== true) {
			return { movie, group, sibling, credits: null };
		}

		const person = yield* createGlobalEntity({
			properties: {},
			entitySchemaSlug: personSchemaId,
			name: `Credited Person ${tmdbId}`,
			externalId: `movie-person-${tmdbId}`,
		});
		const company = yield* createGlobalEntity({
			properties: {},
			entitySchemaSlug: companySchemaId,
			name: `Credited Company ${tmdbId}`,
			externalId: `movie-company-${tmdbId}`,
		});
		const suggested = yield* createGlobalEntity({
			properties: {},
			entitySchemaSlug: movieSchema.id,
			name: `Suggested Movie ${tmdbId}`,
			externalId: `movie-suggested-${tmdbId}`,
		});
		yield* insertGlobalRelationship({
			targetEntityId: movie.id,
			sourceEntityId: person.id,
			relationshipSchemaSlug: personToMovie.id,
			properties: { order: 1, roles: ["Actor"], character: "The Lead" },
		});
		yield* insertGlobalRelationship({
			targetEntityId: movie.id,
			sourceEntityId: company.id,
			relationshipSchemaSlug: companyToMovie.id,
			properties: { order: 1, roles: ["Production Company"] },
		});
		yield* insertGlobalRelationship({
			properties: {},
			sourceEntityId: movie.id,
			targetEntityId: suggested.id,
			relationshipSchemaSlug: suggestion.id,
		});
		return { movie, group, sibling, credits: { person, company, suggested } };
	});

export const seedGlobalMusicWithAlbum = (
	client: Client,
	options: {
		readonly trackName: string;
		readonly albumName: string;
		readonly siblingName: string;
		readonly withCredits?: boolean;
		readonly trackProperties?: Record<string, unknown>;
		readonly siblingProperties?: Record<string, unknown>;
	},
) =>
	Effect.gen(function* () {
		const { schema: musicSchema } = yield* findBuiltinSchemaBySlug(client, "music");
		const musicBrainz = musicSchema.providers.find((provider) => provider.name === "MusicBrainz");
		assertPresent(musicBrainz, "Missing MusicBrainz provider for built-in music schema");

		const [albumSchemaId, personSchemaId, companySchemaId, relationshipSchemas] = yield* Effect.all(
			[
				getBuiltinEntitySchemaSlug(client, "music-group"),
				getBuiltinEntitySchemaSlug(client, "person"),
				getBuiltinEntitySchemaSlug(client, "company"),
				listRelationshipSchemas(client, {
					slugs: [
						"music-group-to-music",
						"person-to-music",
						"company-to-music",
						"media-suggestion",
					],
				}),
			],
		);
		const albumToMusic = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"music-group-to-music",
		);
		const personToMusic = requireRelationshipSchemaBySlug(relationshipSchemas, "person-to-music");
		const companyToMusic = requireRelationshipSchemaBySlug(relationshipSchemas, "company-to-music");
		const suggestion = requireRelationshipSchemaBySlug(relationshipSchemas, "media-suggestion");

		const externalId = String(Math.floor(Math.random() * 1_000_000_000));
		const populatedAt = DateTime.formatIso(DateTime.nowUnsafe());
		const api = getApiClient();
		const createGlobalEntity = (input: {
			name: string;
			externalId: string;
			entitySchemaSlug: string;
			properties: Record<string, unknown>;
		}) =>
			api.call(
				(c) =>
					c.testSupport.createGlobalEntity({
						payload: {
							...input,
							populatedAt,
							providerId: SandboxProviderId.make(musicBrainz.providerId),
							entitySchemaSlug: EntitySchemaSlug.make(input.entitySchemaSlug),
						},
					}),
				adminHeaders(),
			);

		const track = yield* createGlobalEntity({
			externalId,
			name: options.trackName,
			entitySchemaSlug: musicSchema.id,
			properties: options.trackProperties ?? {},
		});
		const album = yield* createGlobalEntity({
			properties: {},
			name: options.albumName,
			entitySchemaSlug: albumSchemaId,
			externalId: `music-group-${externalId}`,
		});
		const sibling = yield* createGlobalEntity({
			name: options.siblingName,
			entitySchemaSlug: musicSchema.id,
			externalId: `music-sibling-${externalId}`,
			properties: options.siblingProperties ?? {},
		});
		yield* insertGlobalRelationship({
			properties: { order: 1 },
			targetEntityId: track.id,
			sourceEntityId: album.id,
			relationshipSchemaSlug: albumToMusic.id,
		});
		yield* insertGlobalRelationship({
			properties: { order: 2 },
			sourceEntityId: album.id,
			targetEntityId: sibling.id,
			relationshipSchemaSlug: albumToMusic.id,
		});

		if (options.withCredits !== true) {
			return { track, album, sibling, credits: null };
		}

		const person = yield* createGlobalEntity({
			properties: {},
			entitySchemaSlug: personSchemaId,
			name: `Credited Artist ${externalId}`,
			externalId: `music-person-${externalId}`,
		});
		const company = yield* createGlobalEntity({
			properties: {},
			entitySchemaSlug: companySchemaId,
			name: `Credited Label ${externalId}`,
			externalId: `music-company-${externalId}`,
		});
		const suggested = yield* createGlobalEntity({
			properties: {},
			entitySchemaSlug: musicSchema.id,
			name: `Suggested Track ${externalId}`,
			externalId: `music-suggested-${externalId}`,
		});
		yield* insertGlobalRelationship({
			targetEntityId: track.id,
			sourceEntityId: person.id,
			relationshipSchemaSlug: personToMusic.id,
			properties: { order: 1, roles: ["Artist"] },
		});
		yield* insertGlobalRelationship({
			targetEntityId: track.id,
			sourceEntityId: company.id,
			relationshipSchemaSlug: companyToMusic.id,
			properties: { order: 1, roles: ["Label"] },
		});
		yield* insertGlobalRelationship({
			properties: {},
			sourceEntityId: track.id,
			targetEntityId: suggested.id,
			relationshipSchemaSlug: suggestion.id,
		});
		return { track, album, sibling, credits: { person, company, suggested } };
	});

export const seedGlobalBookWithSeries = (
	client: Client,
	options: {
		readonly bookName: string;
		readonly seriesName: string;
		readonly siblingName: string;
		readonly withCredits?: boolean;
		readonly bookProperties?: Record<string, unknown>;
		readonly siblingProperties?: Record<string, unknown>;
	},
) =>
	Effect.gen(function* () {
		const { schema: bookSchema } = yield* findBuiltinSchemaBySlug(client, "book");
		const hardcover = bookSchema.providers.find((provider) => provider.name === "Hardcover");
		assertPresent(hardcover, "Missing Hardcover provider for built-in book schema");

		const [seriesSchemaId, personSchemaId, companySchemaId, relationshipSchemas] =
			yield* Effect.all([
				getBuiltinEntitySchemaSlug(client, "book-group"),
				getBuiltinEntitySchemaSlug(client, "person"),
				getBuiltinEntitySchemaSlug(client, "company"),
				listRelationshipSchemas(client, {
					slugs: ["book-group-to-book", "person-to-book", "company-to-book", "media-suggestion"],
				}),
			]);
		const seriesToBook = requireRelationshipSchemaBySlug(relationshipSchemas, "book-group-to-book");
		const personToBook = requireRelationshipSchemaBySlug(relationshipSchemas, "person-to-book");
		const companyToBook = requireRelationshipSchemaBySlug(relationshipSchemas, "company-to-book");
		const suggestion = requireRelationshipSchemaBySlug(relationshipSchemas, "media-suggestion");

		const externalId = String(Math.floor(Math.random() * 1_000_000_000));
		const populatedAt = DateTime.formatIso(DateTime.nowUnsafe());
		const api = getApiClient();
		const createGlobalEntity = (input: {
			name: string;
			externalId: string;
			entitySchemaSlug: string;
			properties: Record<string, unknown>;
		}) =>
			api.call(
				(c) =>
					c.testSupport.createGlobalEntity({
						payload: {
							...input,
							populatedAt,
							providerId: SandboxProviderId.make(hardcover.providerId),
							entitySchemaSlug: EntitySchemaSlug.make(input.entitySchemaSlug),
						},
					}),
				adminHeaders(),
			);

		const book = yield* createGlobalEntity({
			externalId,
			name: options.bookName,
			entitySchemaSlug: bookSchema.id,
			properties: options.bookProperties ?? {},
		});
		const series = yield* createGlobalEntity({
			properties: {},
			name: options.seriesName,
			entitySchemaSlug: seriesSchemaId,
			externalId: `book-group-${externalId}`,
		});
		const sibling = yield* createGlobalEntity({
			name: options.siblingName,
			entitySchemaSlug: bookSchema.id,
			externalId: `book-sibling-${externalId}`,
			properties: options.siblingProperties ?? {},
		});
		yield* insertGlobalRelationship({
			targetEntityId: book.id,
			properties: { order: 1 },
			sourceEntityId: series.id,
			relationshipSchemaSlug: seriesToBook.id,
		});
		yield* insertGlobalRelationship({
			properties: { order: 2 },
			sourceEntityId: series.id,
			targetEntityId: sibling.id,
			relationshipSchemaSlug: seriesToBook.id,
		});

		if (options.withCredits !== true) {
			return { book, series, sibling, credits: null };
		}

		const person = yield* createGlobalEntity({
			properties: {},
			entitySchemaSlug: personSchemaId,
			name: `Credited Author ${externalId}`,
			externalId: `book-person-${externalId}`,
		});
		const company = yield* createGlobalEntity({
			properties: {},
			entitySchemaSlug: companySchemaId,
			name: `Credited Publisher ${externalId}`,
			externalId: `book-company-${externalId}`,
		});
		const suggested = yield* createGlobalEntity({
			properties: {},
			entitySchemaSlug: bookSchema.id,
			name: `Suggested Book ${externalId}`,
			externalId: `book-suggested-${externalId}`,
		});
		yield* insertGlobalRelationship({
			targetEntityId: book.id,
			sourceEntityId: person.id,
			relationshipSchemaSlug: personToBook.id,
			properties: { order: 1, roles: ["Author"] },
		});
		yield* insertGlobalRelationship({
			targetEntityId: book.id,
			sourceEntityId: company.id,
			relationshipSchemaSlug: companyToBook.id,
			properties: { order: 1, roles: ["Publisher"] },
		});
		yield* insertGlobalRelationship({
			properties: {},
			sourceEntityId: book.id,
			targetEntityId: suggested.id,
			relationshipSchemaSlug: suggestion.id,
		});
		return { book, series, sibling, credits: { person, company, suggested } };
	});

export const insertLibraryMembership = (
	client: Client,
	input: { mediaEntityId: string; properties?: Record<string, unknown> },
) =>
	Effect.gen(function* () {
		const mediaLibraryEntityId = yield* getMediaLibraryEntityId(client);

		const schemas = yield* listRelationshipSchemas(client, { slugs: ["in-media-library"] });
		const inMediaLibrarySchema = requireRelationshipSchemaBySlug(schemas, "in-media-library");

		yield* createRelationship(client, {
			properties: input.properties ?? {},
			relationshipSchemaSlug: inMediaLibrarySchema.id,
			sourceEntityId: EntityId.make(input.mediaEntityId),
			targetEntityId: EntityId.make(mediaLibraryEntityId),
		});
	});

export const insertMediaMonitoring = (client: Client, entityId: string) =>
	Effect.gen(function* () {
		const mediaLibraryEntityId = yield* getMediaLibraryEntityId(client);
		const schemas = yield* listRelationshipSchemas(client, { slugs: ["media-monitoring"] });
		const monitoringSchema = requireRelationshipSchemaBySlug(schemas, "media-monitoring");

		yield* createRelationship(client, {
			properties: {},
			sourceEntityId: EntityId.make(entityId),
			relationshipSchemaSlug: monitoringSchema.id,
			targetEntityId: EntityId.make(mediaLibraryEntityId),
		});
	});

const getMediaLibraryEntityId = (client: Client) =>
	Effect.gen(function* () {
		const mediaLibrary = table("entity", "mediaLibrary");
		const result = yield* executeRyotQL(
			client,
			document({
				libraries: rows(mediaLibrary, {
					limit: 1,
					fields: [field("id", column(mediaLibrary, "id"))],
					where: eq(column(mediaLibrary, "entitySchemaSlug"), literal("media-library")),
				}),
			}),
		);
		const libraries = requireRows(result.data.libraries, "libraries");
		return requireRyotQLText(requirePresent(libraries.items[0], "Missing library entity"), "id");
	});
