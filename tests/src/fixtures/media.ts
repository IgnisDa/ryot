import { EntityId, RelationshipSchemaId } from "@ryot/contract/schema/brands";
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

import { getPgClient } from "~/setup";
import { assertPresent, requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
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

export async function deleteGlobalEntityByProvenance(input: {
	externalId: string;
	entitySchemaId: string;
	sandboxScriptId: string;
}) {
	const pg = getPgClient();

	await pg.query(
		`delete from entity
		 where external_id = $1
		   and entity_schema_id = $2
		   and sandbox_script_id = $3
		   and user_id is null`,
		[input.externalId, input.entitySchemaId, input.sandboxScriptId],
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
	const pg = getPgClient();
	const schemas = await listRelationshipSchemas(client, { slugs: [input.relationshipSchemaSlug] });
	const relationshipSchema = requireRelationshipSchemaBySlug(schemas, input.relationshipSchemaSlug);
	const result = await pg.query<{
		sourceEntityId: string;
		targetEntityId: string;
		properties: Record<string, unknown>;
	}>(
		`select r.properties,
		        r.source_entity_id as "sourceEntityId",
		        r.target_entity_id as "targetEntityId"
		 from relationship r
		 where r.relationship_schema_id = $1
		   and r.source_entity_id = $2
		   and r.target_entity_id = $3
		   and r.user_id is null
		 limit 1`,
		[relationshipSchema.id, input.sourceEntityId, input.targetEntityId],
	);

	return requirePresent(
		result.rows[0],
		`Missing relationship '${input.relationshipSchemaSlug}' for '${input.sourceEntityId}' -> '${input.targetEntityId}'`,
	);
}

export async function seedMediaEntity(input: {
	name: string;
	externalId: string;
	userId?: string | null;
	entitySchemaId: string;
	sandboxScriptId: string | null;
	properties: Record<string, unknown>;
}) {
	const pg = getPgClient();
	const id = crypto.randomUUID();

	await pg.query(
		`insert into entity (
			id,
			name,
			user_id,
			properties,
			external_id,
			entity_schema_id,
			sandbox_script_id
		) values ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
		[
			id,
			input.name,
			input.userId ?? null,
			JSON.stringify(input.properties),
			input.externalId,
			input.entitySchemaId,
			input.sandboxScriptId,
		],
	);

	return {
		name: input.name,
		id: EntityId.make(id),
		userId: input.userId ?? null,
		properties: input.properties,
		externalId: input.externalId,
		entitySchemaId: input.entitySchemaId,
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

	const pg = getPgClient();
	const showId = crypto.randomUUID();
	const seasonId = crypto.randomUUID();
	const episodeId = crypto.randomUUID();
	const tmdbId = String(Math.floor(Math.random() * 1_000_000_000));

	await pg.query(
		`insert into entity (id, name, external_id, entity_schema_id, sandbox_script_id, user_id, populated_at, properties)
		 values
		 ($1,$2,$3,$4,$5,null,now(),'{"totalSeasons":1,"totalEpisodes":1}'::jsonb),
		 ($6,'Season 1',$7,$8,$5,null,now(),'{"seasonNumber":1}'::jsonb),
		 ($9,'Episode 2',$10,$11,$5,null,now(),'{"seasonNumber":1,"episodeNumber":2}'::jsonb)`,
		[
			showId,
			options.showName,
			tmdbId,
			showSchema.id,
			tmdbProvider.scriptId,
			seasonId,
			`season-${tmdbId}`,
			seasonSchemaId,
			episodeId,
			`episode-${tmdbId}`,
			episodeSchemaId,
		],
	);
	await pg.query(
		`insert into relationship (id, source_entity_id, target_entity_id, relationship_schema_id, user_id)
		 values ($1,$2,$3,$4,null), ($5,$6,$7,$8,null)`,
		[
			crypto.randomUUID(),
			showId,
			seasonId,
			showToSeason.id,
			crypto.randomUUID(),
			seasonId,
			episodeId,
			seasonToEpisode.id,
		],
	);

	return { tmdbId, showId, seasonId, episodeId };
}

export async function insertLibraryMembership(
	client: Client,
	input: { userId: string; mediaEntityId: string },
) {
	const pg = getPgClient();

	const libraryResult = await pg.query<{ id: string }>(
		`select e.id
		 from entity e
		 inner join entity_schema es on es.id = e.entity_schema_id
		 where e.user_id = $1
		   and es.slug = 'library'
		   and es.user_id is null
		 limit 1`,
		[input.userId],
	);
	const libraryEntityId = requirePresent(
		libraryResult.rows[0]?.id,
		`Missing library entity for user '${input.userId}'`,
	);

	const schemas = await listRelationshipSchemas(client, { slugs: ["in-library"] });
	const inLibrarySchema = requireRelationshipSchemaBySlug(schemas, "in-library");

	await createRelationship(client, {
		properties: {},
		relationshipSchemaId: inLibrarySchema.id,
		targetEntityId: EntityId.make(libraryEntityId),
		sourceEntityId: EntityId.make(input.mediaEntityId),
	});
}
