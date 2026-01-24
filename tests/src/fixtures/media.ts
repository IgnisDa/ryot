import {
	EntityId,
	EntitySchemaId,
	RelationshipSchemaId,
	SandboxScriptId,
} from "@ryot/contract/schema/brands";
import {
	queryEngineAnd,
	queryEngineComparison,
	queryEngineEntitySource,
	queryEngineExists,
	queryEngineField,
	queryEngineIsNull,
	queryEngineLiteral,
	queryEngineSystemRef,
} from "@ryot/query-engine";

import { assertPresent, requirePresent } from "~/support/assertions";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getBackendClient } from "./contract-client";
import {
	findBuiltinSchemaBySlug,
	findBuiltinSchemaWithProviders,
	getBuiltinEntitySchemaId,
	getFirstProviderScriptId,
} from "./entity-schemas";
import { pollUntil, type PollOptions } from "./polling";
import {
	buildEntityRowsQueryDocument,
	executeQueryEngine,
	getQueryEngineTextFieldOrNull,
	requireQueryEngineTextField,
} from "./query-engine-core";
import { listRelationshipSchemas, requireRelationshipSchemaBySlug } from "./relationship-schemas";
import { createRelationship } from "./relationships";

export async function insertRelationshipRow(
	client: Client,
	input: {
		sourceEntityId: string;
		targetEntityId: string;
		relationshipSchemaId: string;
		properties?: Record<string, unknown>;
	},
) {
	return createRelationship(client, {
		properties: input.properties,
		sourceEntityId: EntityId.make(input.sourceEntityId),
		targetEntityId: EntityId.make(input.targetEntityId),
		relationshipSchemaId: RelationshipSchemaId.make(input.relationshipSchemaId),
	});
}

export async function queryInLibraryRelationship(
	client: Client,
	entityId: string,
	entitySchemaSlug: string,
) {
	return executeQueryEngine(
		client,
		buildEntityRowsQueryDocument({
			limit: 1,
			alias: "entity",
			schemas: [entitySchemaSlug],
			fields: [queryEngineField("id", queryEngineSystemRef("entity", "id"))],
			where: queryEngineAnd(
				queryEngineComparison(
					"eq",
					queryEngineSystemRef("entity", "id"),
					queryEngineLiteral(entityId),
				),
				queryEngineExists(
					queryEngineEntitySource({
						where: null,
						alias: "library",
						schemas: ["library"],
						via: {
							alias: "inLibrary",
							entityRef: "entity",
							schema: "in-library",
							direction: "outgoing" as const,
						},
					}),
				),
			),
		}),
	);
}

export async function waitForInLibraryRelationship(
	client: Client,
	entityId: string,
	entitySchemaSlug: string,
	options: PollOptions = {},
) {
	return pollUntil(
		`in-library relationship for entity ${entityId}`,
		async () => {
			const result = await queryInLibraryRelationship(client, entityId, entitySchemaSlug);
			return result.data.items.length >= 1 ? result : null;
		},
		{ timeoutMs: 5000, intervalMs: 200, ...options },
	);
}

