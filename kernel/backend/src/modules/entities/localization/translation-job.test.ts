import { expect } from "bun:test";

import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref } from "effect";

import type { EnrichmentRequestPatch } from "#modules/entities/enrichment/repository";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { enrichmentRequestRow } from "#modules/entities/enrichment/requests.test-support";
import type { SandboxExecutionResult } from "#modules/scripts/executions/result";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { fakeDatabaseSession } from "#testing/effect";

import type { TranslationOverlayInput } from "./repository";
import { TranslationsService } from "./service";
import { runEntityTranslationJob } from "./translation-job";
import { EntityTranslationJob } from "./translation-request";
import { translationExecution, translationPayload } from "./translation.test-support";

const requestId = "translation-request";

class TranslationEvidence extends Context.Service<
	TranslationEvidence,
	{
		readonly released: Effect.Effect<ReadonlyArray<string>>;
		readonly updates: Effect.Effect<ReadonlyArray<EnrichmentRequestPatch>>;
		readonly upserts: Effect.Effect<ReadonlyArray<TranslationOverlayInput>>;
	}
>()(
	"@ryot-app/kernel-backend/modules/entities/localization/translation-job.test/TranslationEvidence",
) {}

const jobLayer = (result: SandboxExecutionResult) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const updates = yield* Ref.make<ReadonlyArray<EnrichmentRequestPatch>>([]);
			const released = yield* Ref.make<ReadonlyArray<string>>([]);
			const upserts = yield* Ref.make<ReadonlyArray<TranslationOverlayInput>>([]);
			const row = enrichmentRequestRow({
				level: null,
				id: requestId,
				language: "es",
				scopeUserId: null,
				operation: "translation",
				payload: translationPayload,
				requester: translationPayload.userId,
				entityId: translationPayload.entityId,
				externalId: translationPayload.externalId,
				providerId: translationPayload.providerId,
				pluginId: translationPayload.entitySchemaPluginId,
				entitySchemaSlug: translationPayload.entitySchemaSlug,
			});
			return Layer.mergeAll(
				fakeDatabaseSession({ execute: () => Effect.succeed([]) }),
				Layer.mock(EnrichmentRequests)({
					get: () => Effect.succeed(row),
					update: (_id, patch) => Ref.update(updates, (all) => [...all, patch]),
				}),
				Layer.mock(ScriptExecutionService)({
					executeScript: () => Effect.succeed(result),
					releaseWorkflowRegistration: (id) => Ref.update(released, (all) => [...all, id]),
				}),
				Layer.mock(TranslationsService)({
					admitExecution: () => Effect.succeed(translationExecution),
					upsert: (input) =>
						Ref.update(upserts, (all) => [...all, input]).pipe(
							Effect.as({ entityId: input.entityId, language: input.language }),
						),
				}),
				Layer.succeed(TranslationEvidence, {
					upserts: Ref.get(upserts),
					updates: Ref.get(updates),
					released: Ref.get(released),
				}),
			);
		}),
	);

const completed = (value: unknown): SandboxExecutionResult => ({
	value,
	logs: [],
	error: null,
	status: "completed",
});

const run = (attempt = 1) => runEntityTranslationJob({ requestId }, { attempt, id: "job-1" });

layer(jobLayer(completed({ name: "Libro de Prueba", properties: { title: "Libro de Prueba" } })))(
	(test) => {
		test.effect(
			"upserts the translation overlay, settles the request, and releases its registration",
			() =>
				Effect.gen(function* () {
					yield* run();
					const evidence = yield* TranslationEvidence;
					expect(yield* evidence.upserts).toMatchObject([
						{
							language: "es",
							entityId: "entity-1",
							name: "Libro de Prueba",
							properties: { title: "Libro de Prueba" },
						},
					]);
					expect((yield* evidence.updates).map(({ state }) => state)).toEqual([
						"running",
						"succeeded",
					]);
					expect(yield* evidence.released).toEqual([requestId]);
				}),
			testTimeout,
		);
	},
);

layer(jobLayer(completed({})))((test) => {
	test.effect(
		"writes a successful empty negative cache with its captured content generation",
		() =>
			Effect.gen(function* () {
				yield* run();
				expect(yield* (yield* TranslationEvidence).upserts).toMatchObject([
					{ name: null, properties: null, sourceContentGeneration: 1 },
				]);
			}),
		testTimeout,
	);
});

layer(
	jobLayer({
		...completed(null),
		error: { phase: "execute", kind: "script-failure", message: "Translate script failed" },
	}),
)((test) => {
	test.effect(
		"fails the request with the script's reported error",
		() =>
			Effect.gen(function* () {
				yield* run();
				const evidence = yield* TranslationEvidence;
				expect((yield* evidence.updates).at(-1)).toEqual({
					attempt: 1,
					state: "failed",
					failureKind: "script-failure",
				});
				expect(yield* evidence.upserts).toEqual([]);
				expect(yield* evidence.released).toEqual([requestId]);
			}),
		testTimeout,
	);
});

layer(jobLayer(completed({ name: 12345 })))((test) => {
	test.effect(
		"fails the request when the result does not decode as a translation",
		() =>
			Effect.gen(function* () {
				yield* run();
				expect((yield* (yield* TranslationEvidence).updates).at(-1)).toMatchObject({
					state: "failed",
					failureKind: "invalid-output",
				});
			}),
		testTimeout,
	);
});

layer(
	jobLayer({
		...completed(null),
		error: { phase: "execute", kind: "infrastructure", message: "Daemon unavailable" },
	}),
)((test) => {
	test.effect(
		"leaves a transient failure to the job's next attempt and fails the last one",
		() =>
			Effect.gen(function* () {
				const evidence = yield* TranslationEvidence;
				expect((yield* Effect.flip(run(1))).kind).toBe("infrastructure");
				expect((yield* evidence.updates).at(-1)).toMatchObject({ state: "retrying" });
				expect(yield* evidence.released).toEqual([]);
				yield* run(EntityTranslationJob.maxAttempts);
				expect((yield* evidence.updates).at(-1)).toMatchObject({
					state: "failed",
					failureKind: "infrastructure",
				});
				expect(yield* evidence.released).toEqual([requestId]);
			}),
		testTimeout,
	);
});
