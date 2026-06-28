import { EntityId } from "@ryot/contract/schema/brands";

import { getPgClient } from "~/setup";

import type { Client } from "./auth";

export const getMediaMonitoringStatus = (client: Client, entityId: string) =>
	client.run((contract) =>
		contract.mediaMonitoring.status({ path: { entityId: EntityId.make(entityId) } }),
	);

export const enableMediaMonitoring = (client: Client, entityId: string) =>
	client.run((contract) =>
		contract.mediaMonitoring.enable({ path: { entityId: EntityId.make(entityId) } }),
	);

export const disableMediaMonitoring = (client: Client, entityId: string) =>
	client.run((contract) =>
		contract.mediaMonitoring.disable({ path: { entityId: EntityId.make(entityId) } }),
	);

export const countMediaMonitoringRelationships = async (input: {
	entityId: string;
	userId: string;
}) => {
	const result = await getPgClient().query<{ count: string }>(
		`select count(*)::text as count
		 from relationship r
		 inner join relationship_schema rs on rs.id = r.relationship_schema_id
		 inner join entity library_entity on library_entity.id = r.target_entity_id
		 inner join entity_schema library_schema on library_schema.id = library_entity.entity_schema_id
		 where r.source_entity_id = $1
		   and r.user_id = $2
		   and rs.slug = 'media-monitoring'
		   and library_schema.slug = 'library'`,
		[input.entityId, input.userId],
	);
	return Number(result.rows[0]?.count ?? 0);
};
