import { EntityId } from "@ryot/contract/schema/brands";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getBackendClient } from "./contract-client";
import { getEntity } from "./entities";
import { seedMediaEntity } from "./media";
import { pollUntil, type PollOptions } from "./polling";

type EntityTranslationRow = {
	name: string | null;
	populatedAt: string | null;
	properties: Record<string, unknown> | null;
};

async function markEntityPopulated(entityId: string) {
	await getBackendClient().run(
		(c) =>
			c.testSupport.setEntityPopulatedAt({
				path: { entityId: EntityId.make(entityId) },
				payload: { populatedAt: new Date().toISOString() },
			}),
		adminHeaders,
	);
}

export async function seedPopulatedProviderEntity(input: {
	name: string;
	externalId: string;
	entitySchemaId: string;
	sandboxScriptId: string;
	properties: Record<string, unknown>;
}) {
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
	await getBackendClient().run(
		(c) =>
			c.testSupport.upsertEntityTranslation({
				payload: {
					language: input.language,
					name: input.name ?? null,
					properties: input.properties ?? null,
					entityId: EntityId.make(input.entityId),
				},
			}),
		adminHeaders,
	);
}

export async function getEntityTranslationRow(input: { entityId: string; language: string }) {
	const rows = await getBackendClient().run(
		(c) =>
			c.testSupport.listEntityTranslations({
				path: { entityId: EntityId.make(input.entityId) },
			}),
		adminHeaders,
	);
	return (
		(rows.find((row) => row.language === input.language) as EntityTranslationRow | undefined) ??
		null
	);
}

export async function countEntityTranslations(entityId: string) {
	const rows = await getBackendClient().run(
		(c) => c.testSupport.listEntityTranslations({ path: { entityId: EntityId.make(entityId) } }),
		adminHeaders,
	);
	return rows.length;
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
