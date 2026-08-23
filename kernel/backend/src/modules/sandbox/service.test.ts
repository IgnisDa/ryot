import { expect, it } from "@effect/vitest";
import { NotFound, SandboxRunError } from "@ryot-app/contract/errors";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import { assertExitFails } from "#lib/test-utils/assertions";
import type { MockOverrides } from "#lib/test-utils/effect";
import {
	databaseLayer,
	makeAppConfigLayer,
	makeWorkflowActivityEngine,
	makeWorkflowEngine,
} from "#lib/test-utils/effect";

import {
	SandboxPluginScriptResolver,
	type SandboxPluginScriptResolverValue,
} from "./plugin-script-resolver";
import { SandboxRepository } from "./repository";
import { SandboxScriptWorkflow } from "./sandbox-script-workflow";
import { SandboxExecutionService } from "./service";
import { SandboxWorkflowReferenceRepository } from "./workflow-reference-repository";

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
const storedWorkflowScript = {
	...storedScript,
	name: "Workflow",
	source: "source",
	slug: "workflow",
	pluginSlug: "fixture",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	metadata: { kind: "workflow" as const },
};

const mockRepository = Layer.mock(SandboxRepository);
const makeRepository = (overrides: MockOverrides<typeof mockRepository> = {}) =>
	mockRepository({ ...overrides });
const makePluginRuntime = (
	findActiveScriptById: SandboxPluginScriptResolverValue["findActiveScriptById"] = () =>
		Effect.succeed(null),
	findActiveWorkflowScript: SandboxPluginScriptResolverValue["findActiveWorkflowScript"] = () =>
		Effect.succeed(null),
	findWorkflowScriptAvailableToUser: SandboxPluginScriptResolverValue["findWorkflowScriptAvailableToUser"] = () =>
		Effect.succeed(null),
) =>
	Layer.mock(SandboxPluginScriptResolver)({
		findActiveScriptById,
		findActiveWorkflowScript,
		findWorkflowScriptAvailableToUser,
	});
const makeServiceLayer = (
	repository: ReturnType<typeof makeRepository>,
	pluginRuntime = makePluginRuntime(),
	workflowEngine = Layer.succeed(
		WorkflowEngine,
		makeWorkflowEngine({ execute: () => Effect.succeed(null) }),
	),
	workflowReferences = Layer.mock(SandboxWorkflowReferenceRepository)({
		release: () => Effect.void,
		lockIngestionShared: () => Effect.void,
		registerInTransaction: () => Effect.succeed({ status: "registered" as const }),
	}),
) =>
	SandboxExecutionService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				repository,
				workflowEngine,
				workflowReferences,
				makeAppConfigLayer(),
				pluginRuntime,
			),
		),
	);

it.effect("executes an installed script as the explicit user", () => {
	let capturedWorkflow: unknown;
	let capturedOptions: Parameters<WorkflowEngine["Service"]["execute"]>[1] | undefined;
	const layer = makeServiceLayer(
		makeRepository({
			isPluginScript: () => Effect.succeed(false),
			getScript: () => Effect.succeed(storedScript),
		}),
		makePluginRuntime(),
		Layer.succeed(
			WorkflowEngine,
			makeWorkflowEngine({
				execute: (workflow, options) => {
					capturedWorkflow = workflow;
					capturedOptions = options;
					return Effect.succeed(null);
				},
			}),
		),
	);

	return Effect.gen(function* () {
		const service = yield* SandboxExecutionService;
		yield* service.enqueue(executingUserId, { scriptId, context: {} });

		expect(capturedWorkflow).toBe(SandboxScriptWorkflow);
		expect(capturedOptions?.payload).toMatchObject({
			scriptId,
			resultMode: "execution",
			subject: { type: "user", userId: executingUserId },
		});
	}).pipe(Effect.provide(layer));
});

it.effect("executes provider scripts through the universal workflow", () => {
	let capturedWorkflow: unknown;
	let capturedOptions: Parameters<WorkflowEngine["Service"]["execute"]>[1] | undefined;
	const layer = makeServiceLayer(
		makeRepository({
			isPluginScript: () => Effect.succeed(false),
			getScript: () => Effect.succeed({ ...storedScript, metadata: { kind: "provider" as const } }),
		}),
		makePluginRuntime(),
		Layer.succeed(
			WorkflowEngine,
			makeWorkflowEngine({
				execute: (workflow, options) => {
					capturedWorkflow = workflow;
					capturedOptions = options;
					return Effect.succeed(null);
				},
			}),
		),
	);

	return Effect.gen(function* () {
		const service = yield* SandboxExecutionService;
		yield* service.enqueue(executingUserId, { scriptId, context: {} });

		expect(capturedWorkflow).toBe(SandboxScriptWorkflow);
		expect(capturedOptions?.payload).toMatchObject({
			scriptId,
			input: {},
			resolutionMode: "exact",
			subject: { type: "user", userId: executingUserId },
		});
	}).pipe(Effect.provide(layer));
});

