import type { PluginIdentityReference } from "@ryot-app/contract/modules/plugins/references";
import {
	MediaHistoryCorrectionRetryInput,
	MediaHistoryCorrectionRetryOutput,
	mediaHistoryCorrectionStatusRecipe,
} from "@ryot-app/media-plugin/shared/history-correction-status";
import { PLUGIN_PACKAGE_ID } from "@ryot-app/media-plugin/shared/plugin-identity";
import { defineOperationRecipe } from "@ryot-app/plugin-kit/operations";
import {
	and,
	ascending,
	castText,
	column,
	defineRecipe,
	eq,
	jsonPath,
	literal,
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	table,
} from "@ryot-app/ryotql";
import { Effect, Result, Schema } from "effect";
import getPort from "get-port";

import {
	createAuthenticatedClient,
	executeRyotQLRecipe,
	listEventsForEntity,
	pollUntil,
	waitForCreateEvents,
} from "~/fixtures/kernel";
import { invokeOperation } from "~/fixtures/kernel/operations";
import {
	createBuiltinMediaLifecycleFixture,
	mediaReferenceForEntity,
} from "~/fixtures/plugins/media";
import { describe, expect, it } from "~/support/effect-test";
import {
	buildApiEnv,
	startApiProcess,
	startCoreTestInfrastructure,
	stopApiProcess,
} from "~/support/provisioning";

const retryRecipe = defineOperationRecipe({
	packageId: PLUGIN_PACKAGE_ID,
	input: MediaHistoryCorrectionRetryInput,
	output: MediaHistoryCorrectionRetryOutput,
	operationSlug: "media-history-correction-retry",
});

const checkpointRecipe = defineRecipe(
	(input: { entityId: string; reference: PluginIdentityReference }) => {
		const checkpoint = table("event", "checkpoint");
		return {
			map: ({ checkpoint: row }) => Result.succeed(row),
			queries: {
				checkpoint: selectedOptionalRow(checkpoint, {
					orderBy: [ascending(column(checkpoint, "id"))],
					selection: {
						properties: selectedField(
							column(checkpoint, "properties"),
							Schema.Struct({ step: Schema.Int, phase: Schema.String }),
						),
					},
					where: and(
						schemaOwnerPredicate(checkpoint, "eventSchemaPluginId", input.reference),
						eq(column(checkpoint, "eventSchemaSlug"), literal("history-correction")),
						eq(
							castText(jsonPath(column(checkpoint, "properties"), "subjectEntityId")),
							literal(input.entityId),
						),
					),
				}),
			},
		};
	},
);

describe("Media history correction recovery", () => {
	it.live("resumes a committed continuation after restart and replays explicit retry safely", () =>
		Effect.gen(function* () {
			const bucketName = "ryot-history-recovery";
			const infrastructure = yield* startCoreTestInfrastructure({ bucketName });
			const port = yield* Effect.promise(() => getPort());
			const env = buildApiEnv({
				port,
				s3BucketName: bucketName,
				label: "History recovery",
				dbUrl: infrastructure.dbUrl,
				redisUrl: infrastructure.redisUrl,
				s3Endpoint: infrastructure.s3Endpoint,
				frontendUrl: `http://127.0.0.1:${port}`,
			});
			const first = yield* startApiProcess(env, "History recovery before restart");
			const { client } = yield* createAuthenticatedClient(first.target);
			const movie = yield* createBuiltinMediaLifecycleFixture(client, {
				entitySchemaSlug: "movie",
			});
			const reference = yield* mediaReferenceForEntity(client, movie.entityId);
			const created = yield* client.call((c) =>
				c.events.create({
					payload: Array.from({ length: 20 }, (_, index) => ({
						entityId: movie.entityId,
						eventSchemaSlug: movie.progressEventSchemaSlug,
						properties: { progressPercent: index === 19 ? 100 : 50 },
						occurredAt: `2026-01-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
					})),
				}),
			);
			yield* waitForCreateEvents(client, created);
			yield* pollUntil(
				"committed history continuation",
				executeRyotQLRecipe(client, checkpointRecipe({ reference, entityId: movie.entityId })).pipe(
					Effect.map((row) =>
						row && row.properties.step >= 8 && row.properties.phase !== "done" ? row : null,
					),
				),
			);
			yield* stopApiProcess(first);
			const restarted = yield* startApiProcess(env, "History recovery after restart");
			const status = () =>
				executeRyotQLRecipe(
					client,
					mediaHistoryCorrectionStatusRecipe({ reference, entityId: movie.entityId }),
				);
			yield* pollUntil(
				"restarted history work",
				status().pipe(Effect.map((row) => (row.status === "settled" ? row : null))),
			);
			const completions = () =>
				listEventsForEntity(client, movie.entityId, undefined, 100).pipe(
					Effect.map((rows) => rows.filter((row) => row.eventSchemaSlug === "complete")),
				);
			const original = yield* completions();
			expect(original).toHaveLength(1);
			const submissionId = crypto.randomUUID();
			const input = { submissionId, entityId: movie.entityId };
			const retry = yield* invokeOperation(client, retryRecipe, input, {
				idempotencyKey: submissionId,
			});
			expect(
				yield* invokeOperation(client, retryRecipe, input, { idempotencyKey: submissionId }),
			).toEqual(retry);
			yield* pollUntil(
				"explicit history retry",
				status().pipe(Effect.map((row) => (row.status === "settled" ? row : null))),
			);
			expect(yield* completions()).toEqual(original);
			yield* stopApiProcess(restarted);
		}),
	);
});
