import { EntityId } from "@ryot/contract/schema/brands";
import {
	buildEventHistoryQueryDocument,
	buildQueryEngineRowsDocument,
	queryEngineComparison,
	queryEngineField,
	queryEngineLiteral,
	queryEngineOrder,
	queryEngineRelationshipSource,
	queryEngineSystemRef,
	type QueryEngineNonEmptyArray,
} from "@ryot/query-engine";

import type { Client } from "./auth";
import type { ContractPayload, ContractSuccess } from "./contract-client";
import { executeQueryEngine } from "./query-engine-core";

type MergeUserStateBody = ContractPayload<"userState", "mergeUserState">;
type MergeUserStateData = ContractSuccess<"userState", "mergeUserState">;
type ClearEntityUserStateData = ContractSuccess<"userState", "clearUserState">;

type RelationshipRoot = {
	schema: string;
	sourceSchema: string;
	targetSchema: string;
};

export async function mergeUserState(
	client: Client,
	payload: MergeUserStateBody,
): Promise<MergeUserStateData> {
	return client.run((c) => c.userState.mergeUserState({ payload }));
}

export async function clearEntityUserState(
	client: Client,
	entityId: string,
): Promise<ClearEntityUserStateData> {
	return client.run((c) =>
		c.userState.clearUserState({ path: { entityId: EntityId.make(entityId) } }),
	);
}

export async function queryUserEntityStateCounts(input: {
	client: Client;
	entityId: string;
	eventSchemaSlugs: QueryEngineNonEmptyArray<string>;
	entitySchemaSlugs: QueryEngineNonEmptyArray<string>;
	relationships: QueryEngineNonEmptyArray<RelationshipRoot>;
}) {
	const [entityEvents, sessionEvents, ...relationships] = await Promise.all([
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
}
