import { EntityId, PluginSlug, UserId } from "@ryot/contract/schema/brands";
import {
	mediaMonitoringDisableRecipe,
	mediaMonitoringEnableRecipe,
	mediaMonitoringStatusRecipe,
} from "@ryot/media-plugin/operations/recipes";
import { invokeOperationRecipe } from "@ryot/plugin-kit/operations";
import {
	and,
	ascending,
	column,
	document,
	eq,
	field,
	join,
	literal,
	rows,
	table,
} from "@ryot/ryotql";
import { Effect } from "effect";

import { assertCondition } from "~/support/assertions";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getBackendClient } from "./contract-client";
import { openInterestStreamScoped } from "./interest-sse";
import { executeRyotQL } from "./ryotql";

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
		const relationship = table("relationship", "relationship");
		const media = table("entity", "media");
		const library = table("entity", "library");
		const result = yield* executeRyotQL(
			input.client,
			document({
				relationships: rows(relationship, {
					limit: 1,
					fields: [field("id", column(relationship, "id"))],
					orderBy: [ascending(column(relationship, "id"))],
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
		if (relationships?.type !== "rows") {
			throw new Error("Expected relationship rows");
		}
		return relationships.pageInfo.total;
	});
