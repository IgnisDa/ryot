import { assert, expect, it } from "@effect/vitest";
import { SandboxRunError } from "@ryot/contract/errors";
import { EntityId, SandboxProviderId, UserId } from "@ryot/contract/schema/brands";
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { RedisService } from "#lib/infrastructure/redis";
import type { MockOverrides } from "#lib/test-utils/effect";
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
	properties: { title: "Test Record" },
	userId: UserId.make("user-1"),
	entityId: EntityId.make("entity-1"),
	providerId: SandboxProviderId.make("provider-1"),
} satisfies TranslateEntityWorkflowPayload;

const mockTranslationsService = Layer.mock(TranslationsService);

const makeTranslationsService = (overrides: MockOverrides<typeof mockTranslationsService> = {}) =>
	mockTranslationsService({
		requestFill: () => Effect.void,
		upsert: () => Effect.sync(() => undefined),
		...overrides,
	});

type TestLayerOptions = {
	translationsService?: Layer.Layer<TranslationsService>;
	publishedMessages?: Array<{ channel: string; message: string }>;
	processSandbox?: TranslateEntityWorkflowOperationsValue["processSandbox"];
};

const makeTestLayer = (options: TestLayerOptions) =>
	Layer.mergeAll(
		databaseLayer,
		Layer.succeed(
			RedisService,
			makeRedisService({
				publish: (channel, message) => {
					options.publishedMessages?.push({ channel, message });
					return Effect.succeed(0);
				},
			}),
		),
		Layer.mock(TranslateEntityWorkflowOperations, {
			processSandbox: options.processSandbox ?? (() => Effect.die("unused")),
		}),
		options.translationsService ?? makeTranslationsService(),
	);

const withTestLayer = <A, E, R>(
	options: TestLayerOptions,
	executionId: string,
	effect: Effect.Effect<A, E, R>,
) => {
	const instance = WorkflowInstance.initial(TestTranslateEntityWorkflow, executionId);
	const engine = makeWorkflowActivityEngine(instance);

	return effect.pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(makeTestLayer(options)),
	);
};

it.effect("upserts the translation overlay and publishes an update on success", () => {
	let upsertedInput: unknown;
	const publishedMessages: Array<{ channel: string; message: string }> = [];

	const options = {
		publishedMessages,
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				error: null,
				status: "completed" as const,
				value: { name: "Libro de Prueba", properties: { title: "Libro de Prueba" } },
			}),
		translationsService: makeTranslationsService({
			upsert: (input) => {
				upsertedInput = input;
				return Effect.sync(() => undefined);
			},
		}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			yield* runTranslateEntityWorkflow(payload, payload.executionId);

			expect(upsertedInput).toMatchObject({
				language: "es",
				entityId: "entity-1",
				name: "Libro de Prueba",
				properties: { title: "Libro de Prueba" },
			});
			expect(publishedMessages).toHaveLength(1);
		}),
	);
});

it.effect("fails with the sandbox's reported error", () => {
	const options = {
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				value: null,
				status: "completed" as const,
				error: { phase: "execute" as const, message: "Translate script execution failed" },
			}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
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

it.effect("fails when the sandbox result does not decode as a translate result", () => {
	const options = {
		processSandbox: () =>
			Effect.succeed({
				logs: [],
				error: null,
				value: { name: 12345 },
				status: "completed" as const,
			}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
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