it.effect("returns a failure-bearing result when universal script execution fails", () => {
	let capturedOptions: Parameters<WorkflowEngine["Service"]["execute"]>[1] | undefined;
	const layer = makeServiceLayer(
		makeRepository(),
		makePluginRuntime(),
		Layer.succeed(
			WorkflowEngine,
			makeWorkflowEngine({
				execute: (_workflow, options) => {
					capturedOptions = options;
					return Effect.fail(new SandboxRunError({ message: "script failed" }));
				},
			}),
		),
	);

	return Effect.gen(function* () {
		const service = yield* SandboxExecutionService;
		const result = yield* service.executeScript({
			scriptId,
			input: {},
			executionId: "script-execution",
			subject: { type: "user", userId: executingUserId },
		});
		expect(result).toEqual({
			logs: [],
			value: null,
			status: "completed",
			error: { phase: "execute", message: "script failed" },
		});
		expect(capturedOptions?.payload).toMatchObject({ resultMode: "execution" });
	}).pipe(Effect.provide(layer));
});

it.effect("rejects inactive plugin scripts before starting the workflow", () => {
	let executionCount = 0;
	const layer = makeServiceLayer(
		makeRepository({
			isPluginScript: () => Effect.succeed(true),
			getScript: () => Effect.succeed(storedScript),
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
			isPluginScript: () => Effect.succeed(false),
			getScript: () => Effect.succeed(storedScript),
		}),
		makePluginRuntime(),
		Layer.succeed(
			WorkflowEngine,
			makeWorkflowEngine({ poll: () => Effect.succeedNone, execute: () => Effect.succeed(null) }),
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

it.effect("returns the completed public result without internal workflow fields", () => {
	const completed = {
		logs: ["completed"],
		value: { ok: true },
		status: "completed" as const,
		timing: { totalMs: 12, executionMs: 8 },
		harvest: { chunkHandles: ["internal-handle"] },
		error: { phase: "execute" as const, message: "reported failure" },
	};
	const layer = makeServiceLayer(
		makeRepository({
			isPluginScript: () => Effect.succeed(false),
			getScript: () => Effect.succeed(storedScript),
		}),
		makePluginRuntime(),
		Layer.succeed(
			WorkflowEngine,
			makeWorkflowEngine({
				execute: () => Effect.succeed(null),
				poll: () => Effect.succeedSome(new Workflow.Complete({ exit: Exit.succeed(completed) })),
			}),
		),
	);

	return Effect.gen(function* () {
		const service = yield* SandboxExecutionService;
		const { jobId } = yield* service.enqueue(executingUserId, { scriptId });

		expect(yield* service.getResult(executingUserId, jobId)).toEqual({
			logs: ["completed"],
			status: "completed",
			value: { ok: true },
			timing: { totalMs: 12, executionMs: 8 },
			error: { phase: "execute", message: "reported failure" },
		});
	}).pipe(Effect.provide(layer));
});

it.effect("resolves and executes a manifest workflow with an exact script pin", () => {
	const executionId = "example-resolution-1";
	const instance = WorkflowInstance.initial(SandboxScriptWorkflow, executionId);
	let capturedWorkflow: unknown;
	let capturedOptions: Parameters<WorkflowEngine["Service"]["execute"]>[1] | undefined;
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
		makePluginRuntime(undefined, undefined, () =>
			Effect.succeed({
				...storedScript,
				source: "source",
				pluginSlug: "example",
				createdAt: new Date(0),
				updatedAt: new Date(0),
				name: "Example resolution",
				contentHash: "workflow-hash",
				metadata: { kind: "workflow" as const },
				slug: "workflow.example-import-resolution",
			}),
		),
		Layer.succeed(WorkflowEngine, engine),
	);

	return Effect.gen(function* () {
		const service = yield* SandboxExecutionService;
		const resolvedScriptId = yield* service.resolveWorkflowScript({
			executionId,
			userId: executingUserId,
			pluginId: "example-plugin-id",
			workflowSlug: "example-import-resolution",
			pluginInstallationId: "example-installation-id",
		});
		const result = yield* service.executeWorkflow({
			executionId,
			scriptId: resolvedScriptId,
			subject: { type: "user", userId: executingUserId },
			input: { items: [], scriptId: "attempted-override" },
		});

		expect(result).toEqual({ results: [] });
		expect(capturedWorkflow).toBe(SandboxScriptWorkflow);
		expect(capturedOptions).toMatchObject({
			executionId,
			payload: {
				scriptId,
				resolutionMode: "exact",
				subject: { type: "user", userId: executingUserId },
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
				input: "a".repeat(80 * 1024),
				executionId: "oversized-workflow",
				subject: { type: "user", userId: executingUserId },
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

it.effect("pins a plugin workflow before accepted dispatch can wait for a worker", () => {
	const events: string[] = [];
	let referenceLive = false;
	const references = Layer.mock(SandboxWorkflowReferenceRepository)({
		release: () => Effect.sync(() => (referenceLive = false)),
		lockIngestionShared: () => Effect.sync(() => events.push("lock")),
		registerInTransaction: () =>
			Effect.sync(() => {
				events.push("register");
				referenceLive = true;
				return { status: "registered" as const };
			}),
	});
	const layer = makeServiceLayer(
		makeRepository({
			isPluginScript: () => Effect.succeed(true),
			getScriptPin: () =>
				Effect.succeed({
					scriptId,
					scriptSlug: "workflow",
					metadata: storedScript.metadata,
					providerId: storedScript.providerId,
					contentHash: storedScript.contentHash,
					pluginRevision: {
						id: "fixture",
						ownerId: null,
						slug: "fixture",
						compiledHashes: {},
						workflowScripts: {},
						scope: "system" as const,
						userBootstrapScriptSlugs: [],
						configSchema: { fields: {}, unknownKeys: "strict" as const },
						schemaScope: { eventSchemas: [], entitySchemaSlugs: [], relationshipSchemaSlugs: [] },
					},
				}),
		}),
		makePluginRuntime(
			() => Effect.succeed(storedWorkflowScript),
			undefined,
			() => Effect.succeed(storedWorkflowScript),
		),
		Layer.succeed(
			WorkflowEngine,
			makeWorkflowEngine({
				execute: () =>
					Effect.sync(() => {
						events.push("accepted");
						expect(referenceLive).toBe(true);
						return null;
					}),
			}),
		),
		references,
	);

	return Effect.gen(function* () {
		const service = yield* SandboxExecutionService;
		expect(
			yield* service.enqueuePluginWorkflow({
				input: {},
				executingUserId,
				pluginId: "fixture",
				workflowSlug: "workflow",
				executionId: "queued-workflow",
				pluginInstallationId: "fixture-installation",
			}),
		).toBe("queued-workflow");
		expect(events).toEqual(["lock", "register", "accepted"]);
		expect(referenceLive).toBe(true);
	}).pipe(Effect.provide(layer));
});

it.effect("releases a new dispatch pin when workflow enqueue fails", () => {
	let releases = 0;
	const layer = makeServiceLayer(
		makeRepository({
			isPluginScript: () => Effect.succeed(true),
			getScriptPin: () =>
				Effect.succeed({
					scriptId,
					scriptSlug: "workflow",
					metadata: storedScript.metadata,
					providerId: storedScript.providerId,
					contentHash: storedScript.contentHash,
					pluginRevision: {
						id: "fixture",
						ownerId: null,
						slug: "fixture",
						compiledHashes: {},
						workflowScripts: {},
						scope: "system" as const,
						userBootstrapScriptSlugs: [],
						configSchema: { fields: {}, unknownKeys: "strict" as const },
						schemaScope: { eventSchemas: [], entitySchemaSlugs: [], relationshipSchemaSlugs: [] },
					},
				}),
		}),
		makePluginRuntime(
			() => Effect.succeed(storedWorkflowScript),
			undefined,
			() => Effect.succeed(storedWorkflowScript),
		),
		Layer.succeed(
			WorkflowEngine,
			makeWorkflowEngine({ execute: () => Effect.fail("enqueue failed") }),
		),
		Layer.mock(SandboxWorkflowReferenceRepository)({
			lockIngestionShared: () => Effect.void,
			release: () => Effect.sync(() => (releases += 1)),
			registerInTransaction: () => Effect.succeed({ status: "registered" as const }),
		}),
	);

	return Effect.gen(function* () {
		const service = yield* SandboxExecutionService;
		yield* Effect.exit(
			service.enqueuePluginWorkflow({
				input: {},
				executingUserId,
				pluginId: "fixture",
				workflowSlug: "workflow",
				executionId: "failed-enqueue",
				pluginInstallationId: "fixture-installation",
			}),
		);
		expect(releases).toBe(1);
	}).pipe(Effect.provide(layer));
});
