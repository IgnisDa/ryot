import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { NotFound } from "@ryot/contract/errors";
import { SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";

import type { MockOverrides } from "#lib/test-utils/effect";
import { dbRunnerLayer, makeAppConfigLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { SandboxRepository } from "./repository";
import { SandboxExecutionService } from "./service";

const scriptId = SandboxScriptId.make("script-id");
const executingUserId = UserId.make("user-1");
const storedScript = {
	id: scriptId,
	metadata: {},
	compiledFormat: 1,
	isBuiltin: true as const,
	compiledCode: "compiled",
};

const mockRepository = Layer.mock(SandboxRepository);
const makeRepository = (overrides: MockOverrides<typeof mockRepository> = {}) =>
	mockRepository({ _tag: "SandboxRepository", ...overrides });
const makePluginRuntime = (
	findActiveScriptById: PluginRuntimeResolver["findActiveScriptById"] = () => Effect.succeed(null),
) =>
	Layer.mock(PluginRuntimeResolver)({
		_tag: "PluginRuntimeResolver",
		findActiveScriptById,
	});
const makeServiceLayer = (
	repository: ReturnType<typeof makeRepository>,
	pluginRuntime = makePluginRuntime(),
	workflowEngine = Layer.succeed(
		WorkflowEngine,
		makeWorkflowEngine({ execute: () => Effect.succeed(null) }),
	),
) =>
	SandboxExecutionService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				repository,
				workflowEngine,
				makeAppConfigLayer(),
				pluginRuntime,
			),
		),
	);

it.effect("executes an installed script as the explicit user", () => {
	let capturedOptions: Parameters<WorkflowEngine["Type"]["execute"]>[1] | undefined;
	const layer = makeServiceLayer(
		makeRepository({
			getScript: () => Effect.succeed(storedScript),
			isPluginScript: () => Effect.succeed(false),
		}),
		makePluginRuntime(),
		Layer.succeed(
			WorkflowEngine,
			makeWorkflowEngine({
				execute: (_workflow, options) => {
					capturedOptions = options;
					return Effect.succeed(null);
				},
			}),
		),
	);

	return Effect.gen(function* () {
		const service = yield* SandboxExecutionService;
		yield* service.enqueue(executingUserId, { scriptId, driverName: "run", context: {} });

		expect(capturedOptions?.payload).toMatchObject({
			scriptId,
			driverName: "run",
			userId: executingUserId,
		});
	}).pipe(Effect.provide(layer));
});

it.effect("rejects inactive plugin scripts before starting the workflow", () => {
	let executionCount = 0;
	const layer = makeServiceLayer(
		makeRepository({
			getScript: () => Effect.succeed(storedScript),
			isPluginScript: () => Effect.succeed(true),
		}),
		makePluginRuntime(),
		Layer.succeed(
			WorkflowEngine,
			makeWorkflowEngine({
				execute: () =>
					Effect.sync(() => {
						executionCount += 1;
						return null;
					}),
			}),
		),
	);

	return Effect.gen(function* () {
		const service = yield* SandboxExecutionService;
		const exit = yield* Effect.exit(
			service.enqueue(executingUserId, { scriptId, driverName: "run", context: {} }),
		);

		expect(exit).toEqual(Exit.fail(new NotFound({ message: "Sandbox script not found" })));
		expect(executionCount).toBe(0);
	}).pipe(Effect.provide(layer));
});

it.effect("polls a job only for its explicit executing user", () => {
	const otherUserId = UserId.make("user-2");
	const layer = makeServiceLayer(
		makeRepository({
			getScript: () => Effect.succeed(storedScript),
			isPluginScript: () => Effect.succeed(false),
		}),
		makePluginRuntime(),
		Layer.succeed(
			WorkflowEngine,
			makeWorkflowEngine({
				poll: () => Effect.void.pipe(Effect.as(undefined)),
				execute: () => Effect.succeed(null),
			}),
		),
	);

	return Effect.gen(function* () {
		const service = yield* SandboxExecutionService;
		const { jobId } = yield* service.enqueue(executingUserId, { scriptId, driverName: "run" });

		expect(yield* service.getResult(executingUserId, jobId)).toEqual({ status: "pending" });
		expect(yield* Effect.exit(service.getResult(otherUserId, jobId))).toEqual(
			Exit.fail(new NotFound({ message: "Sandbox job not found" })),
		);
	}).pipe(Effect.provide(layer));
});
