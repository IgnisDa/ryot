import { EntityId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getApiClient } from "./contract-client";
import { getEntity } from "./entities";
import { pollUntil } from "./polling";

export const seedEntityTranslation = (input: {
	entityId: string;
	language: string;
	name?: string | null;
	properties?: Record<string, unknown> | null;
}) =>
	getApiClient().call(
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
		const rows = yield* getApiClient().call(
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
		const rows = yield* getApiClient().call(
			(c) =>
				c.testSupport.listEntityTranslations({ params: { entityId: EntityId.make(entityId) } }),
			adminHeaders,
		);
		return rows.length;
	});

/** Re-reads the entity until its translationStatus settles to `target`. */
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
