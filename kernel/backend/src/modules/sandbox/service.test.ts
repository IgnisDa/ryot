import { expect, layer } from "@effect/vitest";
import { NotFound, SandboxRunError } from "@ryot-app/contract/errors";
import {
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { jsonByteLength } from "@ryot-app/sandbox-compiler/limits";
import { Context, Effect, Exit, Layer, Ref, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { assertExitFails } from "#lib/test-utils/assertions";
import {
	makeAppConfigLayer,
	makeWorkflowActivityEngine,
	makeWorkflowEngine,
} from "#lib/test-utils/effect";
import { mutationAdmissionTestLayer } from "#lib/test-utils/mutation-admission";

import {
	SandboxPluginScriptResolver,
	type SandboxPluginScriptResolverValue,
} from "./plugin-script-resolver";
import { SandboxRepository } from "./repository";
import { SandboxScriptWorkflow, SandboxWorkflowPinning } from "./sandbox-script-workflow";
import { SandboxScriptWorkflowPayload } from "./sandbox-script-workflow-payload";
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

type WorkflowExecution = {
	readonly workflow: unknown;
	readonly referenceLive: boolean;
	readonly options: Parameters<WorkflowEngine["Service"]["execute"]>[1];
};

class SandboxServiceCalls extends Context.Service<
	SandboxServiceCalls,
	{
		readonly events: Effect.Effect<ReadonlyArray<string>>;
		readonly referenceLive: Effect.Effect<boolean>;
		readonly executions: Effect.Effect<ReadonlyArray<WorkflowExecution>>;
	}
>()("test/SandboxServiceCalls") {}

type ExecuteWorkflow = (
	...args: Parameters<WorkflowEngine["Service"]["execute"]>
) => Effect.Effect<unknown, SandboxRunError | string>;

const engineLayer =
	(poll?: WorkflowEngine["Service"]["poll"]) =>
	(execute: ExecuteWorkflow): Layer.Layer<WorkflowEngine> =>
		Layer.succeed(WorkflowEngine, makeWorkflowEngine({ execute, ...(poll && { poll }) }));

const activityEngineLayer =
	(executionId: string) =>
	(execute: ExecuteWorkflow): Layer.Layer<WorkflowEngine | WorkflowInstance> => {
		const instance = WorkflowInstance.initial(SandboxScriptWorkflow, executionId);
		return Layer.merge(
			Layer.succeed(WorkflowEngine, makeWorkflowActivityEngine(instance, { execute })),
			Layer.succeed(WorkflowInstance, instance),
		);
	};

const makeServiceLayer = <Repository, Workflow = WorkflowEngine>(options: {
	readonly repository: Layer.Layer<Repository>;
	readonly workflow?: (execute: ExecuteWorkflow) => Layer.Layer<Workflow>;
	readonly findActiveScriptById?: SandboxPluginScriptResolverValue["findActiveScriptById"];
	readonly findWorkflowScriptAvailableToUser?: SandboxPluginScriptResolverValue["findWorkflowScriptAvailableToUser"];
	readonly execute?: ExecuteWorkflow;
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const events = yield* Ref.make<ReadonlyArray<string>>([]);
			const referenceLive = yield* Ref.make(false);
			const executions = yield* Ref.make<ReadonlyArray<WorkflowExecution>>([]);
			const record = (event: string) => Ref.update(events, (all) => [...all, event]);
			const respond = options.execute ?? (() => Effect.succeed(null));
			const execute: ExecuteWorkflow = (...args) =>
				Effect.gen(function* () {
					const [workflow, execution] = args;
					const live = yield* Ref.get(referenceLive);
					yield* Ref.update(executions, (all) => [
						...all,
						{ workflow, options: execution, referenceLive: live },
					]);
					yield* record("accepted");
					return yield* respond(...args);
				});
			return SandboxExecutionService.layer.pipe(
				Layer.provideMerge(SandboxWorkflowPinning.layer),
				Layer.provideMerge(
					Layer.mergeAll(
						mutationAdmissionTestLayer,
						options.repository,
						(options.workflow ?? engineLayer())(execute),
						Layer.mock(SandboxWorkflowReferenceRepository)({
							lockIngestionShared: () => record("lock"),
							release: () => record("release").pipe(Effect.andThen(Ref.set(referenceLive, false))),
							registerInTransaction: () =>
								record("register").pipe(
									Effect.andThen(Ref.set(referenceLive, true)),
									Effect.as({ status: "registered" as const }),
								),
						}),
						makeAppConfigLayer(),
						Layer.mock(SandboxPluginScriptResolver)({
							findActiveScriptById: options.findActiveScriptById ?? (() => Effect.succeed(null)),
							findWorkflowScriptAvailableToUser:
								options.findWorkflowScriptAvailableToUser ?? (() => Effect.succeed(null)),
						}),
						Layer.succeed(SandboxServiceCalls, {
							events: Ref.get(events),
							executions: Ref.get(executions),
							referenceLive: Ref.get(referenceLive),
						}),
					),
				),
			);
		}),
	);

const installedScriptRepository = mockRepository({
	isPluginScript: () => Effect.succeed(false),
	getScript: () => Effect.succeed(storedScript),
});

layer(makeServiceLayer({ repository: installedScriptRepository }))((test) => {
	test.effect("executes an installed script as the explicit user", () =>
		Effect.gen(function* () {
			const service = yield* SandboxExecutionService;
			yield* service.enqueue(executingUserId, { scriptId, context: {} });
			const execution = (yield* (yield* SandboxServiceCalls).executions).at(-1);

			expect(execution?.workflow).toBe(SandboxScriptWorkflow);
			expect(execution?.options.payload).toMatchObject({
				scriptId,
				resultMode: "execution",
				subject: {
					type: "user",
					userId: executingUserId,
					accountGeneration: { userId: executingUserId, token: "test-account-generation" },
				},
			});
		}),
	);
});

layer(
	makeServiceLayer({
		repository: mockRepository({
			isPluginScript: () => Effect.succeed(false),
			getScript: () => Effect.succeed({ ...storedScript, metadata: { kind: "provider" as const } }),
		}),
	}),
)((test) => {
	test.effect("executes provider scripts through the universal workflow", () =>
		Effect.gen(function* () {
			const service = yield* SandboxExecutionService;
			yield* service.enqueue(executingUserId, { scriptId, context: {} });
			const execution = (yield* (yield* SandboxServiceCalls).executions).at(-1);

			expect(execution?.workflow).toBe(SandboxScriptWorkflow);
			expect(execution?.options.payload).toMatchObject({
				scriptId,
				input: {},
				resolutionMode: "exact",
				subject: {
					type: "user",
					userId: executingUserId,
					accountGeneration: { userId: executingUserId, token: "test-account-generation" },
				},
			});
		}),
	);
});

layer(
	makeServiceLayer({
		repository: mockRepository({}),
		execute: () =>
			Effect.fail(new SandboxRunError({ kind: "script-failure", message: "script failed" })),
	}),
)((test) => {
	test.effect("returns a failure-bearing result when universal script execution fails", () =>
		Effect.gen(function* () {
			const service = yield* SandboxExecutionService;
			const result = yield* service.executeScript({
				scriptId,
				input: {},
				executionId: "script-execution",
				subject: {
					type: "user",
					userId: executingUserId,
					accountGeneration: { userId: executingUserId, token: "test-account-generation" },
				},
			});
			expect(result).toEqual({
				logs: [],
				value: null,
				status: "completed",
				error: { phase: "execute", kind: "script-failure", message: "script failed" },
			});
			expect(
				(yield* (yield* SandboxServiceCalls).executions).at(-1)?.options.payload,
			).toMatchObject({ resultMode: "execution" });
		}),
	);
});

layer(
	makeServiceLayer({
		repository: mockRepository({
			isPluginScript: () => Effect.succeed(true),
			getScript: () => Effect.succeed(storedScript),
		}),
	}),
)((test) => {
	test.effect("rejects inactive plugin scripts before starting the workflow", () =>
		Effect.gen(function* () {
			const service = yield* SandboxExecutionService;
			const exit = yield* Effect.exit(service.enqueue(executingUserId, { scriptId, context: {} }));

			assertExitFails(exit, new NotFound({ message: "Sandbox script not found" }));
			expect(yield* (yield* SandboxServiceCalls).executions).toHaveLength(0);
		}),
	);
});

layer(
	makeServiceLayer({
		repository: installedScriptRepository,
		workflow: engineLayer(() => Effect.succeedNone),
	}),
)((test) => {
	test.effect("polls a job only for its explicit executing user", () => {
		const otherUserId = UserId.make("user-2");
		return Effect.gen(function* () {
			const service = yield* SandboxExecutionService;
			const { jobId } = yield* service.enqueue(executingUserId, { scriptId });

			expect(yield* service.getResult(executingUserId, jobId)).toEqual({ status: "pending" });
			assertExitFails(
				yield* Effect.exit(service.getResult(otherUserId, jobId)),
				new NotFound({ message: "Sandbox job not found" }),
			);
		});
	});
});

const completedResult = {
	logs: ["completed"],
	value: { ok: true },
	status: "completed" as const,
	timing: { totalMs: 12, executionMs: 8 },
	harvest: { chunkHandles: ["internal-handle"] },
	error: {
		phase: "execute" as const,
		message: "reported failure",
		kind: "script-failure" as const,
	},
};

layer(
	makeServiceLayer({
		repository: installedScriptRepository,
		workflow: engineLayer(() =>
			Effect.succeedSome(new Workflow.Complete({ exit: Exit.succeed(completedResult) })),
		),
	}),
)((test) => {
	test.effect("returns the completed public result without internal workflow fields", () =>
		Effect.gen(function* () {
			const service = yield* SandboxExecutionService;
			const { jobId } = yield* service.enqueue(executingUserId, { scriptId });

			expect(yield* service.getResult(executingUserId, jobId)).toEqual({
				logs: ["completed"],
				status: "completed",
				value: { ok: true },
				timing: { totalMs: 12, executionMs: 8 },
				error: { phase: "execute", kind: "script-failure", message: "reported failure" },
			});
		}),
	);
});

const resolutionExecutionId = "example-resolution-1";

layer(
	makeServiceLayer({
		repository: mockRepository({}),
		execute: () => Effect.succeed({ results: [] }),
		workflow: activityEngineLayer(resolutionExecutionId),
		findWorkflowScriptAvailableToUser: () =>
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
	}),
)((test) => {
	test.effect("resolves and executes a manifest workflow with an exact script pin", () =>
		Effect.gen(function* () {
			const executionId = resolutionExecutionId;
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
				input: { items: [], scriptId: "attempted-override" },
				subject: {
					type: "user",
					userId: executingUserId,
					accountGeneration: { userId: executingUserId, token: "test-account-generation" },
				},
			});
			const execution = (yield* (yield* SandboxServiceCalls).executions).at(-1);

			expect(result).toEqual({ results: [] });
			expect(execution?.workflow).toBe(SandboxScriptWorkflow);
			expect(execution?.options).toMatchObject({
				executionId,
				payload: {
					scriptId,
					resolutionMode: "exact",
					input: { items: [], scriptId: "attempted-override" },
					subject: {
						type: "user",
						userId: executingUserId,
						accountGeneration: { userId: executingUserId, token: "test-account-generation" },
					},
				},
			});
		}),
	);
});

