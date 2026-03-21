import {
	EntityId,
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	SandboxProviderId,
} from "@ryot/contract/schema/brands";
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
} from "@ryot/ryotql";
import { DateTime, Effect } from "effect";

import { assertPresent, requirePresent, requireString } from "~/support/assertions";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getBackendClient } from "./contract-client";
import {
	findBuiltinSchemaBySlug,
	findBuiltinSchemaWithProviders,
	getBuiltinEntitySchemaSlug,
	makeEntitySchemaSlug,
} from "./entity-schemas";
import { pollUntil } from "./polling";
import { listRelationshipSchemas, requireRelationshipSchemaBySlug } from "./relationship-schemas";
import { createRelationship } from "./relationships";
import { executeRyotQL, requireRyotQLFieldValue, requireRyotQLTextField } from "./ryotql";

export const insertRelationshipRow = (
	client: Client,
	input: {
		sourceEntityId: string;
		targetEntityId: string;
		relationshipSchemaSlug: string;
		properties?: Record<string, unknown>;
	},
) =>
	createRelationship(client, {
		properties: input.properties,
		sourceEntityId: EntityId.make(input.sourceEntityId),
		targetEntityId: EntityId.make(input.targetEntityId),
		relationshipSchemaSlug: RelationshipSchemaSlug.make(input.relationshipSchemaSlug),
	});

export const queryInLibraryRelationship = (
	client: Client,
	entityId: string,
	entitySchemaSlug: string,
) => {
	const entity = table("entity", "entity");
	const membership = table("relationship", "membership");
	const library = table("entity", "library");
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
							eq(column(membership, "relationshipSchemaSlug"), literal("in-library")),
							eq(column(existingLibrary, "entitySchemaSlug"), literal("library")),
						),
					}),
				),
				include: [
					include(membership, {
						key: "libraries",
						limit: 1,
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
						orderBy: [ascending(column(membership, "id"))],
						where: and(
							eq(column(membership, "sourceEntityId"), column(entity, "id")),
							eq(column(membership, "relationshipSchemaSlug"), literal("in-library")),
						),
						joins: [
							join(
								"inner",
								library,
								eq(column(membership, "targetEntityId"), column(library, "id")),
							),
						],
					}),
				],
			}),
		}),
	);
};

export const getGlobalEntityByProvenance = (
	client: Client,
	input: { externalId: string; providerId: string; entitySchemaSlug: string },
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
						isNull(column(entity, "userId")),
					),
				}),
			}),
		);
		const entities = result.data.entities;
		if (entities?.type !== "rows") {
			throw new Error("Expected global entity rows");
		}
		const entityRow = requirePresent(
			entities.items[0],
			`Missing global entity for external id '${input.externalId}'`,
		);
		const populatedAt = requireRyotQLFieldValue(entityRow, "populatedAt");
		return {
			id: requireRyotQLTextField(entityRow, "id"),
			name: requireRyotQLTextField(entityRow, "name"),
			populatedAt:
				populatedAt.kind === "null"
					? null
					: requireString(populatedAt.value, "Expected 'populatedAt' to contain text"),
		};
	});

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
		const relationships = yield* getBackendClient().call(
			(c) =>
				c.testSupport.listGlobalRelationships({
					payload: {
						type: "anchored",
						direction: "outgoing",
						anchorEntityId: EntityId.make(input.sourceEntityId),
						relationshipSchemaSlug: RelationshipSchemaSlug.make(relationshipSchema.id),
					},
				}),
			adminHeaders,
		);

		const relationship = requirePresent(
			relationships.find((item) => item.targetEntityId === input.targetEntityId),
			`Missing relationship '${input.relationshipSchemaSlug}' for '${input.sourceEntityId}' -> '${input.targetEntityId}'`,
		);
		return {
			properties: relationship.properties,
			sourceEntityId: String(relationship.sourceEntityId),
			targetEntityId: String(relationship.targetEntityId),
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
		const entity = input.userId
			? yield* requirePresent(
					input.client,
					"Client is required for user-scoped entity seeding",
				).call((c) =>
					c.entities.create({
						payload: {
							entitySchemaSlug,
							providerId,
							name: input.name,
							properties: input.properties,
							externalId: input.externalId,
						},
					}),
				)
			: yield* getBackendClient().call(
					(c) =>
						c.testSupport.createGlobalEntity({
							payload: {
								entitySchemaSlug,
								providerId,
								name: input.name,
								properties: input.properties,
								externalId: input.externalId,
							},
						}),
					adminHeaders,
				);

		return {
			id: entity.id,
			name: input.name,
			userId: input.userId ?? null,
			properties: input.properties,
			externalId: input.externalId,
			entitySchemaSlug: entity.entitySchemaSlug,
			providerId: input.providerId,
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
			providerId: requirePresent(schema.providers[0]?.providerId, "Missing book provider"),
			name: options.name ?? `Global Built-in Book ${crypto.randomUUID()}`,
			externalId: options.externalId ?? `global-book-${crypto.randomUUID()}`,
		});
		return { entity, schema };
	});

