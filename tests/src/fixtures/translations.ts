import { EntityId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getBackendClient } from "./contract-client";
import { getEntity } from "./entities";
import { seedMediaEntity } from "./media";
import { pollUntil } from "./polling";

const markEntityPopulated = (entityId: string) =>
	getBackendClient().call(
		(c) =>
			c.testSupport.setEntityPopulatedAt({
				params: { entityId: EntityId.make(entityId) },
				payload: { populatedAt: new Date().toISOString() },
			}),
		adminHeaders,
	);

export const seedPopulatedProviderEntity = (input: {
	name: string;
	externalId: string;
	entitySchemaSlug: string;
	providerId: string;
	properties: Record<string, unknown>;
}) =>
	Effect.gen(function* () {
		const seeded = yield* seedMediaEntity({
			userId: null,
			name: input.name,
			externalId: input.externalId,
			properties: input.properties,
			entitySchemaSlug: input.entitySchemaSlug,
			providerId: input.providerId,
		});
		yield* markEntityPopulated(seeded.id);

		return seeded;
	});

export const seedEntityTranslation = (input: {
	entityId: string;
	language: string;
	name?: string | null;
	properties?: Record<string, unknown> | null;
}) =>
	getBackendClient().call(
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

export const getEntityTranslationRow = (input: { entityId: string; language: string }) =>
	Effect.gen(function* () {
		const rows = yield* getBackendClient().call(
			(c) =>
				c.testSupport.listEntityTranslations({
					params: { entityId: EntityId.make(input.entityId) },
				}),
			adminHeaders,
		);
		return rows.find((row) => row.language === input.language) ?? null;
	});

export const countEntityTranslations = (entityId: string) =>
	Effect.gen(function* () {
		const rows = yield* getBackendClient().call(
			(c) =>
				c.testSupport.listEntityTranslations({ params: { entityId: EntityId.make(entityId) } }),
			adminHeaders,
		);
		return rows.length;
	});

/** Re-reads the entity detail endpoint until its translationStatus settles to `target`. */
export const pollEntityUntilTranslationStatus = (
	client: Client,
	entityId: string,
	target: "ready" | "none",
) =>
	pollUntil(
		`entity '${entityId}' translationStatus=${target}`,
		Effect.gen(function* () {
			const entity = yield* getEntity(client, entityId);
			return entity.translationStatus === target ? entity : null;
		}),
	);