layer(makeServiceLayer({ repository: mockRepository({}) }))((test) => {
	test.effect("rejects workflow input above the workflow limit before dispatch", () =>
		Effect.gen(function* () {
			const service = yield* SandboxExecutionService;
			const oversizedInput = "a".repeat(80 * 1024);
			const oversizedInputBytes = jsonByteLength(oversizedInput);
			if (oversizedInputBytes === null) {
				throw new Error("Expected oversized input to be JSON");
			}
			const exit = yield* Effect.exit(
				service.executeWorkflow({
					scriptId,
					input: oversizedInput,
					executionId: "oversized-workflow",
					subject: {
						type: "user",
						userId: executingUserId,
						accountGeneration: { userId: executingUserId, token: "test-account-generation" },
					},
				}),
			);

			assertExitFails(
				exit,
				new SandboxRunError({
					kind: "invalid-input",
					message: `Sandbox definition context is ${oversizedInputBytes} UTF-8 bytes and exceeds 65536 UTF-8 bytes`,
				}),
			);
			expect(yield* (yield* SandboxServiceCalls).executions).toHaveLength(0);
		}),
	);
});

const originalRevision = {
	ownerId: null,
	slug: "fixture",
	compiledHashes: {},
	workflowScripts: {},
	scope: "system" as const,
	id: PluginId.make("fixture"),
	userBootstrapScriptSlugs: [],
	revisionId: PluginRevisionId.make("fixture-revision-1"),
	configSchema: { fields: {}, unknownKeys: "strict" as const },
	configRevisionId: PluginConfigRevisionId.make("fixture-config-1"),
	schemaScope: { eventSchemas: [], entitySchemaSlugs: [], relationshipSchemaSlugs: [] },
};
const replacementRevision = {
	...originalRevision,
	revisionId: PluginRevisionId.make("fixture-revision-2"),
	configRevisionId: PluginConfigRevisionId.make("fixture-config-2"),
};

