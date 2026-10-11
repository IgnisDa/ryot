import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import type { DefinitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { and, column, document, eq, field, literal, rows, table } from "@ryot-app/ryotql";
import { Effect } from "effect";

import { requireObjectRecord, requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
import { listRelationshipSchemas, requireRelationshipSchemaBySlug } from "./relationship-schemas";
import { executeRyotQL, requireRows, requireRyotQLText, requireRyotQLValue } from "./ryotql";

type CreateRelationshipBody = ContractPayload<"relationships", "create">;
type CreateRelationshipResult = ContractSuccess<"relationships", "create">;

export const createRelationship = (client: Client, body: CreateRelationshipBody) =>
	Effect.gen(function* () {
		const result: CreateRelationshipResult = yield* client.call((c) =>
			c.relationships.create({ payload: body }),
		);
		const relationship = requirePresent(result.relationship, "Failed to create relationship");
		return { ...relationship, warnings: result.warnings };
	});

export const insertRelationshipRow = (
	client: Client,
	input: {
		sourceEntityId: string;
		targetEntityId: string;
		relationshipSchema: CreateRelationshipBody["relationshipSchema"];
		properties?: Record<string, unknown>;
	},
) =>
	createRelationship(client, {
		properties: input.properties,
		relationshipSchema: input.relationshipSchema,
		sourceEntityId: EntityId.make(input.sourceEntityId),
		targetEntityId: EntityId.make(input.targetEntityId),
	});

export const findRelationshipBySchema = (
	client: Client,
	input: {
		owner: DefinitionOwner;
		sourceEntityId: string;
		targetEntityId: string;
		relationshipSchemaSlug: string;
	},
) =>
	Effect.gen(function* () {
		const { owner } = input;
		const schemas = yield* listRelationshipSchemas(client, {
			owner,
			slugs: [input.relationshipSchemaSlug],
		});
		const relationshipSchema = requireRelationshipSchemaBySlug(
			schemas,
			input.relationshipSchemaSlug,
			owner,
		);
		const relationshipTable = table("relationship", "relationship");
		const result = yield* executeRyotQL(
			client,
			document({
				relationships: rows(relationshipTable, {
					limit: 1,
					fields: [
						field("properties", column(relationshipTable, "properties")),
						field("sourceEntityId", column(relationshipTable, "sourceEntityId")),
						field("targetEntityId", column(relationshipTable, "targetEntityId")),
					],
					where: and(
						eq(column(relationshipTable, "sourceEntityId"), literal(input.sourceEntityId)),
						eq(column(relationshipTable, "targetEntityId"), literal(input.targetEntityId)),
						eq(column(relationshipTable, "relationshipSchemaSlug"), literal(relationshipSchema.id)),
					),
				}),
			}),
		);
		const relationship = requirePresent(
			requireRows(result.data.relationships, "relationships").items[0],
			`Missing relationship '${input.relationshipSchemaSlug}' for '${input.sourceEntityId}' -> '${input.targetEntityId}'`,
		);
		return {
			sourceEntityId: requireRyotQLText(relationship, "sourceEntityId"),
			targetEntityId: requireRyotQLText(relationship, "targetEntityId"),
			properties: requireObjectRecord(
				requireRyotQLValue(relationship, "properties"),
				"Expected relationship properties to be an object",
			),
		};
	});
