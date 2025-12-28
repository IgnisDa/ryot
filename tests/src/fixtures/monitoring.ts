import { EntityId } from "@ryot/contract/schema/brands";

import { getPgClient } from "../setup";

import type { Client } from "./auth";

export const getMonitoringStatus = (client: Client, entityId: string) =>
	client.run((contract) => contract.monitoring.status({ path: { entityId: EntityId.make(entityId) } }));

export const enableMonitoring = (client: Client, entityId: string) =>
	client.run((contract) => contract.monitoring.enable({ path: { entityId: EntityId.make(entityId) } }));

export const disableMonitoring = (client: Client, entityId: string) =>
	client.run((contract) => contract.monitoring.disable({ path: { entityId: EntityId.make(entityId) } }));

export const countMonitoringRelationships = async (input: { entityId: string; userId: string }) => {
	const result = await getPgClient().query<{ count: string }>(
		`select count(*)::text as count
		 from relationship r
		 inner join relationship_schema rs on rs.id = r.relationship_schema_id
		 inner join entity library_entity on library_entity.id = r.target_entity_id
		 inner join entity_schema library_schema on library_schema.id = library_entity.entity_schema_id
		 where r.source_entity_id = $1
		   and r.user_id = $2
		   and rs.slug = 'monitoring'
		   and library_schema.slug = 'library'`,
		[input.entityId, input.userId],
	);
	return Number(result.rows[0]?.count ?? 0);
};
