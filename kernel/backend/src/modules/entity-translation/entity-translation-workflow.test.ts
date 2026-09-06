import { assert, expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { EntityId, SandboxProviderId, UserId } from "@ryot-app/contract/schema/brands";
import { Cause, Context, Effect, Exit, Layer, Option, Ref, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { RedisService } from "#lib/infrastructure/redis";
import {
	databaseLayer,
	makeRedisService,
	makeWorkflowActivityEngine,
} from "#lib/test-utils/effect";

import { TranslateEntityWorkflowPayload } from "./entity-translation-workflow";
import { runTranslateEntityWorkflow } from "./entity-translation-workflow-live";
import {
	TranslateEntityWorkflowOperations,
	type TranslateEntityWorkflowOperationsValue,
} from "./operations-workflow";
import type { TranslationOverlayInput } from "./repository";
import { TranslationsService } from "./service";

const TestTranslateEntityWorkflow = Workflow.make("TestTranslateEntityWorkflow", {
	success: Schema.Void,
	error: SandboxRunError,
	payload: TranslateEntityWorkflowPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

const payload = {
	language: "es",
	externalId: "ext-1",
	executionId: "exec-1",
	entitySchemaSlug: "record",
	userId: UserId.make("user-1"),
	entityId: EntityId.make("entity-1"),
	properties: { title: "Test Record" },
	providerId: SandboxProviderId.make("provider-1"),
	accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
} satisfies TranslateEntityWorkflowPayload;

class FakeTranslationEffects extends Context.Service<
	FakeTranslationEffects,
	{
		readonly upserts: Effect.Effect<ReadonlyArray<TranslationOverlayInput>>;
		readonly published: Effect.Effect<ReadonlyArray<{ channel: string; message: string }>>;
	}
>()("test/FakeTranslationEffects") {}

const makeTestLayer = (processSandbox: TranslateEntityWorkflowOperationsValue["processSandbox"]) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const upserts = yield* Ref.make<ReadonlyArray<TranslationOverlayInput>>([]);
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
				Layer.mock(TranslateEntityWorkflowOperations, { processSandbox }),
				Layer.mock(TranslationsService)({
					requestFill: () => Effect.void,
					upsert: (input) =>
						Ref.update(upserts, (all) => [...all, input]).pipe(
							Effect.as({ entityId: input.entityId, language: input.language }),
						),
				}),
				Layer.succeed(FakeTranslationEffects, {
					upserts: Ref.get(upserts),
					published: Ref.get(published),
				}),
			);
		}),
	);

layer(
	makeTestLayer(() =>
		Effect.succeed({
			logs: [],
			error: null,
			status: "completed" as const,
			value: { name: "Libro de Prueba", properties: { title: "Libro de Prueba" } },
		}),
	),
)((test) => {
	test.effect("upserts the translation overlay and publishes an update on success", () =>
		Effect.gen(function* () {
			yield* runTranslateEntityWorkflow(payload, payload.executionId);

			const effects = yield* FakeTranslationEffects;
			const [upsertedInput] = yield* effects.upserts;
			expect(upsertedInput).toMatchObject({
				language: "es",
				entityId: "entity-1",
				name: "Libro de Prueba",
				properties: { title: "Libro de Prueba" },
			});
			expect(yield* effects.published).toHaveLength(1);
		}),
	);
});

layer(
	makeTestLayer(() =>
		Effect.succeed({
			logs: [],
			value: null,
			status: "completed" as const,
			error: {
				phase: "execute" as const,
				kind: "script-failure" as const,
				message: "Translate script execution failed",
			},
		}),
	),
)((test) => {
	test.effect("fails with the sandbox's reported error", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(runTranslateEntityWorkflow(payload, payload.executionId));

			assert(Exit.isFailure(exit));
			const failure = Cause.findErrorOption(exit.cause);
			assert(Option.isSome(failure));
			assert(failure.value instanceof Error);
			expect(failure.value.message).toBe("Translate script execution failed");
		}),
	);
});

layer(
	makeTestLayer(() =>
		Effect.succeed({ logs: [], error: null, value: { name: 12345 }, status: "completed" as const }),
	),
)((test) => {
	test.effect("fails when the sandbox result does not decode as a translate result", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(runTranslateEntityWorkflow(payload, payload.executionId));

			assert(Exit.isFailure(exit));
			const failure = Cause.findErrorOption(exit.cause);
			assert(Option.isSome(failure));
			assert(failure.value instanceof Error);
			expect(failure.value.message).toContain("Invalid translate result");
		}),
	);
});
