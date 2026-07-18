import { expect, it } from "@effect/vitest";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { NotFound, SandboxRunError } from "@ryot/contract/errors";
import { SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";
import type { MockOverrides } from "#lib/test-utils/effect";
import {
	dbRunnerLayer,
	makeAppConfigLayer,
	makeWorkflowActivityEngine,
	makeWorkflowEngine,
} from "#lib/test-utils/effect";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { SandboxRepository } from "./repository";
import { SandboxScriptWorkflow } from "./sandbox-script-workflow";
import { SandboxExecutionService } from "./service";

const scriptId = SandboxScriptId.make("script-id");
const executingUserId = UserId.make("user-1");
const storedScript = {
	id: scriptId,
	metadata: {},
	providerId: null,
	compiledFormat: 1,
	compiledCode: "compiled",
	contentHash: "compiled-hash",
};

const mockRepository = Layer.mock(SandboxRepository);
const makeRepository = (overrides: MockOverrides<typeof mockRepository> = {}) =>
	mockRepository({ _tag: "SandboxRepository", ...overrides });
const makePluginRuntime = (
	findActiveScriptById: PluginRuntimeResolver["findActiveScriptById"] = () => Effect.succeed(null),
	findActiveWorkflowScript: PluginRuntimeResolver["findActiveWorkflowScript"] = () =>
		Effect.succeed(null),
) =>
	Layer.mock(PluginRuntimeResolver)({
		_tag: "PluginRuntimeResolver",
		findActiveScriptById,
		findActiveWorkflowScript,
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
		yield* service.enqueue(executingUserId, { scriptId, context: {} });

		expect(capturedOptions?.payload).toMatchObject({
			scriptId,
			authority: { type: "user", userId: executingUserId },
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
		const exit = yield* Effect.exit(service.enqueue(executingUserId, { scriptId, context: {} }));

		assertExitFails(exit, new NotFound({ message: "Sandbox script not found" }));
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
		const { jobId } = yield* service.enqueue(executingUserId, { scriptId });

		expect(yield* service.getResult(executingUserId, jobId)).toEqual({ status: "pending" });
		assertExitFails(
			yield* Effect.exit(service.getResult(otherUserId, jobId)),
			new NotFound({ message: "Sandbox job not found" }),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("resolves and executes a manifest workflow with an exact script pin", () => {
	const executionId = "media-resolution-1";
	const instance = WorkflowInstance.initial(SandboxScriptWorkflow, executionId);
	let capturedWorkflow: unknown;
	let capturedOptions: Parameters<WorkflowEngine["Type"]["execute"]>[1] | undefined;
	const engine = makeWorkflowActivityEngine(instance, {
		execute: (workflow, options) =>
			Effect.sync(() => {
				capturedWorkflow = workflow;
				capturedOptions = options;
				return { results: [] };
			}),
	});
	const layer = makeServiceLayer(
		makeRepository(),
		makePluginRuntime(undefined, () =>
			Effect.succeed({
				...storedScript,
				name: "Media resolution",
				source: "source",
				slug: "workflow.media-import-resolution",
				pluginSlug: "media",
				createdAt: new Date(0),
				updatedAt: new Date(0),
				contentHash: "workflow-hash",
				metadata: { kind: "workflow" as const },
			}),
		),
		Layer.succeed(WorkflowEngine, engine),
	);

	return Effect.gen(function* () {
		const service = yield* SandboxExecutionService;
		const resolvedScriptId = yield* service.resolveWorkflowScript({
			executionId,
			pluginSlug: "media",
			workflowSlug: "media-import-resolution",
		});
		const result = yield* service.executeWorkflow({
			executionId,
			scriptId: resolvedScriptId,
			input: { items: [], scriptId: "attempted-override" },
			authority: { type: "user", userId: executingUserId },
		});

		expect(result).toEqual({ results: [] });
		expect(capturedWorkflow).toBe(SandboxScriptWorkflow);
		expect(capturedOptions).toMatchObject({
			executionId,
			payload: {
				scriptId,
				resolutionMode: "exact",
				authority: { type: "user", userId: executingUserId },
				input: { items: [], scriptId: "attempted-override" },
			},
		});
	}).pipe(
		Effect.provideService(WorkflowEngine, engine),
		Effect.provideService(WorkflowInstance, instance),
		Effect.provide(layer),
	);
});

it.effect("rejects workflow input above the workflow limit before dispatch", () => {
	let executionCount = 0;
	const layer = makeServiceLayer(
		makeRepository(),
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
			service.executeWorkflow({
				scriptId,
				executionId: "oversized-workflow",
				input: "a".repeat(80 * 1024),
				authority: { type: "user", userId: executingUserId },
			}),
		);

		assertExitFails(
			exit,
			new SandboxRunError({
				message: "Sandbox definition context must be JSON and no larger than 65536 UTF-8 bytes",
			}),
		);
		expect(executionCount).toBe(0);
	}).pipe(Effect.provide(layer));
});
