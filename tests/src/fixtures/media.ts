import { EntityId, RelationshipSchemaId } from "@ryot/contract/schema/brands";

import { getPgClient } from "../setup";
import { assertPresent, requirePresent } from "../test-support/assertions";
import type { Client } from "./auth";
import {
	findBuiltinSchemaBySlug,
	findBuiltinSchemaWithProviders,
	getBuiltinEntitySchemaId,
	getFirstProviderScriptId,
} from "./entity-schemas";
import { pollUntil, type PollOptions } from "./polling";
import { listRelationshipSchemas, requireRelationshipSchemaBySlug } from "./relationship-schemas";
import { createRelationship } from "./relationships";
import {
	detailsDriverCode,
	monitoredShowDetailsCode,
	seedBuiltinProviderScript,
	updateProviderScriptCode,
	type MonitoredShowTree,
} from "./sandbox-provider";

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

export async function queryInLibraryRelationship(client: Client, entityId: string, email: string) {
	const schemas = await listRelationshipSchemas(client, { slugs: ["in-library"] });
	const inLibrarySchema = requireRelationshipSchemaBySlug(schemas, "in-library");

	return getPgClient().query<{ id: string }>(
		`select r.id
		 from relationship r
		 inner join entity library_entity on library_entity.id = r.target_entity_id
		 inner join entity_schema library_schema on library_schema.id = library_entity.entity_schema_id
		 inner join "user" u on u.id = library_entity.user_id
		 where r.relationship_schema_id = $1
		   and r.user_id = u.id
		   and r.source_entity_id = $2
		   and u.email = $3
		   and library_schema.slug = 'library'
		 limit 1`,
		[inLibrarySchema.id, entityId, email],
	);
}

