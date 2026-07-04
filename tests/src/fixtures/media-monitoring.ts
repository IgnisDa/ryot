import { EntityId } from "@ryot/contract/schema/brands";
import {
	buildQueryEngineRowsDocument,
	queryEngineComparison,
	queryEngineField,
	queryEngineLiteral,
	queryEngineOrder,
	queryEngineRelationshipSource,
	queryEngineSystemRef,
} from "@ryot/query-engine";

import { getPgClient } from "~/setup";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getBackendClient } from "./contract-client";
import { pollUntil } from "./polling";
import { executeQueryEngine } from "./query-engine-core";

export const waitForMediaMonitoringRefresh = (executionId: string) =>
	pollUntil("media monitoring refresh workflow completion", async () => {
		const result = await getPgClient().query<{ complete: boolean }>(
			`select exists (
				select 1
				from cluster_messages m
				inner join cluster_replies r on r.request_id = m.id
				where m.entity_type = 'Workflow/MediaMonitoringRefreshWorkflow'
				  and m.tag = 'run'
				  and m.payload like ('%' || $1 || '%')
				  and r.payload not like '%Suspended%'
			) as complete`,
			[executionId],
		);
		return result.rows[0]?.complete ? true : null;
	});

export async function triggerCronAndWaitForEntity(entityId: string) {
	const result = await getBackendClient().run(
		(c) => c.testSupport.triggerInfrequentCron(),
		adminHeaders,
	);
	await waitForMediaMonitoringRefresh(`${result.executionId}-${entityId}`);
}

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
	client: Client;
	entityId: string;
	entitySchemaSlug: string;
}) => {
	const result = await executeQueryEngine(
		input.client,
		buildQueryEngineRowsDocument({
			limit: 1,
			fields: [queryEngineField("id", queryEngineSystemRef("relationship", "id"))],
			orderBy: [queryEngineOrder("asc", queryEngineSystemRef("relationship", "id"))],
			source: queryEngineRelationshipSource({
				alias: "relationship",
				schemas: ["media-monitoring"],
				targetEntity: { alias: "library", schemas: ["library"] },
				sourceEntity: { alias: "media", schemas: [input.entitySchemaSlug] },
				where: queryEngineComparison(
					"eq",
					queryEngineSystemRef("media", "id"),
					queryEngineLiteral(input.entityId),
				),
			}),
		}),
	);
	return result.data.pageInfo.total;
};
