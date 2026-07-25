import { EntityId, PluginSlug, UserId } from "@ryot/contract/schema/brands";
import {
	mediaMonitoringDisableRecipe,
	mediaMonitoringEnableRecipe,
	mediaMonitoringStatusRecipe,
} from "@ryot/media-plugin/operations/recipes";
import { invokeOperationRecipe } from "@ryot/plugin-kit/operations";
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

import { assertCondition } from "~/support/assertions";

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
			const cron = yield* getBackendClient().call(
				(c) =>
					c.testSupport.triggerPluginCron({
						payload: {
							cronSlug: "media-monitoring",
							pluginSlug: PluginSlug.make("media"),
						},
					}),
				adminHeaders,
			);
			assertCondition(cron.status === "executed", "Media monitoring cron was not found");
			yield* Effect.promise(() => stream.waitForEntityUpdated(entityId, "populated"));
		}),
	);

export const getMediaMonitoringStatus = (client: Client, entityId: string) =>
	invokeOperationRecipe(
		mediaMonitoringStatusRecipe,
		{ entityIds: [entityId] },
		operationTransport(client),
	).pipe(Effect.flatMap(singleResult));

export const enableMediaMonitoring = (client: Client, entityId: string) =>
	invokeOperationRecipe(
		mediaMonitoringEnableRecipe,
		{ entityIds: [entityId] },
		operationTransport(client),
	).pipe(Effect.flatMap(singleResult));

export const disableMediaMonitoring = (client: Client, entityId: string) =>
	invokeOperationRecipe(
		mediaMonitoringDisableRecipe,
		{ entityIds: [entityId] },
		operationTransport(client),
	).pipe(Effect.flatMap(singleResult));

const operationTransport =
	(client: Client) => (request: { payload: unknown; pluginSlug: string; operationSlug: string }) =>
		client
			.call((contract) =>
				contract.plugins.invoke({
					payload: { payload: request.payload },
					params: {
						operationSlug: request.operationSlug,
						pluginSlug: PluginSlug.make(request.pluginSlug),
					},
				}),
			)
			.pipe(Effect.map(({ result }) => result));

const singleResult = <Result>(output: { readonly results: readonly Result[] }) =>
	output.results[0]
		? Effect.succeed(output.results[0])
		: Effect.die("Media monitoring operation returned no aligned result");

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
