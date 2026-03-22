import { EntityId, UserId } from "@ryot/contract/schema/brands";
import {
	buildQueryEngineRowsDocument,
	queryEngineRelationshipSource,
} from "@ryot/query-engine/documents";
import {
	queryEngineComparison,
	queryEngineField,
	queryEngineLiteral,
	queryEngineOrder,
	queryEngineSystemRef,
} from "@ryot/query-engine/primitives";
import { Effect } from "effect";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getBackendClient } from "./contract-client";
import { openInterestStreamScoped } from "./interest-sse";
import { executeQueryEngine } from "./query-engine-core";

export const triggerCronAndWaitForEntity = (
	auth: { cookies: string; userId: string },
	entityId: string,
) =>
	Effect.scoped(
		Effect.gen(function* () {
			const stream = yield* openInterestStreamScoped(auth);
			yield* getBackendClient().call(
				(c) =>
					c.testSupport.setEntityInterest({
						payload: {
							streamId: stream.streamId,
							userId: UserId.make(auth.userId),
							entityIds: [EntityId.make(entityId)],
						},
					}),
				adminHeaders,
			);
			yield* getBackendClient().call((c) => c.testSupport.triggerInfrequentCron(), adminHeaders);
			yield* Effect.promise(() => stream.waitForEntityUpdated(entityId, "populated"));
		}),
	);

export const getMediaMonitoringStatus = (client: Client, entityId: string) =>
	client.call((contract) =>
		contract.mediaMonitoring.status({ path: { entityId: EntityId.make(entityId) } }),
	);

export const enableMediaMonitoring = (client: Client, entityId: string) =>
	client.call((contract) =>
		contract.mediaMonitoring.enable({ path: { entityId: EntityId.make(entityId) } }),
	);

export const disableMediaMonitoring = (client: Client, entityId: string) =>
	client.call((contract) =>
		contract.mediaMonitoring.disable({ path: { entityId: EntityId.make(entityId) } }),
	);

export const countMediaMonitoringRelationships = (input: {
	client: Client;
	entityId: string;
	entitySchemaSlug: string;
}) =>
	Effect.gen(function* () {
		const result = yield* executeQueryEngine(
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
	});
