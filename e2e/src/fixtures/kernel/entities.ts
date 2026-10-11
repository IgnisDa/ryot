import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import { PopulationStatus, TranslationStatus } from "@ryot-app/contract/modules/entities/schemas";
import {
	EntityId,
	EntitySchemaSlug,
	PluginId,
	SandboxProviderId,
} from "@ryot-app/contract/schema/brands";
import { and, column, document, eq, field, isNull, literal, rows, table } from "@ryot-app/ryotql";
import { DateTime, Effect, Schema } from "effect";

import { requireObjectRecord, requirePresent, requireString } from "~/support/assertions";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getApiClient } from "./contract-client";
import { createPluginSchema } from "./entity-schemas";
import { pollUntil } from "./polling";
import {
	executeRyotQL,
	requireRows,
	requireRyotQLDate,
	requireRyotQLText,
	requireRyotQLValue,
} from "./ryotql";

type CreateEntityInput = ContractPayload<"entities", "create">;
type EntitySchemaReference = CreateEntityInput["entitySchema"];
type CreateEntityResult = ContractSuccess<"entities", "create">;

function withRecordProperties(
	entity: CreateEntityResult["entity"],
): Omit<CreateEntityResult["entity"], "properties"> & { properties: Record<string, unknown> } {
	return {
		...entity,
		properties: requireObjectRecord(entity.properties, "Entity properties must be an object"),
	};
}

export const createEntity = (client: Client, body: CreateEntityInput) =>
	Effect.gen(function* () {
		const result = yield* client.call((c) => c.entities.create({ payload: body }));

		requirePresent(result.entity.id, "Failed to create entity");

		return { ...withRecordProperties(result.entity), warnings: result.warnings };
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
						field("entitySchemaPluginId", column(entityTable, "entitySchemaPluginId")),
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
			entitySchemaPluginId:
				optionalText("entitySchemaPluginId") === null
					? null
					: PluginId.make(requireRyotQLText(row, "entitySchemaPluginId")),
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

export const markEntityPopulated = (entityId: string) =>
	Effect.flatMap(DateTime.now, (now) => setEntityPopulatedAt(entityId, DateTime.formatIso(now)));

export const createPluginSchemaAndEntity = (client: Client) =>
	Effect.gen(function* () {
		const { slug, reference } = yield* createPluginSchema(client);
		const entity = yield* createEntity(client, {
			name: "Test Entity",
			entitySchema: reference,
			properties: { title: "Test Title" },
		});
		return { slug, entityId: entity.id };
	});

export const seedEntity = (input: {
	name: string;
	client?: Client;
	externalId: string;
	userId?: string | null;
	entitySchema: EntitySchemaReference;
	providerId: string | null;
	properties: Record<string, unknown>;
}) =>
	Effect.gen(function* () {
		const { entitySchema } = input;
		const providerId = input.providerId ? SandboxProviderId.make(input.providerId) : undefined;
		const result = input.userId
			? yield* requirePresent(
					input.client,
					"Client is required for user-scoped entity seeding",
				).call((c) =>
					c.entities.create({
						payload: {
							providerId,
							entitySchema,
							name: input.name,
							properties: input.properties,
							externalId: input.externalId,
						},
					}),
				)
			: yield* getApiClient().call(
					(c) =>
						c.testSupport.createGlobalEntity({
							payload: {
								providerId,
								entitySchema,
								name: input.name,
								properties: input.properties,
								externalId: input.externalId,
							},
						}),
					adminHeaders(),
				);
		const entity = "entity" in result ? result.entity : result;
		const warnings = "warnings" in result ? result.warnings : undefined;

		return {
			id: entity.id,
			name: input.name,
			userId: input.userId ?? null,
			properties: input.properties,
			externalId: input.externalId,
			providerId: input.providerId,
			entitySchemaSlug: entity.entitySchemaSlug,
			...(warnings !== undefined ? { warnings } : {}),
		};
	});

export const seedPopulatedEntity = (
	input: Omit<Parameters<typeof seedEntity>[0], "client" | "userId">,
) =>
	Effect.gen(function* () {
		const seeded = yield* seedEntity({ ...input, userId: null });
		yield* markEntityPopulated(seeded.id);
		return seeded;
	});

const getEntityByProvenance = (
	client: Client,
	input: { externalId: string; providerId: string; entitySchemaSlug: string },
	globalOnly: boolean,
) =>
	Effect.gen(function* () {
		const entity = table("entity", "entity");
		const result = yield* executeRyotQL(
			client,
			document({
				entities: rows(entity, {
					limit: 1,
					fields: [
						field("id", column(entity, "id")),
						field("name", column(entity, "name")),
						field("populatedAt", column(entity, "populatedAt")),
					],
					where: and(
						eq(column(entity, "entitySchemaSlug"), literal(input.entitySchemaSlug)),
						eq(column(entity, "externalId"), literal(input.externalId)),
						eq(column(entity, "providerId"), literal(input.providerId)),
						...(globalOnly ? [isNull(column(entity, "userId"))] : []),
					),
				}),
			}),
		);
		const entities = requireRows(result.data.entities, "entities");
		const entityRow = requirePresent(
			entities.items[0],
			`Missing ${globalOnly ? "global" : "visible"} entity for external id '${input.externalId}'`,
		);
		const populatedAt = requireRyotQLValue(entityRow, "populatedAt");
		return {
			id: requireRyotQLText(entityRow, "id"),
			name: requireRyotQLText(entityRow, "name"),
			populatedAt:
				populatedAt === null
					? null
					: requireString(populatedAt, "Expected 'populatedAt' to contain text"),
		};
	});

export const getGlobalEntityByProvenance = (
	client: Client,
	input: { externalId: string; providerId: string; entitySchemaSlug: string },
) => getEntityByProvenance(client, input, true);

export const getVisibleEntityByProvenance = (
	client: Client,
	input: { externalId: string; providerId: string; entitySchemaSlug: string },
) => getEntityByProvenance(client, input, false);

export const waitForEntityPopulated = (
	client: Client,
	input: { externalId: string; providerId: string; entitySchemaSlug: string },
) =>
	pollUntil(
		`global entity '${input.externalId}' populated`,
		Effect.gen(function* () {
			const entity = yield* getGlobalEntityByProvenance(client, input);
			return entity.populatedAt !== null ? entity : null;
		}),
	);
