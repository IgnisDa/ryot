import type { ContractPayload, ContractPathParams } from "@ryot-app/contract/client";
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
import { Duration, Effect, Schema } from "effect";

import { adminHeaders } from "~/fixtures/kernel/admin";
import type { Client } from "~/fixtures/kernel/auth";
import { getApiClient } from "~/fixtures/kernel/contract-client";
import { getEntity } from "~/fixtures/kernel/entities";
import { pollUntil } from "~/fixtures/kernel/polling";
import { executeRyotQL, requireRyotQLValue } from "~/fixtures/kernel/ryotql";
import { assertCondition } from "~/support/assertions";

import { findMediaEntitySchema, mediaFixtureInstallation } from "./entity-schemas";

const CRON_TRIGGER_ATTEMPTS = 3;
const CRON_TRIGGER_RETRY_DELAY = Duration.millis(5_000);

export const triggerCronAndWaitForEntity = (auth: { client: Client }, entityId: string) =>
	Effect.gen(function* () {
		const previousPopulatedAt = (yield* getEntity(auth.client, entityId)).populatedAt;
		const pluginId = (yield* mediaFixtureInstallation).id;
		let lastCron: unknown;
		let refreshed = false;
		for (let attempt = 1; attempt <= CRON_TRIGGER_ATTEMPTS; attempt += 1) {
			const cron = yield* getApiClient().call(
				(c) =>
					c.testSupport.triggerPluginCron({ payload: { pluginId, cronSlug: "media-monitoring" } }),
				adminHeaders(),
			);
			lastCron = cron;
			if (cron.status === "executed") {
				refreshed = true;
				break;
			}
			const currentPopulatedAt = (yield* getEntity(auth.client, entityId)).populatedAt;
			if (currentPopulatedAt !== previousPopulatedAt) {
				refreshed = true;
				break;
			}
			if (attempt < CRON_TRIGGER_ATTEMPTS) {
				yield* Effect.sleep(CRON_TRIGGER_RETRY_DELAY);
			}
		}
		assertCondition(
			refreshed,
			`Media monitoring cron failed after ${CRON_TRIGGER_ATTEMPTS} attempts: ${yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(lastCron)}`,
		);
		yield* pollUntil(
			"media monitoring entity refresh",
			getEntity(auth.client, entityId).pipe(
				Effect.map((entity) =>
					entity.populatedAt !== previousPopulatedAt ? entity.populatedAt : null,
				),
			),
		);
	});

export const getMediaMonitoringStatus = (client: Client, entityId: string) =>
	mediaFixtureInstallation.pipe(
		Effect.flatMap(({ id }) =>
			invokeOperationRecipe(
				mediaMonitoringStatusRecipe(id),
				{ entityIds: [entityId] },
				operationTransport(client),
			),
		),
		Effect.flatMap(singleResult),
	);

export const enableMediaMonitoring = (client: Client, entityId: string) =>
	mediaFixtureInstallation.pipe(
		Effect.flatMap(({ id }) =>
			invokeOperationRecipe(
				mediaMonitoringEnableRecipe(id),
				{ entityIds: [entityId] },
				operationTransport(client),
			),
		),
		Effect.flatMap(singleResult),
	);

export const disableMediaMonitoring = (client: Client, entityId: string) =>
	mediaFixtureInstallation.pipe(
		Effect.flatMap(({ id }) =>
			invokeOperationRecipe(
				mediaMonitoringDisableRecipe(id),
				{ entityIds: [entityId] },
				operationTransport(client),
			),
		),
		Effect.flatMap(singleResult),
	);

const operationTransport =
	(client: Client) =>
	(
		request: Pick<ContractPayload<"plugins", "invoke">, "payload"> &
			ContractPathParams<"plugins", "invoke">,
	) =>
		client
			.call((contract) =>
				contract.plugins.invoke({
					payload: { payload: request.payload },
					params: { pluginId: request.pluginId, operationSlug: request.operationSlug },
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
		const { pluginId } = yield* findMediaEntitySchema(input.client, input.entitySchemaSlug);
		const relationship = table("relationship", "relationship");
		const media = table("entity", "media");
		const mediaLibrary = table("entity", "mediaLibrary");
		const result = yield* executeRyotQL(
			input.client,
			document({
				relationships: aggregate(relationship, {
					measures: [measure("count", { function: "count" })],
					joins: [
						join("inner", media, eq(column(relationship, "sourceEntityId"), column(media, "id"))),
						join(
							"inner",
							mediaLibrary,
							eq(column(relationship, "targetEntityId"), column(mediaLibrary, "id")),
						),
					],
					where: and(
						eq(column(relationship, "relationshipSchemaSlug"), literal("media-monitoring")),
						eq(column(relationship, "relationshipSchemaPluginId"), literal(pluginId)),
						eq(column(media, "id"), literal(input.entityId)),
						eq(column(media, "entitySchemaSlug"), literal(input.entitySchemaSlug)),
						eq(column(media, "entitySchemaPluginId"), literal(pluginId)),
						eq(column(mediaLibrary, "entitySchemaSlug"), literal("media-library")),
						eq(column(mediaLibrary, "entitySchemaPluginId"), literal(pluginId)),
					),
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
