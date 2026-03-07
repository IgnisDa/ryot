import { getPgClient } from "~/setup";

import type { Client } from "./auth";
import { getEntity } from "./entities";
import { deleteGlobalEntityByProvenance, seedMediaEntity } from "./media";
import { pollUntil, type PollOptions } from "./polling";

type EntityTranslationRow = {
	name: string | null;
	populatedAt: string | null;
	properties: Record<string, unknown> | null;
};

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

export async function seedEntityTranslation(input: {
	entityId: string;
	language: string;
	name?: string | null;
	properties?: Record<string, unknown> | null;
}) {
	await getPgClient().query(
		`insert into entity_translation (id, entity_id, language, name, properties, populated_at)
		 values ($1, $2, $3, $4, $5::jsonb, now())
		 on conflict (entity_id, language) do update
		   set name = excluded.name,
		       properties = excluded.properties,
		       populated_at = excluded.populated_at`,
		[
			crypto.randomUUID(),
			input.entityId,
			input.language,
			input.name ?? null,
			input.properties == null ? null : JSON.stringify(input.properties),
		],
	);
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

/** Re-reads the entity detail endpoint until its translationStatus settles to `target`. */
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
