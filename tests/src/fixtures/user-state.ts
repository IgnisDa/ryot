import { EntityId } from "@ryot/contract/schema/brands";
import { buildEventHistoryQueryDocument, type QueryEngineNonEmptyArray } from "@ryot/query-engine";

import { getPgClient } from "~/setup";
import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
import type { ContractPayload, ContractSuccess } from "./contract-client";
import { executeQueryEngine } from "./query-engine-core";

type MergeUserStateBody = ContractPayload<"userState", "mergeUserState">;
type MergeUserStateData = ContractSuccess<"userState", "mergeUserState">;
type ClearEntityUserStateData = ContractSuccess<"userState", "clearUserState">;

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
	userId: string;
	entityId: string;
	eventSchemaSlugs: QueryEngineNonEmptyArray<string>;
	entitySchemaSlugs: QueryEngineNonEmptyArray<string>;
}) {
	const pg = getPgClient();
	const [entityEvents, sessionEvents, relationships] = await Promise.all([
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
		pg.query<{ count: string }>(
			`select count(*)::text as count
			 from relationship
			 where user_id = $1
			   and (source_entity_id = $2 or target_entity_id = $2)`,
			[input.userId, input.entityId],
		),
	]);

	return {
		eventCount: entityEvents.data.pageInfo.total + sessionEvents.data.pageInfo.total,
		relationshipCount: Number(
			requirePresent(relationships.rows[0], "Missing relationship count").count,
		),
	};
}