export async function getGlobalEntityByProvenance(
	client: Client,
	input: { externalId: string; sandboxScriptId: string; entitySchemaSlug: string },
) {
	const result = await executeQueryEngine(
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
					queryEngineSystemRef("entity", "sandboxScriptId"),
					queryEngineLiteral(input.sandboxScriptId),
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
}

export async function waitForEntityPopulated(
	client: Client,
	input: { externalId: string; sandboxScriptId: string; entitySchemaSlug: string },
	options: PollOptions = {},
) {
	return pollUntil(
		`global entity '${input.externalId}' populated`,
		async () => {
			const entity = await getGlobalEntityByProvenance(client, input);
			return entity.populatedAt !== null ? entity : null;
		},
		{ timeoutMs: 30_000, intervalMs: 500, ...options },
	);
}

export async function getRelationshipBySchemaSlug(
	client: Client,
	input: { sourceEntityId: string; targetEntityId: string; relationshipSchemaSlug: string },
) {
	const schemas = await listRelationshipSchemas(client, { slugs: [input.relationshipSchemaSlug] });
	const relationshipSchema = requireRelationshipSchemaBySlug(schemas, input.relationshipSchemaSlug);
	const relationships = await getBackendClient().run(
		(c) =>
			c.testSupport.listGlobalRelationships({
				payload: {
					type: "anchored",
					direction: "outgoing",
					anchorEntityId: EntityId.make(input.sourceEntityId),
					relationshipSchemaId: RelationshipSchemaId.make(relationshipSchema.id),
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
}

export async function seedMediaEntity(input: {
	name: string;
	client?: Client;
	externalId: string;
	userId?: string | null;
	entitySchemaId: string;
	sandboxScriptId: string | null;
	properties: Record<string, unknown>;
}) {
	const entitySchemaId = EntitySchemaId.make(input.entitySchemaId);
	const sandboxScriptId = input.sandboxScriptId
		? SandboxScriptId.make(input.sandboxScriptId)
		: undefined;
	const entity = input.userId
		? await requirePresent(input.client, "Client is required for user-scoped entity seeding").run(
				(c) =>
					c.entities.create({
						payload: {
							entitySchemaId,
							sandboxScriptId,
							name: input.name,
							properties: input.properties,
							externalId: input.externalId,
						},
					}),
			)
		: await getBackendClient().run(
				(c) =>
					c.testSupport.createGlobalEntity({
						payload: {
							entitySchemaId,
							sandboxScriptId,
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
		entitySchemaId: entity.entitySchemaId,
		sandboxScriptId: input.sandboxScriptId,
	};
}

export async function createGlobalBookEntityFixture(
	client: Client,
	options: { name?: string; externalId?: string } = {},
) {
	const { schema } = await findBuiltinSchemaWithProviders(client);
	const entity = await seedMediaEntity({
		userId: null,
		properties: {},
		entitySchemaId: schema.id,
		sandboxScriptId: getFirstProviderScriptId(schema),
		name: options.name ?? `Global Built-in Book ${crypto.randomUUID()}`,
		externalId: options.externalId ?? `global-book-${crypto.randomUUID()}`,
	});
	return { entity, schema };
}

export async function seedGlobalShowEpisodeTree(client: Client, options: { showName: string }) {
	const { schema: showSchema } = await findBuiltinSchemaBySlug(client, "show");
	const tmdbProvider = showSchema.providers.find((provider) => provider.name === "TMDB");
	assertPresent(tmdbProvider, "Missing TMDB provider for built-in show schema");

	const [seasonSchemaId, episodeSchemaId, relationshipSchemas] = await Promise.all([
		getBuiltinEntitySchemaId("show-season"),
		getBuiltinEntitySchemaId("show-episode"),
		listRelationshipSchemas(client, {
			slugs: ["show-to-show-season", "show-season-to-show-episode"],
		}),
	]);
	const showToSeason = requireRelationshipSchemaBySlug(relationshipSchemas, "show-to-show-season");
	const seasonToEpisode = requireRelationshipSchemaBySlug(
		relationshipSchemas,
		"show-season-to-show-episode",
	);

	const tmdbId = String(Math.floor(Math.random() * 1_000_000_000));
	const populatedAt = new Date().toISOString();
	const backend = getBackendClient();
	const createGlobalEntity = (input: {
		name: string;
		externalId: string;
		entitySchemaId: string;
		properties: Record<string, unknown>;
	}) =>
		backend.run(
			(c) =>
				c.testSupport.createGlobalEntity({
					payload: {
						...input,
						populatedAt,
						entitySchemaId: EntitySchemaId.make(input.entitySchemaId),
						sandboxScriptId: SandboxScriptId.make(tmdbProvider.scriptId),
					},
				}),
			adminHeaders,
		);
	const show = await createGlobalEntity({
		name: options.showName,
		externalId: tmdbId,
		entitySchemaId: showSchema.id,
		properties: { totalSeasons: 1, totalEpisodes: 1 },
	});
	const season = await createGlobalEntity({
		name: "Season 1",
		externalId: `season-${tmdbId}`,
		entitySchemaId: seasonSchemaId,
		properties: { seasonNumber: 1 },
	});
	const episode = await createGlobalEntity({
		name: "Episode 2",
		externalId: `episode-${tmdbId}`,
		entitySchemaId: episodeSchemaId,
		properties: { seasonNumber: 1, episodeNumber: 2 },
	});
	await backend.run(
		(c) =>
			c.testSupport.upsertGlobalRelationship({
				payload: {
					sourceEntityId: show.id,
					targetEntityId: season.id,
					relationshipSchemaId: RelationshipSchemaId.make(showToSeason.id),
				},
			}),
		adminHeaders,
	);
	await backend.run(
		(c) =>
			c.testSupport.upsertGlobalRelationship({
				payload: {
					sourceEntityId: season.id,
					targetEntityId: episode.id,
					relationshipSchemaId: RelationshipSchemaId.make(seasonToEpisode.id),
				},
			}),
		adminHeaders,
	);

	return { tmdbId, showId: show.id, seasonId: season.id, episodeId: episode.id };
}

export async function insertLibraryMembership(client: Client, input: { mediaEntityId: string }) {
	const libraryResult = await executeQueryEngine(
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

	const schemas = await listRelationshipSchemas(client, { slugs: ["in-library"] });
	const inLibrarySchema = requireRelationshipSchemaBySlug(schemas, "in-library");

	await createRelationship(client, {
		properties: {},
		relationshipSchemaId: inLibrarySchema.id,
		targetEntityId: EntityId.make(libraryEntityId),
		sourceEntityId: EntityId.make(input.mediaEntityId),
	});
}
