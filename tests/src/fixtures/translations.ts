import { getPgClient } from "../setup";
import type { Client } from "./auth";
import { getEntity } from "./entities";
import { pollUntil, type PollOptions } from "./polling";

export type EntityTranslationRow = {
	name: string | null;
	populatedAt: string | null;
	description: string | null;
	image: Record<string, unknown> | null;
};

export async function setUserProviderLanguage(input: {
	userId: string;
	source: string;
	preferredLanguage: string;
}) {
	await getPgClient().query(
		`update "user"
		 set preferences = jsonb_set(
		   preferences,
		   '{languages,providers}',
		   coalesce(preferences -> 'languages' -> 'providers', '[]'::jsonb) || $2::jsonb
		 )
		 where id = $1`,
		[
			input.userId,
			JSON.stringify([{ source: input.source, preferredLanguage: input.preferredLanguage }]),
		],
	);
}

export async function markEntityPopulated(entityId: string) {
	await getPgClient().query(`update entity set populated_at = now() where id = $1`, [entityId]);
}

export async function getEntityTranslationRow(input: { entityId: string; language: string }) {
	const result = await getPgClient().query<EntityTranslationRow>(
		`select name, description, image, populated_at::text as "populatedAt"
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

export async function waitForEntityTranslationPopulated(
	input: { entityId: string; language: string },
	options: PollOptions = {},
) {
	return pollUntil(
		`translation overlay for entity '${input.entityId}' (${input.language})`,
		async () => {
			const row = await getEntityTranslationRow(input);
			return row && row.populatedAt !== null ? row : null;
		},
		{ timeoutMs: 30_000, intervalMs: 500, ...options },
	);
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