type ExpectedRevision = Parameters<SandboxRepository["Service"]["getScriptPin"]>[1];

class RevisionPins extends Context.Service<
	RevisionPins,
	{
		readonly expectedRevisions: Effect.Effect<ReadonlyArray<ExpectedRevision>>;
		readonly activate: (revision: typeof originalRevision) => Effect.Effect<void>;
	}
>()("test/RevisionPins") {}

const revisionPinRepository = Layer.unwrap(
	Effect.gen(function* () {
		const active = yield* Ref.make(originalRevision);
		const expectedRevisions = yield* Ref.make<ReadonlyArray<ExpectedRevision>>([]);
		return Layer.merge(
			mockRepository({
				getScriptPin: (_scriptId, expectedRevision) =>
					Ref.update(expectedRevisions, (all) => [...all, expectedRevision]).pipe(
						Effect.andThen(Ref.get(active)),
						Effect.map((activeRevision) => ({
							scriptId,
							providerId: null,
							scriptSlug: "workflow",
							contentHash: storedScript.contentHash,
							metadata: { kind: "workflow" as const },
							pluginRevision: expectedRevision ? originalRevision : activeRevision,
						})),
					),
			}),
			Layer.succeed(RevisionPins, {
				expectedRevisions: Ref.get(expectedRevisions),
				activate: (revision) => Ref.set(active, revision),
			}),
		);
	}),
);

