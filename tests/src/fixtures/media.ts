import {
	EntityId,
	EntitySchemaSlug,
	RelationshipSchemaSlug,
	SandboxProviderId,
} from "@ryot/contract/schema/brands";
import { queryEngineEntitySource } from "@ryot/query-engine/documents";
import {
	queryEngineAnd,
	queryEngineComparison,
	queryEngineExists,
	queryEngineField,
	queryEngineIsNull,
	queryEngineLiteral,
	queryEnginePropertyRef,
	queryEngineSystemRef,
} from "@ryot/query-engine/primitives";
import { DateTime, Effect } from "effect";

import { assertPresent, requirePresent } from "~/support/assertions";

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
import {
	buildEntityRowsQueryDocument,
	executeQueryEngine,
	getQueryEngineTextFieldOrNull,
	requireQueryEngineTextField,
} from "./query-engine-core";
import { listRelationshipSchemas, requireRelationshipSchemaBySlug } from "./relationship-schemas";
import { createRelationship } from "./relationships";

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
) =>
	executeQueryEngine(
		client,
		buildEntityRowsQueryDocument({
			limit: 1,
			alias: "entity",
			schemas: [entitySchemaSlug],
			fields: [queryEngineField("id", queryEngineSystemRef("entity", "id"))],
			include: [
				{
					limit: 1,
					key: "libraries",
					fields: [
						queryEngineField("owned", queryEnginePropertyRef("inLibrary", "in-library", "owned")),
						queryEngineField(
							"ownershipSources",
							queryEnginePropertyRef("inLibrary", "in-library", "ownershipSources"),
						),
						queryEngineField(
							"ownershipSyncedAt",
							queryEnginePropertyRef("inLibrary", "in-library", "ownershipSyncedAt"),
						),
					],
					orderBy: [{ order: "asc", expr: queryEngineSystemRef("library", "id") }],
					source: {
						where: null,
						alias: "library",
						type: "entities",
						schemas: ["library"],
						via: {
							alias: "inLibrary",
							entityRef: "entity",
							schema: "in-library",
							direction: "outgoing" as const,
						},
					},
				},
			],
			where: queryEngineAnd(
				queryEngineComparison(
					"eq",
					queryEngineSystemRef("entity", "id"),
					queryEngineLiteral(entityId),
				),
				queryEngineExists(
					queryEngineEntitySource({
						where: null,
						schemas: ["library"],
						alias: "membershipLibrary",
						via: {
							entityRef: "entity",
							schema: "in-library",
							alias: "membershipEdge",
							direction: "outgoing" as const,
						},
					}),
				),
			),
		}),
	);

export const getGlobalEntityByProvenance = (
	client: Client,
	input: { externalId: string; providerId: string; entitySchemaSlug: string },
) =>
	Effect.gen(function* () {
		const result = yield* executeQueryEngine(
			client,
			buildEntityRowsQueryDocument({
				limit: 1,
				alias: "entity",
				schemas: [input.entitySchemaSlug],
				fields: [
					queryEngineField("id", queryEngineSystemRef("entity", "id")),
					queryEngineField("name", queryEngineSystemRef("entity", "name")),
					queryEngineField("populatedAt", queryEngineSystemRef("entity", "populatedAt")),
				],
				where: queryEngineAnd(
					queryEngineComparison(
						"eq",
						queryEngineSystemRef("entity", "externalId"),
						queryEngineLiteral(input.externalId),
					),
					queryEngineComparison(
						"eq",
						queryEngineSystemRef("entity", "providerId"),
						queryEngineLiteral(input.providerId),
					),
					queryEngineIsNull(queryEngineSystemRef("entity", "userId")),
				),
			}),
		);
		const entity = requirePresent(
			result.data.items[0],
			`Missing global entity for external id '${input.externalId}'`,
		);
		return {
			id: requireQueryEngineTextField(entity, "id"),
			name: requireQueryEngineTextField(entity, "name"),
			populatedAt: getQueryEngineTextFieldOrNull(entity, "populatedAt"),
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
		const libraryResult = yield* executeQueryEngine(
			client,
			buildEntityRowsQueryDocument({
				limit: 1,
				alias: "library",
				schemas: ["library"],
				fields: [queryEngineField("id", queryEngineSystemRef("library", "id"))],
			}),
		);
		const libraryEntity = requirePresent(libraryResult.data.items[0], "Missing library entity");
		const libraryEntityId = requireQueryEngineTextField(libraryEntity, "id");

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
		const libraryResult = yield* executeQueryEngine(
			client,
			buildEntityRowsQueryDocument({
				limit: 1,
				alias: "library",
				schemas: ["library"],
				fields: [queryEngineField("id", queryEngineSystemRef("library", "id"))],
			}),
		);
		const libraryEntity = requirePresent(libraryResult.data.items[0], "Missing library entity");
		const libraryEntityId = requireQueryEngineTextField(libraryEntity, "id");
		const schemas = yield* listRelationshipSchemas(client, { slugs: ["media-monitoring"] });
		const monitoringSchema = requireRelationshipSchemaBySlug(schemas, "media-monitoring");

		yield* createRelationship(client, {
			properties: {},
			targetEntityId: EntityId.make(libraryEntityId),
			sourceEntityId: EntityId.make(entityId),
			relationshipSchemaSlug: monitoringSchema.id,
		});
	});
