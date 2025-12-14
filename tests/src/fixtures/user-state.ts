import { EntityId } from "@ryot/contract/schema/brands";

import { getPgClient } from "~/setup";
import { requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
import type { ContractPayload, ContractSuccess } from "./contract-client";

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

export async function queryUserEntityStateCounts(input: { userId: string; entityId: string }) {
	const pg = getPgClient();
	const [events, relationships] = await Promise.all([
		pg.query<{ count: string }>(
			`select count(*)::text as count
			 from event
			 where user_id = $1
			   and (entity_id = $2 or session_entity_id = $2)`,
			[input.userId, input.entityId],
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
		eventCount: Number(requirePresent(events.rows[0], "Missing event count").count),
		relationshipCount: Number(
			requirePresent(relationships.rows[0], "Missing relationship count").count,
		),
	};
}
