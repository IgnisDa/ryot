import { expect, it } from "@effect/vitest";
import { Workflow } from "@effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { SandboxRunError } from "@ryot/contract/errors";
import { EntityId, SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect, Layer, Schema } from "effect";

import { RedisService } from "#lib/redis";
import type { MockOverrides } from "#lib/test-support/effect";
import {
	dbRunnerLayer,
	makeRedisService,
	makeWorkflowActivityEngine,
} from "#lib/test-support/effect";

import { TranslationsRepository } from "./repository";
import {
	TranslateEntityWorkflowOperations,
	type TranslateEntityWorkflowOperationsValue,
	TranslateEntityWorkflowPayload,
	runTranslateEntityWorkflow,
} from "./workflows";

const TestTranslateEntityWorkflow = Workflow.make({
	success: Schema.Void,
	error: SandboxRunError,
	name: "TestTranslateEntityWorkflow",
	payload: TranslateEntityWorkflowPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

const payload = {
	language: "es",
	externalId: "ext-1",
	executionId: "exec-1",
	entitySchemaSlug: "book",
	properties: { title: "Test Book" },
	entityId: EntityId.make("entity-1"),
	scriptId: SandboxScriptId.make("script-1"),
} satisfies TranslateEntityWorkflowPayload;

const mockTranslationsRepository = Layer.mock(TranslationsRepository);

const makeTranslationsRepository = (
	overrides: MockOverrides<typeof mockTranslationsRepository> = {},
) =>
	mockTranslationsRepository({
		_tag: "TranslationsRepository",
		upsertOverlay: () => Effect.void,
		...overrides,
	});

type TestLayerOptions = {
	publishedMessages?: Array<{ channel: string; message: string }>;
	processSandbox?: TranslateEntityWorkflowOperationsValue["processSandbox"];
	translationsRepository?: Layer.Layer<TranslationsRepository>;
};

const makeTestLayer = (options: TestLayerOptions) =>
	Layer.mergeAll(
		dbRunnerLayer,
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
		options.translationsRepository ?? makeTranslationsRepository(),
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

it.effect("writes the translation overlay and publishes an update on success", () => {
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
		translationsRepository: makeTranslationsRepository({
			upsertOverlay: (input) => {
				upsertedInput = input;
				return Effect.void;
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
				error: "Translate script execution failed",
			}),
	} satisfies TestLayerOptions;

	return withTestLayer(
		options,
		payload.executionId,
		Effect.gen(function* () {
			const exit = yield* Effect.exit(runTranslateEntityWorkflow(payload, payload.executionId));

			expect(exit._tag).toBe("Failure");
			if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
				expect(exit.cause.error.message).toBe("Translate script execution failed");
			}
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

			expect(exit._tag).toBe("Failure");
			if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
				expect(exit.cause.error.message).toContain("Invalid translate result");
			}
		}),
	);
});