export async function waitForInLibraryRelationship(
	client: Client,
	entityId: string,
	email: string,
	options: PollOptions = {},
) {
	return pollUntil(
		`in-library relationship for entity ${entityId}`,
		async () => {
			const result = await queryInLibraryRelationship(client, entityId, email);
			return (result.rowCount ?? 0) >= 1 ? result : null;
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

export async function getGlobalEntityByProvenance(input: {
	externalId: string;
	entitySchemaId: string;
	sandboxScriptId: string;
}) {
	const pg = getPgClient();
	const result = await pg.query<{
		id: string;
		name: string;
		populatedAt: string | null;
	}>(
		`select e.id, e.name, e.populated_at::text as "populatedAt"
		 from entity e
		 where e.external_id = $1
		   and e.entity_schema_id = $2
		   and e.sandbox_script_id = $3
		   and e.user_id is null
		 limit 1`,
		[input.externalId, input.entitySchemaId, input.sandboxScriptId],
	);

	return requirePresent(
		result.rows[0],
		`Missing global entity for external id '${input.externalId}'`,
	);
}

export async function waitForEntityPopulated(
	input: {
		externalId: string;
		entitySchemaId: string;
		sandboxScriptId: string;
	},
	options: PollOptions = {},
) {
	return pollUntil(
		`global entity '${input.externalId}' populated`,
		async () => {
			const entity = await getGlobalEntityByProvenance(input);
			return entity.populatedAt !== null ? entity : null;
		},
		{ timeoutMs: 30_000, intervalMs: 500, ...options },
	);
}

export const waitForEntityPopulatedById = (entityId: string) =>
	pollUntil("entity populated", async () => {
		const result = await getPgClient().query<{ populatedAt: string | null }>(
			`select populated_at::text as "populatedAt" from entity where id = $1`,
			[entityId],
		);
		return result.rows[0]?.populatedAt ? true : null;
	});

export async function getRelationshipBySchemaSlug(
	client: Client,
	input: {
		sourceEntityId: string;
		targetEntityId: string;
		relationshipSchemaSlug: string;
	},
) {
	const pg = getPgClient();
	const schemas = await listRelationshipSchemas(client, { slugs: [input.relationshipSchemaSlug] });
	const relationshipSchema = requireRelationshipSchemaBySlug(schemas, input.relationshipSchemaSlug);
	const result = await pg.query<{
		properties: Record<string, unknown>;
		sourceEntityId: string;
		targetEntityId: string;
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
		externalId: options.externalId ?? `global-book-${crypto.randomUUID()}`,
		name: options.name ?? `Global Built-in Book ${crypto.randomUUID()}`,
	});
	return { entity, schema };
}

export async function seedGlobalShowEpisodeTree(
	client: Client,
	options: { showName: string; specialsSeason?: boolean; episodesPerSeason?: number },
) {
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
	const showId = crypto.randomUUID();
	const seasonId = crypto.randomUUID();
	const episodeId = crypto.randomUUID();
	const pg = getPgClient();

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

	const extraEpisodeIds: string[] = [];
	if (options.episodesPerSeason && options.episodesPerSeason > 1) {
		const episodeNumbers: number[] = [];
		for (let episodeNumber = 1; episodeNumber <= options.episodesPerSeason; episodeNumber++) {
			if (episodeNumber !== 2) {
				episodeNumbers.push(episodeNumber);
			}
		}
		await Promise.all(
			episodeNumbers.map(async (episodeNumber) => {
				const extraEpisodeId = crypto.randomUUID();
				await pg.query(
					`insert into entity (id, name, external_id, entity_schema_id, sandbox_script_id, user_id, populated_at, properties)
				 values ($1,$2,$3,$4,$5,null,now(),$6::jsonb)`,
					[
						extraEpisodeId,
						`Episode ${episodeNumber}`,
						`episode-${tmdbId}-${episodeNumber}`,
						episodeSchemaId,
						tmdbProvider.scriptId,
						JSON.stringify({ seasonNumber: 1, episodeNumber }),
					],
				);
				await pg.query(
					`insert into relationship (id, source_entity_id, target_entity_id, relationship_schema_id, user_id)
				 values ($1,$2,$3,$4,null)`,
					[crypto.randomUUID(), seasonId, extraEpisodeId, seasonToEpisode.id],
				);
				extraEpisodeIds.push(extraEpisodeId);
			}),
		);
	}

	let specialsSeasonId: string | undefined;
	let specialsEpisodeId: string | undefined;
	if (options.specialsSeason) {
		specialsSeasonId = crypto.randomUUID();
		specialsEpisodeId = crypto.randomUUID();
		await pg.query(
			`insert into entity (id, name, external_id, entity_schema_id, sandbox_script_id, user_id, populated_at, properties)
			 values
			 ($1,'Specials',$2,$3,$4,null,now(),'{"seasonNumber":0}'::jsonb),
			 ($5,'Special 1',$6,$7,$4,null,now(),'{"seasonNumber":0,"episodeNumber":1}'::jsonb)`,
			[
				specialsSeasonId,
				`season-${tmdbId}-specials`,
				seasonSchemaId,
				tmdbProvider.scriptId,
				specialsEpisodeId,
				`episode-${tmdbId}-specials`,
				episodeSchemaId,
			],
		);
		await pg.query(
			`insert into relationship (id, source_entity_id, target_entity_id, relationship_schema_id, user_id)
			 values ($1,$2,$3,$4,null), ($5,$6,$7,$8,null)`,
			[
				crypto.randomUUID(),
				showId,
				specialsSeasonId,
				showToSeason.id,
				crypto.randomUUID(),
				specialsSeasonId,
				specialsEpisodeId,
				seasonToEpisode.id,
			],
		);
	}

	return {
		tmdbId,
		showId,
		seasonId,
		episodeId,
		extraEpisodeIds,
		specialsSeasonId,
		specialsEpisodeId,
	};
}

export async function seedMonitoredShowProvider(input: {
	tree: MonitoredShowTree;
	slug?: string;
	name?: string;
}) {
	const showSchemaId = await getBuiltinEntitySchemaId("show");
	const provider = await seedBuiltinProviderScript({
		slug: input.slug,
		name: input.name ?? "E2E Monitored Show Provider",
		code: monitoredShowDetailsCode(input.tree),
	});
	const showExternalId = `monitored-show-${crypto.randomUUID()}`;
	const show = await seedMediaEntity({
		userId: null,
		name: input.tree.name,
		externalId: showExternalId,
		entitySchemaId: showSchemaId,
		sandboxScriptId: provider.scriptId,
		properties: input.tree.properties ?? {},
	});

	return {
		provider,
		showSchemaId,
		showExternalId,
		showEntityId: show.id,
		refresh: (tree: MonitoredShowTree) =>
			updateProviderScriptCode(provider.scriptId, monitoredShowDetailsCode(tree)),
	};
}

export async function seedAnimeMonitoringEntity(input: {
	episodes: number;
	name?: string;
	slug?: string;
}) {
	const animeSchemaId = await getBuiltinEntitySchemaId("anime");
	const name = input.name ?? "E2E Monitored Anime";
	const provider = await seedBuiltinProviderScript({
		slug: input.slug,
		name: "E2E Monitored Anime Provider",
		code: detailsDriverCode({ name, properties: { episodes: input.episodes } }),
	});
	const animeExternalId = `monitored-anime-${crypto.randomUUID()}`;
	const anime = await seedMediaEntity({
		userId: null,
		name,
		externalId: animeExternalId,
		entitySchemaId: animeSchemaId,
		sandboxScriptId: provider.scriptId,
		properties: { episodes: input.episodes },
	});

	return {
		provider,
		animeSchemaId,
		animeExternalId,
		animeEntityId: anime.id,
		setEpisodes: (episodes: number) =>
			updateProviderScriptCode(
				provider.scriptId,
				detailsDriverCode({ name, properties: { episodes } }),
			),
	};
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