export const seedGlobalShowEpisodeTree = (client: Client, options: { showName: string }) =>
	Effect.gen(function* () {
		const { schema: showSchema } = yield* findBuiltinSchemaBySlug(client, "show");
		const tmdbProvider = showSchema.providers.find((provider) => provider.name === "TMDB");
		assertPresent(tmdbProvider, "Missing TMDB provider for built-in show schema");

		const [seasonSchemaId, episodeSchemaId, relationshipSchemas] = yield* Effect.all([
			getBuiltinEntitySchemaSlug("show-season"),
			getBuiltinEntitySchemaSlug("show-episode"),
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
		const backend = getBackendClient();
		const createGlobalEntity = (input: {
			name: string;
			externalId: string;
			entitySchemaSlug: string;
			properties: Record<string, unknown>;
		}) =>
			backend.call(
				(c) =>
					c.testSupport.createGlobalEntity({
						payload: {
							...input,
							populatedAt,
							entitySchemaSlug: EntitySchemaSlug.make(input.entitySchemaSlug),
							providerId: SandboxProviderId.make(tmdbProvider.providerId),
						},
					}),
				adminHeaders,
			);
		const show = yield* createGlobalEntity({
			name: options.showName,
			externalId: tmdbId,
			entitySchemaSlug: showSchema.id,
			properties: { totalSeasons: 1, totalEpisodes: 1 },
		});
		const season = yield* createGlobalEntity({
			name: "Season 1",
			externalId: `season-${tmdbId}`,
			entitySchemaSlug: seasonSchemaId,
			properties: { seasonNumber: 1 },
		});
		const episode = yield* createGlobalEntity({
			name: "Episode 2",
			externalId: `episode-${tmdbId}`,
			entitySchemaSlug: episodeSchemaId,
			properties: { seasonNumber: 1, episodeNumber: 2 },
		});
		yield* backend.call(
			(c) =>
				c.testSupport.upsertGlobalRelationship({
					payload: {
						sourceEntityId: show.id,
						targetEntityId: season.id,
						relationshipSchemaSlug: RelationshipSchemaSlug.make(showToSeason.id),
					},
				}),
			adminHeaders,
		);
		yield* backend.call(
			(c) =>
				c.testSupport.upsertGlobalRelationship({
					payload: {
						sourceEntityId: season.id,
						targetEntityId: episode.id,
						relationshipSchemaSlug: RelationshipSchemaSlug.make(seasonToEpisode.id),
					},
				}),
			adminHeaders,
		);

		return { tmdbId, showId: show.id, seasonId: season.id, episodeId: episode.id };
	});

export const insertLibraryMembership = (
	client: Client,
	input: { mediaEntityId: string; properties?: Record<string, unknown> },
) =>
	Effect.gen(function* () {
		const libraryEntityId = yield* getLibraryEntityId(client);

		const schemas = yield* listRelationshipSchemas(client, { slugs: ["in-library"] });
		const inLibrarySchema = requireRelationshipSchemaBySlug(schemas, "in-library");

		yield* createRelationship(client, {
			properties: input.properties ?? {},
			relationshipSchemaSlug: inLibrarySchema.id,
			targetEntityId: EntityId.make(libraryEntityId),
			sourceEntityId: EntityId.make(input.mediaEntityId),
		});
	});

export const insertMediaMonitoring = (client: Client, entityId: string) =>
	Effect.gen(function* () {
		const libraryEntityId = yield* getLibraryEntityId(client);
		const schemas = yield* listRelationshipSchemas(client, { slugs: ["media-monitoring"] });
		const monitoringSchema = requireRelationshipSchemaBySlug(schemas, "media-monitoring");

		yield* createRelationship(client, {
			properties: {},
			targetEntityId: EntityId.make(libraryEntityId),
			sourceEntityId: EntityId.make(entityId),
			relationshipSchemaSlug: monitoringSchema.id,
		});
	});

const getLibraryEntityId = (client: Client) =>
	Effect.gen(function* () {
		const library = table("entity", "library");
		const result = yield* executeRyotQL(
			client,
			document({
				libraries: rows(library, {
					limit: 1,
					fields: [field("id", column(library, "id"))],
					where: eq(column(library, "entitySchemaSlug"), literal("library")),
				}),
			}),
		);
		const libraries = result.data.libraries;
		if (libraries?.type !== "rows") {
			throw new Error("Expected library rows");
		}
		return requireRyotQLTextField(
			requirePresent(libraries.items[0], "Missing library entity"),
			"id",
		);
	});
