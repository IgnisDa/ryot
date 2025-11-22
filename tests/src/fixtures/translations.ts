import { getPgClient } from "../setup";
import { assertPresent } from "../test-support/assertions";
import type { Client } from "./auth";
import { getEntity } from "./entities";
import { findBuiltinSchemaBySlug } from "./entity-schemas";
import { deleteGlobalEntityByProvenance, seedMediaEntity } from "./media";
import { pollUntil, type PollOptions } from "./polling";

type EntityTranslationRow = {
	name: string | null;
	populatedAt: string | null;
	properties: Record<string, unknown> | null;
};

export async function setUserLanguage(input: { userId: string; language: string }) {
	await getPgClient().query(
		`update "user"
		 set preferences = jsonb_set(preferences, '{language}', $2::jsonb)
		 where id = $1`,
		[input.userId, JSON.stringify(input.language)],
	);
}

async function markEntityPopulated(entityId: string) {
	await getPgClient().query(`update entity set populated_at = now() where id = $1`, [entityId]);
}

export async function seedPopulatedProviderEntity(input: {
	name: string;
	externalId: string;
	entitySchemaId: string;
	sandboxScriptId: string;
	properties: Record<string, unknown>;
}) {
	const provenance = {
		externalId: input.externalId,
		entitySchemaId: input.entitySchemaId,
		sandboxScriptId: input.sandboxScriptId,
	};
	await deleteGlobalEntityByProvenance(provenance);

	const seeded = await seedMediaEntity({
		userId: null,
		name: input.name,
		externalId: input.externalId,
		properties: input.properties,
		entitySchemaId: input.entitySchemaId,
		sandboxScriptId: input.sandboxScriptId,
	});
	await markEntityPopulated(seeded.id);

	return seeded;
}

export async function getProviderIds(
	client: Client,
	input: { schemaSlug: string; providerName: string },
) {
	const { schema } = await findBuiltinSchemaBySlug(client, input.schemaSlug);
	const sandboxScriptId = schema.providers.find(
		(provider) => provider.name === input.providerName,
	)?.scriptId;
	assertPresent(
		sandboxScriptId,
		`${input.providerName} ${input.schemaSlug} provider script not found`,
	);

	return { entitySchemaId: schema.id, sandboxScriptId };
}

export async function seedPopulatedTmdbEntity(
	client: Client,
	input: {
		name: string;
		externalId: string;
		schemaSlug: string;
		entitySchemaId?: string;
		sandboxScriptId?: string;
		properties: Record<string, unknown>;
	},
) {
	let entitySchemaId = input.entitySchemaId;
	let sandboxScriptId = input.sandboxScriptId;
	if (!entitySchemaId || !sandboxScriptId) {
		const { schema } = await findBuiltinSchemaBySlug(client, input.schemaSlug);
		entitySchemaId ??= schema.id;
		sandboxScriptId ??= schema.providers.find((provider) => provider.name === "TMDB")?.scriptId;
	}
	assertPresent(entitySchemaId, `TMDB ${input.schemaSlug} entity schema not found`);
	assertPresent(sandboxScriptId, `TMDB ${input.schemaSlug} provider script not found`);

	return seedPopulatedProviderEntity({
		entitySchemaId,
		sandboxScriptId,
		name: input.name,
		externalId: input.externalId,
		properties: input.properties,
	});
}

export function seedPopulatedTmdbMovie(
	client: Client,
	input: { externalId: string; name: string },
) {
	return seedPopulatedTmdbEntity(client, {
		name: input.name,
		schemaSlug: "movie",
		externalId: input.externalId,
		properties: { description: `Canonical English overview of ${input.name}.` },
	});
}

export async function getEntityTranslationRow(input: { entityId: string; language: string }) {
	const result = await getPgClient().query<EntityTranslationRow>(
		`select name, properties, populated_at::text as "populatedAt"
		 from entity_translation
		 where entity_id = $1 and language = $2
		 limit 1`,
		[input.entityId, input.language],
	);

	return result.rows[0] ?? null;
}

export async function countEntityTranslations(entityId: string) {
	const result = await getPgClient().query<{ count: string }>(
		`select count(*)::text as count from entity_translation where entity_id = $1`,
		[entityId],
	);

	return Number(result.rows[0]?.count ?? "0");
}

/**
 * Re-reads the entity detail endpoint until its translationStatus settles to the
 * target. While the status is `pending`, each read re-requests the background fill,
 * mirroring how a client polls the detail page (PRD: "appears on a subsequent read").
 */
export async function pollEntityUntilTranslationStatus(
	client: Client,
	entityId: string,
	target: "ready" | "none",
	options: PollOptions = {},
) {
	return pollUntil(
		`entity '${entityId}' translationStatus=${target}`,
		async () => {
			const entity = await getEntity(client, entityId);
			return entity.translationStatus === target ? entity : null;
		},
		{ timeoutMs: 60_000, intervalMs: 2000, ...options },
	);
}