layer(makeServiceLayer({ repository: revisionPinRepository }))((test) => {
	test.effect(
		"starts a pre-registered workflow with its admitted package and config revisions",
		() =>
			Effect.gen(function* () {
				const service = yield* SandboxExecutionService;
				const pins = yield* RevisionPins;
				const preRegistered = yield* service.preRegisterPluginWorkflow({
					scriptId,
					executingUserId,
					pluginId: "fixture",
					executionId: "pre-registered-workflow",
					accountGeneration: { userId: executingUserId, token: "test-account-generation" },
				});
				yield* pins.activate(replacementRevision);

				yield* service.executeWorkflow({
					scriptId,
					input: {},
					executionId: "pre-registered-workflow",
					pluginRevision: preRegistered.pluginRevision,
					subject: {
						type: "user",
						userId: executingUserId,
						accountGeneration: { userId: executingUserId, token: "test-account-generation" },
					},
				});
				const startedPayload = yield* Schema.decodeUnknownEffect(SandboxScriptWorkflowPayload)(
					(yield* (yield* SandboxServiceCalls).executions).at(-1)?.options.payload,
				);
				const startedPin = yield* (yield* SandboxWorkflowPinning).establish(
					startedPayload,
					"pre-registered-workflow",
				);
				const expectedRevisions = yield* pins.expectedRevisions;

				expect(startedPayload.pluginRevision).toEqual(originalRevision);
				expect(startedPin.principal.pluginRevision).toEqual(originalRevision);
				expect(expectedRevisions).toHaveLength(2);
				expect(expectedRevisions[0]).toBeUndefined();
				expect(expectedRevisions[1]).toMatchObject({
					id: "fixture",
					revisionId: "fixture-revision-1",
					configRevisionId: "fixture-config-1",
				});
			}),
	);
});

