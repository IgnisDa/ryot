import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntityId, EntitySchemaSlug, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { mediaPlugin } from "@ryot-app/media-plugin";
import {
	and,
	ascending,
	column,
	document,
	eq,
	exists,
	field,
	include,
	join,
	jsonPath,
	literal,
	rows,
	table,
} from "@ryot-app/ryotql";
import { DateTime, Effect } from "effect";

import { adminHeaders } from "~/fixtures/kernel/admin";
import { listAdminSystemPlugins } from "~/fixtures/kernel/admin-system-plugins";
import type { Client } from "~/fixtures/kernel/auth";
import { getApiClient } from "~/fixtures/kernel/contract-client";
import { getEntity, seedEntity } from "~/fixtures/kernel/entities";
import { insertGlobalRelationship } from "~/fixtures/kernel/entity-graph";
import { getBuiltinEntitySchemaSlug, makeEntitySchemaSlug } from "~/fixtures/kernel/entity-schemas";
import {
	listRelationshipSchemas,
	requireRelationshipSchemaBySlug,
} from "~/fixtures/kernel/relationship-schemas";
import { createRelationship } from "~/fixtures/kernel/relationships";
import { executeRyotQL, requireRows, requireRyotQLText } from "~/fixtures/kernel/ryotql";
import { assertPresent, requirePresent } from "~/support/assertions";

import {
	findBuiltinSchemaWithProviders,
	findMediaEntitySchema,
	mediaFixtureInstallation,
} from "./entity-schemas";

