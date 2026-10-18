import { assert, expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { Cause, Context, Effect, Exit, Layer, Option, Ref, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { RedisService } from "#platform/redis";
import { databaseLayer, makeRedisService, makeWorkflowActivityEngine } from "#testing/effect";

import { TranslateEntityAttemptWorkflowPayload } from "./entity-translation-workflow";
import { runTranslateEntityAttemptWorkflow } from "./entity-translation-workflow-live";
import {
	TranslateEntityWorkflowOperations,
	type TranslateEntityWorkflowOperationsValue,
} from "./operations-workflow";
import type { TranslationOverlayInput } from "./repository";
import { TranslationsService } from "./service";
import { translationExecution, translationPayload } from "./translation.test-support";

const payload = { ...translationPayload, requestId: "request-1", execution: translationExecution };

const TestTranslateEntityWorkflow = Workflow.make("TestTranslateEntityWorkflow", {
	success: Schema.Void,
	error: SandboxRunError,
	payload: TranslateEntityAttemptWorkflowPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

class FakeTranslationEffects extends Context.Service<
	FakeTranslationEffects,
	{
		readonly released: Effect.Effect<ReadonlyArray<string>>;
		readonly upserts: Effect.Effect<ReadonlyArray<TranslationOverlayInput>>;
		readonly published: Effect.Effect<ReadonlyArray<{ channel: string; message: string }>>;
	}
>()("test/FakeTranslationEffects") {}

const makeTestLayer = (processSandbox: TranslateEntityWorkflowOperationsValue["processSandbox"]) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const upserts = yield* Ref.make<ReadonlyArray<TranslationOverlayInput>>([]);
			const released = yield* Ref.make<ReadonlyArray<string>>([]);
			const published = yield* Ref.make<ReadonlyArray<{ channel: string; message: string }>>([]);
			const instance = WorkflowInstance.initial(TestTranslateEntityWorkflow, payload.executionId);
			return Layer.mergeAll(
				databaseLayer,
				Layer.succeed(WorkflowInstance, instance),
				Layer.succeed(WorkflowEngine, makeWorkflowActivityEngine(instance)),
				Layer.succeed(
					RedisService,
					makeRedisService({
						publish: (channel, message) =>
							Ref.update(published, (all) => [...all, { channel, message }]).pipe(Effect.as(0)),
					}),
				),
				Layer.succeed(TranslateEntityWorkflowOperations, {
					processSandbox,
					captureExecution: () => Effect.succeed(translationExecution),
					releaseRegistration: (executionId) =>
						Ref.update(released, (all) => [...all, executionId]),
				}),
				Layer.mock(TranslationsService)({
					requestFill: () => Effect.succeed(true),
					upsert: (input) =>
						Ref.update(upserts, (all) => [...all, input]).pipe(
							Effect.as({ entityId: input.entityId, language: input.language }),
						),
				}),
				Layer.succeed(FakeTranslationEffects, {
					upserts: Ref.get(upserts),
					released: Ref.get(released),
					published: Ref.get(published),
				}),
			);
		}),
	);

layer(
	makeTestLayer(() =>
		Effect.succeed({
			execution: translationExecution,
			result: {
				logs: [],
				error: null,
				status: "completed" as const,
				value: { name: "Libro de Prueba", properties: { title: "Libro de Prueba" } },
			},
		}),
	),
)((test) => {
	test.effect("upserts the translation overlay and publishes an update on success", () =>
		Effect.gen(function* () {
			yield* runTranslateEntityAttemptWorkflow(payload, payload.executionId);

			const effects = yield* FakeTranslationEffects;
			const [upsertedInput] = yield* effects.upserts;
			expect(upsertedInput).toMatchObject({
				language: "es",
				entityId: "entity-1",
				name: "Libro de Prueba",
				properties: { title: "Libro de Prueba" },
			});
			expect(yield* effects.published).toHaveLength(1);
			expect(yield* effects.released).toEqual([]);
		}),
	);
});

layer(
	makeTestLayer(() =>
		Effect.succeed({
			execution: translationExecution,
			result: {
				logs: [],
				value: null,
				status: "completed" as const,
				error: {
					phase: "execute" as const,
					kind: "script-failure" as const,
					message: "Translate script execution failed",
				},
			},
		}),
	),
)((test) => {
	test.effect("fails with the sandbox's reported error", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				runTranslateEntityAttemptWorkflow(payload, payload.executionId),
			);

			assert(Exit.isFailure(exit));
			const failure = Cause.findErrorOption(exit.cause);
			assert(Option.isSome(failure));
			assert(failure.value instanceof Error);
			expect(failure.value.message).toBe("Translate script execution failed");
			expect(yield* (yield* FakeTranslationEffects).released).toEqual([]);
		}),
	);
});

layer(
	makeTestLayer(() =>
		Effect.succeed({
			execution: translationExecution,
			result: { logs: [], error: null, value: { name: 12345 }, status: "completed" as const },
		}),
	),
)((test) => {
	test.effect("fails when the sandbox result does not decode as a translate result", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				runTranslateEntityAttemptWorkflow(payload, payload.executionId),
			);

			assert(Exit.isFailure(exit));
			const failure = Cause.findErrorOption(exit.cause);
			assert(Option.isSome(failure));
			assert(failure.value instanceof Error);
			expect(failure.value.message).toContain("Invalid translate result");
		}),
	);
});

layer(
	makeTestLayer(() =>
		Effect.succeed({
			execution: translationExecution,
			result: { logs: [], value: {}, error: null, status: "completed" as const },
		}),
	),
)((test) => {
	test.effect("writes a successful empty negative cache with its captured content generation", () =>
		Effect.gen(function* () {
			yield* runTranslateEntityAttemptWorkflow(payload, payload.executionId);
			expect(yield* (yield* FakeTranslationEffects).upserts).toMatchObject([
				{ name: null, properties: null, sourceContentGeneration: 1 },
			]);
		}),
	);
});
