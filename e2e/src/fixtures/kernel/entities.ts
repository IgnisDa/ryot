import type { ContractPayload } from "@ryot-app/contract/client";
import { PopulationStatus, TranslationStatus } from "@ryot-app/contract/modules/entities/schemas";
import { EntityId, EntitySchemaSlug, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { column, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import { Effect, Schema } from "effect";

import { requireObjectRecord, requirePresent, requireString } from "~/support/assertions";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getApiClient } from "./contract-client";
import { createPluginSchema } from "./entity-schemas";
import {
	executeRyotQL,
	requireRows,
	requireRyotQLDate,
	requireRyotQLText,
	requireRyotQLValue,
} from "./ryotql";

type CreateEntityInput = ContractPayload<"entities", "create">;

function withRecordProperties<T extends { properties: unknown }>(
	entity: T,
): Omit<T, "properties"> & { properties: Record<string, unknown> } {
	return {
		...entity,
		properties: requireObjectRecord(entity.properties, "Entity properties must be an object"),
	};
}

export const createEntity = (client: Client, body: CreateEntityInput) =>
	Effect.gen(function* () {
		const entity = yield* client.call((c) => c.entities.create({ payload: body }));

		requirePresent(entity.id, "Failed to create entity");

		return withRecordProperties(entity);
	});

export const getEntity = (client: Client, entityId: string) =>
	Effect.gen(function* () {
		const entityTable = table("entity", "entity");
		const result = yield* executeRyotQL(
			client,
			document({
				entity: rows(entityTable, {
					limit: 1,
					where: eq(column(entityTable, "id"), literal(entityId)),
					fields: [
						field("id", column(entityTable, "id")),
						field("name", column(entityTable, "name")),
						field("createdAt", column(entityTable, "createdAt")),
						field("updatedAt", column(entityTable, "updatedAt")),
						field("properties", column(entityTable, "properties")),
						field("entitySchemaSlug", column(entityTable, "entitySchemaSlug")),
						field("externalId", column(entityTable, "externalId")),
						field("populatedAt", column(entityTable, "populatedAt")),
						field("providerId", column(entityTable, "providerId")),
						field("populationStatus", column(entityTable, "populationStatus")),
						field("translationStatus", column(entityTable, "translationStatus")),
					],
				}),
			}),
		);
		const row = requirePresent(
			requireRows(result.data.entity, "entity").items[0],
			`Entity '${entityId}' not found`,
		);
		const optionalText = (key: string) => {
			const value = requireRyotQLValue(row, key);
			if (value === null) {
				return null;
			}
			return requireString(value, `Expected '${key}' to contain text`);
		};
		const properties = requireRyotQLValue(row, "properties");
		const providerId = optionalText("providerId");
		const value = requireRyotQLValue(row, "populatedAt");
		const populatedAt = value === null ? null : requireRyotQLDate(row, "populatedAt");
		return {
			populatedAt,
			name: requireRyotQLText(row, "name"),
			externalId: optionalText("externalId"),
			createdAt: requireRyotQLDate(row, "createdAt"),
			updatedAt: requireRyotQLDate(row, "updatedAt"),
			id: EntityId.make(requireRyotQLText(row, "id")),
			providerId: providerId === null ? null : SandboxProviderId.make(providerId),
			properties: requireObjectRecord(properties, "Entity properties must be an object"),
			entitySchemaSlug: EntitySchemaSlug.make(requireRyotQLText(row, "entitySchemaSlug")),
			populationStatus: yield* Schema.decodeUnknownEffect(PopulationStatus)(
				requireRyotQLText(row, "populationStatus"),
			),
			translationStatus: yield* Schema.decodeUnknownEffect(TranslationStatus)(
				requireRyotQLText(row, "translationStatus"),
			),
		};
	});

export const setEntityPopulatedAt = (entityId: string, populatedAt: string | null) =>
	getApiClient().call(
		(c) =>
			c.testSupport.setEntityPopulatedAt({
				payload: { populatedAt },
				params: { entityId: EntityId.make(entityId) },
			}),
		adminHeaders(),
	);

export const createPluginSchemaAndEntity = (client: Client) =>
	Effect.gen(function* () {
		const { slug, schemaId } = yield* createPluginSchema(client);
		const entity = yield* createEntity(client, {
			name: "Test Entity",
			entitySchemaSlug: schemaId,
			properties: { title: "Test Title" },
		});
		return { slug, entityId: entity.id };
	});