export const queryInMediaLibraryRelationship = (
	client: Client,
	entityId: string,
	entitySchemaSlug: string,
) => {
	return Effect.gen(function* () {
		const selectedEntity = yield* getEntity(client, entityId);
		const mediaPluginId = (yield* mediaFixtureInstallation).id;
		const entity = table("entity", "entity");
		const membership = table("relationship", "membership");
		const mediaLibrary = table("entity", "mediaLibrary");
		const existingLibrary = table("entity", "existingLibrary");
		return yield* executeRyotQL(
			client,
			document({
				entity: rows(entity, {
					limit: 1,
					fields: [field("id", column(entity, "id"))],
					where: and(
						eq(column(entity, "id"), literal(entityId)),
						eq(column(entity, "entitySchemaSlug"), literal(entitySchemaSlug)),
						eq(
							column(entity, "entitySchemaPluginId"),
							literal(selectedEntity.entitySchemaPluginId),
						),
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
								eq(column(membership, "relationshipSchemaPluginId"), literal(mediaPluginId)),
								eq(column(existingLibrary, "entitySchemaSlug"), literal("media-library")),
								eq(column(existingLibrary, "entitySchemaPluginId"), literal(mediaPluginId)),
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
								eq(column(membership, "relationshipSchemaPluginId"), literal(mediaPluginId)),
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
	});
};

export const seedMediaEntity = (
	input: Omit<Parameters<typeof seedEntity>[0], "entitySchema"> & { entitySchemaSlug: string },
) =>
	Effect.gen(function* () {
		const { entitySchemaSlug, ...rest } = input;
		const plugin = requirePresent(
			(yield* listAdminSystemPlugins).find(
				({ packageId }) => packageId === mediaPlugin.metadata.packageId,
			),
			"System media plugin missing",
		);
		return yield* seedEntity({
			...rest,
			entitySchema: {
				owner: definitionOwner(plugin.id),
				slug: makeEntitySchemaSlug(entitySchemaSlug),
			},
		});
	});

type SeededEpisodeInput = {
	readonly episodeNumber: number;
	readonly publishDate: string;
	readonly images?: readonly Record<string, unknown>[];
};

/** A library show whose seasons hold the given episodes; returns the show and its episodes. */
export const seedLibraryShowEpisodes = (
	client: Client,
	input: {
		readonly name: string;
		readonly inLibrary?: boolean;
		readonly images?: readonly Record<string, unknown>[];
		readonly seasons: readonly {
			readonly seasonNumber: number;
			readonly episodes: readonly SeededEpisodeInput[];
		}[];
	},
) =>
	Effect.gen(function* () {
		const [show, season, episode] = yield* Effect.all([
			findMediaEntitySchema(client, "show"),
			findMediaEntitySchema(client, "show-season"),
			findMediaEntitySchema(client, "show-episode"),
		]);
		const relationshipSchemas = yield* listRelationshipSchemas(client, {
			owner: show.schema.reference.owner,
			slugs: ["show-to-show-season", "show-season-to-show-episode"],
		});
		const suffix = crypto.randomUUID();
		const seeded = yield* seedMediaEntity({
			userId: null,
			providerId: null,
			name: input.name,
			entitySchemaSlug: show.schema.id,
			externalId: `calendar-show-${suffix}`,
			properties: { images: input.images ?? [] },
		});
		if (input.inLibrary !== false) {
			yield* insertLibraryMembership(client, { mediaEntityId: seeded.id });
		}
		const episodes = [];
		for (const { seasonNumber, episodes: seasonEpisodes } of input.seasons) {
			const seasonEntity = yield* seedMediaEntity({
				userId: null,
				providerId: null,
				properties: { seasonNumber },
				entitySchemaSlug: season.schema.id,
				name: `${input.name} S${seasonNumber}`,
				externalId: `calendar-season-${seasonNumber}-${suffix}`,
			});
			yield* insertGlobalRelationship({
				sourceEntityId: seeded.id,
				targetEntityId: seasonEntity.id,
				relationshipSchema: requireRelationshipSchemaBySlug(
					relationshipSchemas,
					"show-to-show-season",
					show.schema.reference.owner,
				).reference,
			});
			for (const { images, publishDate, episodeNumber } of seasonEpisodes) {
				const episodeEntity = yield* seedMediaEntity({
					userId: null,
					providerId: null,
					entitySchemaSlug: episode.schema.id,
					name: `${input.name} S${seasonNumber}E${episodeNumber}`,
					externalId: `calendar-episode-${seasonNumber}-${episodeNumber}-${suffix}`,
					properties: { publishDate, seasonNumber, episodeNumber, images: images ?? [] },
				});
				yield* insertGlobalRelationship({
					sourceEntityId: seasonEntity.id,
					targetEntityId: episodeEntity.id,
					relationshipSchema: requireRelationshipSchemaBySlug(
						relationshipSchemas,
						"show-season-to-show-episode",
						show.schema.reference.owner,
					).reference,
				});
				episodes.push({ seasonNumber, episodeNumber, id: episodeEntity.id });
			}
		}
		return { episodes, show: seeded };
	});

/** A library podcast holding the given episodes; returns the podcast and its episodes. */
export const seedLibraryPodcastEpisodes = (
	client: Client,
	input: {
		readonly name: string;
		readonly images?: readonly Record<string, unknown>[];
		readonly episodes: readonly SeededEpisodeInput[];
	},
) =>
	Effect.gen(function* () {
		const [podcast, episode] = yield* Effect.all([
			findMediaEntitySchema(client, "podcast"),
			findMediaEntitySchema(client, "podcast-episode"),
		]);
		const relationshipSchemas = yield* listRelationshipSchemas(client, {
			owner: podcast.schema.reference.owner,
			slugs: ["podcast-to-podcast-episode"],
		});
		const relationshipSchema = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"podcast-to-podcast-episode",
			podcast.schema.reference.owner,
		).reference;
		const suffix = crypto.randomUUID();
		const seeded = yield* seedMediaEntity({
			userId: null,
			providerId: null,
			name: input.name,
			entitySchemaSlug: podcast.schema.id,
			externalId: `calendar-podcast-${suffix}`,
			properties: { images: input.images ?? [] },
		});
		yield* insertLibraryMembership(client, { mediaEntityId: seeded.id });
		const episodes = [];
		for (const { images, publishDate, episodeNumber } of input.episodes) {
			const episodeEntity = yield* seedMediaEntity({
				userId: null,
				providerId: null,
				entitySchemaSlug: episode.schema.id,
				name: `${input.name} E${episodeNumber}`,
				properties: { publishDate, episodeNumber, images: images ?? [] },
				externalId: `calendar-podcast-episode-${episodeNumber}-${suffix}`,
			});
			yield* insertGlobalRelationship({
				relationshipSchema,
				sourceEntityId: seeded.id,
				targetEntityId: episodeEntity.id,
			});
			episodes.push({ episodeNumber, id: episodeEntity.id });
		}
		return { episodes, podcast: seeded };
	});

export const createGlobalBookEntityFixture = (
	client: Client,
	options: { name?: string; externalId?: string } = {},
) =>
	Effect.gen(function* () {
		const { schema, pluginId } = yield* findBuiltinSchemaWithProviders(client);
		const entity = yield* seedMediaEntity({
			userId: null,
			properties: {},
			entitySchemaSlug: schema.id,
			name: options.name ?? `Global Built-in Book ${crypto.randomUUID()}`,
			externalId: options.externalId ?? `global-book-${crypto.randomUUID()}`,
			providerId: requirePresent(schema.providers[0]?.providerId, "Missing book provider"),
		});
		return { entity, schema, pluginId };
	});

export const seedGlobalShowEpisodeTree = (
	client: Client,
	options: { showName: string; showProperties?: Record<string, unknown> },
) =>
	Effect.gen(function* () {
		const { schema: showSchema } = yield* findMediaEntitySchema(client, "show");
		const tmdbProvider = showSchema.providers.find((provider) => provider.name === "TMDB");
		assertPresent(tmdbProvider, "Missing TMDB provider for built-in show schema");

		const [seasonSchemaId, episodeSchemaId, relationshipSchemas] = yield* Effect.all([
			getBuiltinEntitySchemaSlug(client, "show-season", showSchema.reference.owner),
			getBuiltinEntitySchemaSlug(client, "show-episode", showSchema.reference.owner),
			listRelationshipSchemas(client, {
				slugs: ["show-to-show-season", "show-season-to-show-episode"],
			}),
		]);
		const showToSeason = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"show-to-show-season",
			showSchema.reference.owner,
		);
		const seasonToEpisode = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"show-season-to-show-episode",
			showSchema.reference.owner,
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
							populatedAt,
							name: input.name,
							externalId: input.externalId,
							properties: input.properties,
							providerId: SandboxProviderId.make(tmdbProvider.providerId),
							entitySchema: {
								owner: showSchema.reference.owner,
								slug: EntitySchemaSlug.make(input.entitySchemaSlug),
							},
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
						relationshipSchema: showToSeason.reference,
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
						relationshipSchema: seasonToEpisode.reference,
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
		const { schema: movieSchema } = yield* findMediaEntitySchema(client, "movie");
		const tmdbProvider = movieSchema.providers.find((provider) => provider.name === "TMDB");
		assertPresent(tmdbProvider, "Missing TMDB provider for built-in movie schema");

		const [groupSchemaId, personSchemaId, companySchemaId, relationshipSchemas] = yield* Effect.all(
			[
				getBuiltinEntitySchemaSlug(client, "movie-group", movieSchema.reference.owner),
				getBuiltinEntitySchemaSlug(client, "person", movieSchema.reference.owner),
				getBuiltinEntitySchemaSlug(client, "company", movieSchema.reference.owner),
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
			movieSchema.reference.owner,
		);
		const personToMovie = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"person-to-movie",
			movieSchema.reference.owner,
		);
		const companyToMovie = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"company-to-movie",
			movieSchema.reference.owner,
		);
		const suggestion = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"media-suggestion",
			movieSchema.reference.owner,
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
							populatedAt,
							name: input.name,
							externalId: input.externalId,
							properties: input.properties,
							providerId: SandboxProviderId.make(tmdbProvider.providerId),
							entitySchema: {
								owner: movieSchema.reference.owner,
								slug: EntitySchemaSlug.make(input.entitySchemaSlug),
							},
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
			relationshipSchema: groupToMovie.reference,
		});
		yield* insertGlobalRelationship({
			properties: { order: 2 },
			sourceEntityId: group.id,
			targetEntityId: sibling.id,
			relationshipSchema: groupToMovie.reference,
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
			relationshipSchema: personToMovie.reference,
			properties: { order: 1, roles: ["Actor"], character: "The Lead" },
		});
		yield* insertGlobalRelationship({
			targetEntityId: movie.id,
			sourceEntityId: company.id,
			relationshipSchema: companyToMovie.reference,
			properties: { order: 1, roles: ["Production Company"] },
		});
		yield* insertGlobalRelationship({
			properties: {},
			sourceEntityId: movie.id,
			targetEntityId: suggested.id,
			relationshipSchema: suggestion.reference,
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
		const { schema: musicSchema } = yield* findMediaEntitySchema(client, "music");
		const musicBrainz = musicSchema.providers.find((provider) => provider.name === "MusicBrainz");
		assertPresent(musicBrainz, "Missing MusicBrainz provider for built-in music schema");

		const [albumSchemaId, personSchemaId, companySchemaId, relationshipSchemas] = yield* Effect.all(
			[
				getBuiltinEntitySchemaSlug(client, "music-group", musicSchema.reference.owner),
				getBuiltinEntitySchemaSlug(client, "person", musicSchema.reference.owner),
				getBuiltinEntitySchemaSlug(client, "company", musicSchema.reference.owner),
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
			musicSchema.reference.owner,
		);
		const personToMusic = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"person-to-music",
			musicSchema.reference.owner,
		);
		const companyToMusic = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"company-to-music",
			musicSchema.reference.owner,
		);
		const suggestion = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"media-suggestion",
			musicSchema.reference.owner,
		);

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
							populatedAt,
							name: input.name,
							externalId: input.externalId,
							properties: input.properties,
							providerId: SandboxProviderId.make(musicBrainz.providerId),
							entitySchema: {
								owner: musicSchema.reference.owner,
								slug: EntitySchemaSlug.make(input.entitySchemaSlug),
							},
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
			relationshipSchema: albumToMusic.reference,
		});
		yield* insertGlobalRelationship({
			properties: { order: 2 },
			sourceEntityId: album.id,
			targetEntityId: sibling.id,
			relationshipSchema: albumToMusic.reference,
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
			relationshipSchema: personToMusic.reference,
			properties: { order: 1, roles: ["Artist"] },
		});
		yield* insertGlobalRelationship({
			targetEntityId: track.id,
			sourceEntityId: company.id,
			properties: { order: 1, roles: ["Label"] },
			relationshipSchema: companyToMusic.reference,
		});
		yield* insertGlobalRelationship({
			properties: {},
			sourceEntityId: track.id,
			targetEntityId: suggested.id,
			relationshipSchema: suggestion.reference,
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
		const { schema: bookSchema } = yield* findMediaEntitySchema(client, "book");
		const hardcover = bookSchema.providers.find((provider) => provider.name === "Hardcover");
		assertPresent(hardcover, "Missing Hardcover provider for built-in book schema");

		const [seriesSchemaId, personSchemaId, companySchemaId, relationshipSchemas] =
			yield* Effect.all([
				getBuiltinEntitySchemaSlug(client, "book-group", bookSchema.reference.owner),
				getBuiltinEntitySchemaSlug(client, "person", bookSchema.reference.owner),
				getBuiltinEntitySchemaSlug(client, "company", bookSchema.reference.owner),
				listRelationshipSchemas(client, {
					slugs: ["book-group-to-book", "person-to-book", "company-to-book", "media-suggestion"],
				}),
			]);
		const seriesToBook = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"book-group-to-book",
			bookSchema.reference.owner,
		);
		const personToBook = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"person-to-book",
			bookSchema.reference.owner,
		);
		const companyToBook = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"company-to-book",
			bookSchema.reference.owner,
		);
		const suggestion = requireRelationshipSchemaBySlug(
			relationshipSchemas,
			"media-suggestion",
			bookSchema.reference.owner,
		);

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
							populatedAt,
							name: input.name,
							externalId: input.externalId,
							properties: input.properties,
							providerId: SandboxProviderId.make(hardcover.providerId),
							entitySchema: {
								owner: bookSchema.reference.owner,
								slug: EntitySchemaSlug.make(input.entitySchemaSlug),
							},
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
			relationshipSchema: seriesToBook.reference,
		});
		yield* insertGlobalRelationship({
			properties: { order: 2 },
			sourceEntityId: series.id,
			targetEntityId: sibling.id,
			relationshipSchema: seriesToBook.reference,
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
			relationshipSchema: personToBook.reference,
			properties: { order: 1, roles: ["Author"] },
		});
		yield* insertGlobalRelationship({
			targetEntityId: book.id,
			sourceEntityId: company.id,
			relationshipSchema: companyToBook.reference,
			properties: { order: 1, roles: ["Publisher"] },
		});
		yield* insertGlobalRelationship({
			properties: {},
			sourceEntityId: book.id,
			targetEntityId: suggested.id,
			relationshipSchema: suggestion.reference,
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
		const inMediaLibrarySchema = requireRelationshipSchemaBySlug(
			schemas,
			"in-media-library",
			definitionOwner((yield* mediaFixtureInstallation).id),
		);

		yield* createRelationship(client, {
			properties: input.properties ?? {},
			relationshipSchema: inMediaLibrarySchema.reference,
			sourceEntityId: EntityId.make(input.mediaEntityId),
			targetEntityId: EntityId.make(mediaLibraryEntityId),
		});
	});

export const insertMediaMonitoring = (client: Client, entityId: string) =>
	Effect.gen(function* () {
		const mediaLibraryEntityId = yield* getMediaLibraryEntityId(client);
		const schemas = yield* listRelationshipSchemas(client, { slugs: ["media-monitoring"] });
		const monitoringSchema = requireRelationshipSchemaBySlug(
			schemas,
			"media-monitoring",
			definitionOwner((yield* mediaFixtureInstallation).id),
		);

		yield* createRelationship(client, {
			properties: {},
			sourceEntityId: EntityId.make(entityId),
			relationshipSchema: monitoringSchema.reference,
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