const pluginWorkflowPin = {
	scriptId,
	scriptSlug: "workflow",
	metadata: storedScript.metadata,
	providerId: storedScript.providerId,
	contentHash: storedScript.contentHash,
	pluginRevision: {
		ownerId: null,
		slug: "fixture",
		compiledHashes: {},
		workflowScripts: {},
		scope: "system" as const,
		id: PluginId.make("fixture"),
		userBootstrapScriptSlugs: [],
		revisionId: PluginRevisionId.make("fixture-revision"),
		configSchema: { fields: {}, unknownKeys: "strict" as const },
		configRevisionId: PluginConfigRevisionId.make("fixture-config"),
		schemaScope: { eventSchemas: [], entitySchemaSlugs: [], relationshipSchemaSlugs: [] },
	},
};
const pluginWorkflowOptions = {
	findActiveScriptById: () => Effect.succeed(storedWorkflowScript),
	findWorkflowScriptAvailableToUser: () => Effect.succeed(storedWorkflowScript),
	repository: mockRepository({
		isPluginScript: () => Effect.succeed(true),
		getScriptPin: () => Effect.succeed(pluginWorkflowPin),
	}),
};

layer(makeServiceLayer(pluginWorkflowOptions))((test) => {
	test.effect("pins a plugin workflow before accepted dispatch can wait for a worker", () =>
		Effect.gen(function* () {
			const service = yield* SandboxExecutionService;
			const calls = yield* SandboxServiceCalls;
			expect(
				yield* service.enqueuePluginWorkflow({
					input: {},
					executingUserId,
					pluginId: "fixture",
					workflowSlug: "workflow",
					executionId: "queued-workflow",
					pluginInstallationId: "fixture-installation",
					accountGeneration: { userId: executingUserId, token: "test-account-generation" },
				}),
			).toBe("queued-workflow");
			expect((yield* calls.executions).map(({ referenceLive }) => referenceLive)).toEqual([true]);
			expect(yield* calls.events).toEqual(["lock", "register", "accepted"]);
			expect(yield* calls.referenceLive).toBe(true);
		}),
	);
});

layer(makeServiceLayer({ ...pluginWorkflowOptions, execute: () => Effect.fail("enqueue failed") }))(
	(test) => {
		test.effect("releases a new dispatch pin when workflow enqueue fails", () =>
			Effect.gen(function* () {
				const service = yield* SandboxExecutionService;
				yield* Effect.exit(
					service.enqueuePluginWorkflow({
						input: {},
						executingUserId,
						pluginId: "fixture",
						workflowSlug: "workflow",
						executionId: "failed-enqueue",
						pluginInstallationId: "fixture-installation",
						accountGeneration: { userId: executingUserId, token: "test-account-generation" },
					}),
				);
				const events = yield* (yield* SandboxServiceCalls).events;
				expect(events.filter((event) => event === "release")).toHaveLength(1);
			}),
		);
	},
);
