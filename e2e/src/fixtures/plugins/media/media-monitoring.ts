import { EntityId, PluginSlug } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import {
	mediaMonitoringDisableRecipe,
	mediaMonitoringEnableRecipe,
	mediaMonitoringStatusRecipe,
} from "@ryot-app/media-plugin/contracts/operation-recipes";
import { invokeOperationRecipe } from "@ryot-app/plugin-kit/operations";
import {
	aggregate,
	and,
	column,
	document,
	eq,
	join,
	literal,
	measure,
	table,
} from "@ryot-app/ryotql";
import { Effect } from "effect";

import { adminHeaders } from "~/fixtures/kernel/admin";
import type { Client } from "~/fixtures/kernel/auth";
import { getApiClient } from "~/fixtures/kernel/contract-client";
import { openInterestWebSocketScoped } from "~/fixtures/kernel/interest-websocket";
import { executeRyotQL, requireRyotQLValue } from "~/fixtures/kernel/ryotql";
import { assertCondition } from "~/support/assertions";

export const triggerCronAndWaitForEntity = (auth: { client: Client }, entityId: string) =>
	Effect.scoped(
		Effect.gen(function* () {
			const socket = yield* openInterestWebSocketScoped(auth);
			yield* getApiClient().call(
				(c) =>
					c.testSupport.setEntityInterestMembership({
						payload: {
							sessionId: socket.ready.sessionId,
							entityIds: [EntityId.make(entityId)],
						},
					}),
				adminHeaders(),
			);
			const cron = yield* getApiClient().call(
				(c) =>
					c.testSupport.triggerPluginCron({
						payload: {
							cronSlug: "media-monitoring",
							pluginSlug: PluginSlug.make("media"),
						},
					}),
				adminHeaders(),
			);
			assertCondition(
				cron.status === "executed",
				`Media monitoring cron failed: ${JSON.stringify(cron)}`,
			);
			yield* Effect.promise(() => socket.waitForEntityUpdated(entityId, "populated"));
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
	(client: Client) =>
	(request: { payload: JsonValue; pluginSlug: string; operationSlug: string }) =>
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

const singleResult = <Result>(output: {
	readonly results: readonly Result[];
}): Effect.Effect<Result> =>
	output.results[0]
		? Effect.succeed(output.results[0])
		: Effect.die("Media monitoring operation returned no aligned result");

export const countMediaMonitoringRelationships = (input: {
	client: Client;
	entityId: string;
	entitySchemaSlug: string;
}) =>
	Effect.gen(function* () {
		const relationship = table("relationship", "relationship");
		const media = table("entity", "media");
		const library = table("entity", "library");
		const result = yield* executeRyotQL(
			input.client,
			document({
				relationships: aggregate(relationship, {
					measures: [measure("count", { function: "count" })],
					where: and(
						eq(column(relationship, "relationshipSchemaSlug"), literal("media-monitoring")),
						eq(column(media, "id"), literal(input.entityId)),
						eq(column(media, "entitySchemaSlug"), literal(input.entitySchemaSlug)),
						eq(column(library, "entitySchemaSlug"), literal("library")),
					),
					joins: [
						join("inner", media, eq(column(relationship, "sourceEntityId"), column(media, "id"))),
						join(
							"inner",
							library,
							eq(column(relationship, "targetEntityId"), column(library, "id")),
						),
					],
				}),
			}),
		);
		const relationships = result.data.relationships;
		if (relationships?.type !== "aggregate") {
			throw new Error("Expected 'relationships' aggregate");
		}
		const count = relationships.items[0];
		return count ? requireRyotQLValue(count, "count") : 0;
	});
