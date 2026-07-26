import type { ContractPayload } from "@ryot/contract/client";
import { TranslationStatus } from "@ryot/contract/modules/entities/schemas";
import { EntityId, EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import { column, document, eq, field, literal, rows, table } from "@ryot/ryotql";
import { Effect, Schema } from "effect";

import { requireObjectRecord, requirePresent, requireString } from "~/support/assertions";

import type { Client } from "./auth";
import { createPluginSchema } from "./entity-schemas";
import {
	executeRyotQL,
	requireRows,
	requireRyotQLDateField,
	requireRyotQLFieldValue,
	requireRyotQLTextField,
} from "./ryotql";

type CreateEntityInput = ContractPayload<"entities", "create">;

function withRecordProperties<T extends { properties: unknown }>(
	entity: T,
): Omit<T, "properties"> & {
	properties: Record<string, unknown>;
} {
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
						field("translationStatus", column(entityTable, "translationStatus")),
					],
					where: eq(column(entityTable, "id"), literal(entityId)),
				}),
			}),
		);
		const row = requirePresent(
			requireRows(result.data.entity, "entity").items[0],
			`Entity '${entityId}' not found`,
		);
		const optionalText = (key: string) => {
			const value = requireRyotQLFieldValue(row, key);
			if (value.kind === "null") {
				return null;
			}
			if (value.kind !== "text") {
				throw new Error(`Expected text or null field '${key}'`);
			}
			return requireString(value.value, `Expected '${key}' to contain text`);
		};
		const properties = requireRyotQLFieldValue(row, "properties");
		if (properties.kind !== "json") {
			throw new Error("Expected entity properties to be JSON");
		}
		const providerId = optionalText("providerId");
		const value = requireRyotQLFieldValue(row, "populatedAt");
		const populatedAt = value.kind === "null" ? null : requireRyotQLDateField(row, "populatedAt");
		return {
			populatedAt,
			externalId: optionalText("externalId"),
			name: requireRyotQLTextField(row, "name"),
			createdAt: requireRyotQLDateField(row, "createdAt"),
			updatedAt: requireRyotQLDateField(row, "updatedAt"),
			id: EntityId.make(requireRyotQLTextField(row, "id")),
			providerId: providerId === null ? null : SandboxProviderId.make(providerId),
			properties: requireObjectRecord(properties.value, "Entity properties must be an object"),
			entitySchemaSlug: EntitySchemaSlug.make(requireRyotQLTextField(row, "entitySchemaSlug")),
			translationStatus: yield* Schema.decodeUnknownEffect(TranslationStatus)(
				requireRyotQLTextField(row, "translationStatus"),
			),
		};
	});

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
