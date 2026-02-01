import { EntityId } from "@ryot/contract/schema/brands";
import { buildEventHistoryQueryDocument } from "@ryot/query-engine/recipes/app";
import {
	buildQueryEngineRowsDocument,
	queryEngineComparison,
	queryEngineField,
	queryEngineLiteral,
	queryEngineOrder,
	queryEngineRelationshipSource,
	queryEngineSystemRef,
	type QueryEngineNonEmptyArray,
} from "@ryot/query-engine";
import { Effect } from "effect";

import type { Client } from "./auth";
import type { ContractPayload } from "./contract-client";
import { executeQueryEngine } from "./query-engine-core";

type MergeUserStateBody = ContractPayload<"userState", "mergeUserState">;

type RelationshipRoot = {
	schema: string;
	sourceSchema: string;
	targetSchema: string;
};

export const mergeUserState = (client: Client, payload: MergeUserStateBody) =>
	client.call((c) => c.userState.mergeUserState({ payload }));

export const clearEntityUserState = (client: Client, entityId: string) =>
	client.call((c) => c.userState.clearUserState({ path: { entityId: EntityId.make(entityId) } }));

export const queryUserEntityStateCounts = (input: {
	client: Client;
	entityId: string;
	eventSchemaSlugs: QueryEngineNonEmptyArray<string>;
	entitySchemaSlugs: QueryEngineNonEmptyArray<string>;
	relationships: QueryEngineNonEmptyArray<RelationshipRoot>;
}) =>
	Effect.gen(function* () {
		const [entityEvents, sessionEvents, ...relationships] = yield* Effect.all([
			executeQueryEngine(
				input.client,
				buildEventHistoryQueryDocument({
					page: 1,
					limit: 1,
					entityId: input.entityId,
					eventSchemaSlugs: input.eventSchemaSlugs,
					entitySchemaSlugs: input.entitySchemaSlugs,
				}),
			),
			executeQueryEngine(
				input.client,
				buildEventHistoryQueryDocument({
					page: 1,
					limit: 1,
					sessionEntityId: input.entityId,
					eventSchemaSlugs: input.eventSchemaSlugs,
					entitySchemaSlugs: input.entitySchemaSlugs,
				}),
			),
			...input.relationships.map((relationship) =>
				executeQueryEngine(
					input.client,
					buildQueryEngineRowsDocument({
						limit: 1,
						fields: [queryEngineField("id", queryEngineSystemRef("relationship", "id"))],
						orderBy: [queryEngineOrder("asc", queryEngineSystemRef("relationship", "id"))],
						source: queryEngineRelationshipSource({
							alias: "relationship",
							schemas: [relationship.schema],
							targetEntity: { alias: "target", schemas: [relationship.targetSchema] },
							sourceEntity: { alias: "source", schemas: [relationship.sourceSchema] },
							where: queryEngineComparison(
								"eq",
								queryEngineSystemRef("source", "id"),
								queryEngineLiteral(input.entityId),
							),
						}),
					}),
				),
			),
		]);

		return {
			eventCount: entityEvents.data.pageInfo.total + sessionEvents.data.pageInfo.total,
			relationshipCount: relationships.reduce(
				(count, result) => count + result.data.pageInfo.total,
				0,
			),
		};
	});
