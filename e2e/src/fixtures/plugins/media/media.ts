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
						limit: 1,
						key: "libraries",
						orderBy: [ascending(column(membership, "id"))],
						joins: [
							join(
								"inner",
								library,
								eq(column(membership, "targetEntityId"), column(library, "id")),
							),
						],
						where: and(
							eq(column(membership, "sourceEntityId"), column(entity, "id")),
							eq(column(membership, "relationshipSchemaSlug"), literal("in-library")),
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
		const entity = input.userId
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

		return {
			id: entity.id,
			name: input.name,
			userId: input.userId ?? null,
			properties: input.properties,
			externalId: input.externalId,
			providerId: input.providerId,
			entitySchemaSlug: entity.entitySchemaSlug,
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
			sourceEntityId: EntityId.make(entityId),
			relationshipSchemaSlug: monitoringSchema.id,
			targetEntityId: EntityId.make(libraryEntityId),
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
		const libraries = requireRows(result.data.libraries, "libraries");
		return requireRyotQLText(requirePresent(libraries.items[0], "Missing library entity"), "id");
	});
