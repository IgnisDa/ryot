import { BunServices } from "@effect/platform-bun";
import { expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import {
	AutomationExecutionId,
	ImportRunId,
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Context, Effect, Exit, Layer, Option, Ref, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";
import { assert } from "vitest";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import {
	ImportSourceStateFromJson,
	RedisService,
	type ImportSourceState,
} from "#lib/infrastructure/redis";
import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import { makeAppConfigLayer, makeRedisService, makeWorkflowEngine } from "#lib/test-utils/effect";
import { mutationAdmissionTestLayer } from "#lib/test-utils/mutation-admission";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { ImportRunFailuresService } from "./failure-service";
import { ProcessImportRunWorkflow } from "./import-run-workflow";
import { runProcessImportRunWorkflow } from "./import-run-workflow-live";
import type { ImportRunJobData } from "./jobs";
import { ImportSourceStateStore } from "./runtime/source-state-store";
import { ImportRunArtifacts } from "./runtime/workflow-helpers";
import { ImportsService } from "./service";

const executionId = "import-run-dispatch";
const command = rootLifecycleCommand({
	source: "import",
	importRunId: ImportRunId.make("run-1"),
	itemIdentity: '["import-run","run-1"]',
	executionId: AutomationExecutionId.make("run-1"),
	initiator: { kind: "user", id: UserId.make("user-1") },
	occurredAt: IsoUtcString.make("2026-01-01T00:00:00.000Z"),
	accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
});
const payload = {
	command,
	uploadIntentIds: [],
	userId: UserId.make("user-1"),
	sourceStateId: "source-state-1",
	runId: ImportRunId.make("run-1"),
} satisfies ImportRunJobData;

const sourceState = {
	source: "nu",
	sourcePayload: {},
	pluginId: "example-plugin-id",
	uploadIntentIds: ["intent-nu"],
	pluginInstallationId: "example-installation",
	namedArtifactPaths: { uploadToken: "/tmp/nu.zip" },
	workflowScriptId: SandboxScriptId.make("accepted.nu-import"),
	pluginRevision: {
		ownerId: null,
		slug: "example",
		compiledHashes: {},
		workflowScripts: {},
		scope: "system" as const,
		userBootstrapScriptSlugs: [],
		id: PluginId.make("example-plugin-id"),
		revisionId: PluginRevisionId.make("example-revision"),
		configSchema: { fields: {}, unknownKeys: "strict" as const },
		configRevisionId: PluginConfigRevisionId.make("example-config-revision"),
		schemaScope: { eventSchemas: [], entitySchemaSlugs: [], relationshipSchemaSlugs: [] },
	},
};

type SandboxCall = { method: string; input: unknown };

class FakeImportDispatch extends Context.Service<
	FakeImportDispatch,
	{
		readonly activityNames: Effect.Effect<ReadonlyArray<string>>;
		readonly sandboxCalls: Effect.Effect<ReadonlyArray<SandboxCall>>;
		readonly sandboxParents: Effect.Effect<ReadonlyArray<boolean>>;
	}
>()("test/FakeImportDispatch") {}

const makeHarness = (
	suspendWorkflow = false,
	failWorkflow = false,
	suspended = suspendWorkflow,
	storedSourceState: ImportSourceState | string = sourceState,
) => {
	const workflowResult = suspendWorkflow
		? Effect.interrupt
		: Effect.fail(new SandboxRunError({ kind: "script-failure", message: "import failed" })).pipe(
				Effect.when(Effect.succeed(failWorkflow)),
				Effect.as(null),
			);

	return Layer.mergeAll(
		makeAppConfigLayer(),
		Layer.unwrap(
			Effect.gen(function* () {
				const activityNames = yield* Ref.make<ReadonlyArray<string>>([]);
				const sandboxCalls = yield* Ref.make<ReadonlyArray<SandboxCall>>([]);
				const sandboxParents = yield* Ref.make<ReadonlyArray<boolean>>([]);
				const instance = WorkflowInstance.initial(ProcessImportRunWorkflow, executionId);
				instance.suspended = suspended;
				const engine = makeWorkflowEngine({
					activityExecute: (activity) =>
						Effect.gen(function* () {
							yield* Ref.update(activityNames, (all) => [...all, activity.name]);
							if (
								activity.name === "claim-import-source-state" ||
								activity.name === "materialize-import-artifacts"
							) {
								return new Workflow.Complete({ exit: yield* Effect.exit(activity.execute) });
							}
							return new Workflow.Complete({ exit: Exit.void });
						}),
				});
				return Layer.mergeAll(
					Layer.succeed(FakeImportDispatch, {
						sandboxCalls: Ref.get(sandboxCalls),
						activityNames: Ref.get(activityNames),
						sandboxParents: Ref.get(sandboxParents),
					}),
					Layer.succeed(WorkflowEngine, engine),
					Layer.succeed(WorkflowInstance, instance),
					Layer.mock(SandboxExecutionService)({
						executeWorkflow: (input) =>
							Effect.serviceOption(WorkflowInstance).pipe(
								Effect.tap((parent) =>
									Ref.update(sandboxParents, (all) => [...all, Option.isSome(parent)]).pipe(
										Effect.andThen(
											Ref.update(sandboxCalls, (all) => [
												...all,
												{ input, method: "executeWorkflow" },
											]),
										),
									),
								),
								Effect.andThen(workflowResult),
							),
					}),
				);
			}),
		),
		Layer.mock(ImportRunArtifacts)({}),
		Layer.mock(SandboxArtifactStore)({
			materializeInputs: (ownerExecutionId, _referenceExecutionId, grants) =>
				Effect.succeed({
					artifactOwnerExecutionId: ownerExecutionId,
					...(grants.namedArtifactPaths ? { namedArtifactPaths: grants.namedArtifactPaths } : {}),
				}),
		}),
		mutationAdmissionTestLayer,
		BunServices.layer,
		ImportSourceStateStore.layer.pipe(
			Layer.provide(
				Layer.succeed(
					RedisService,
					makeRedisService({
						claim: () =>
							Effect.succeed(
								typeof storedSourceState === "string"
									? storedSourceState
									: Schema.encodeSync(ImportSourceStateFromJson)(storedSourceState),
							),
					}),
				),
			),
		),
		Layer.mock(ImportsService)({}),
		Layer.mock(ImportRunFailuresService)({}),
	);
};

layer(makeHarness())((test) => {
	test.effect("dispatches a registry-declared source to its owning plugin's import workflow", () =>
		Effect.gen(function* () {
			const dispatch = yield* FakeImportDispatch;
			yield* runProcessImportRunWorkflow(payload, executionId);

			const [executed] = yield* dispatch.sandboxCalls;
			assert(executed !== undefined);
			expect(executed).toEqual({
				method: "executeWorkflow",
				input: {
					executionId: `${executionId}-import`,
					pluginRevision: sourceState.pluginRevision,
					input: { command, source: "nu", runId: "run-1" },
					scriptId: SandboxScriptId.make("accepted.nu-import"),
					grants: {
						artifactOwnerExecutionId: `${executionId}-import`,
						namedArtifactPaths: { uploadToken: "/tmp/nu.zip" },
					},
					subject: {
						type: "user",
						userId: "user-1",
						accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
					},
				},
			});
			expect(yield* dispatch.activityNames).toEqual([
				"mark-import-run-started",
				"claim-import-source-state",
				"materialize-import-artifacts",
				"retain-import-dispatch-artifacts",
				"settle-import-run-after-plugin",
				"release-import-dispatch-artifacts",
				"release-import-artifacts",
				"cleanup-import-artifacts-on-success",
				"cleanup-import-uploads-on-success",
			]);
			expect(yield* dispatch.sandboxParents).toEqual([true]);
		}),
	);
});

layer(
	makeHarness(false, false, false, {
		...sourceState,
		source: "movary",
		namedArtifactPaths: {
			ignoredFilePath: "/tmp/ignored.csv",
			historyFilePath: "/tmp/history.csv",
		},
	}),
)((test) => {
	test.effect("grants every stored named artifact to a plugin import workflow", () =>
		Effect.gen(function* () {
			const dispatch = yield* FakeImportDispatch;
			yield* runProcessImportRunWorkflow(payload, executionId);

			const executed = (yield* dispatch.sandboxCalls).find(
				({ method }) => method === "executeWorkflow",
			);
			assert(executed !== undefined);
			expect(executed).toMatchObject({
				input: {
					grants: {
						artifactOwnerExecutionId: `${executionId}-import`,
						namedArtifactPaths: {
							ignoredFilePath: "/tmp/ignored.csv",
							historyFilePath: "/tmp/history.csv",
						},
					},
				},
			});
		}),
	);
});

layer(
	makeHarness(false, false, false, {
		...sourceState,
		source: "eta",
		sourcePayload: { apiKey: "secret", collection: "Favorites" },
	}),
)((test) => {
	test.effect("hands a secret-bearing stored source payload to the plugin import workflow", () =>
		Effect.gen(function* () {
			const dispatch = yield* FakeImportDispatch;
			yield* runProcessImportRunWorkflow(payload, executionId);

			const executed = (yield* dispatch.sandboxCalls).find(
				({ method }) => method === "executeWorkflow",
			);
			expect(executed).toMatchObject({
				input: {
					input: {
						source: "eta",
						runId: "run-1",
						sourcePayload: { apiKey: "secret", collection: "Favorites" },
					},
				},
			});
		}),
	);
});

const { pluginRevision: _pluginRevision, ...legacySourceState } = sourceState;
layer(makeHarness(false, false, false, JSON.stringify(legacySourceState)))((test) => {
	test.effect(
		"fails closed before sandbox dispatch when durable source state has no exact pin",
		() =>
			Effect.gen(function* () {
				const dispatch = yield* FakeImportDispatch;
				yield* runProcessImportRunWorkflow(payload, executionId);

				expect(yield* dispatch.sandboxCalls).toEqual([]);
				expect(yield* dispatch.activityNames).not.toContain("retain-import-dispatch-artifacts");
				expect(yield* dispatch.activityNames).toContain("fail-import-run-unexpected");
			}),
	);
});

layer(makeHarness(true))((test) => {
	test.effect("preserves workflow suspension while awaiting the plugin import child", () =>
		Effect.gen(function* () {
			const dispatch = yield* FakeImportDispatch;
			const exit = yield* Effect.exit(runProcessImportRunWorkflow(payload, executionId));

			expect(Exit.hasInterrupts(exit)).toBe(true);
			expect(yield* dispatch.activityNames).not.toContain("fail-import-run-unexpected");
		}),
	);
});

layer(makeHarness(false, true))((test) => {
	test.effect("releases the pre-registered pin when import orchestration fails terminally", () =>
		Effect.gen(function* () {
			const dispatch = yield* FakeImportDispatch;
			yield* runProcessImportRunWorkflow(payload, executionId);

			expect(yield* dispatch.activityNames).toContain("release-import-workflow-pin");
			expect(yield* dispatch.activityNames).toContain(
				"cleanup-import-uploads-on-unexpected-failure",
			);
		}),
	);
});

layer(makeHarness(true, false, false))((test) => {
	test.effect("releases input artifacts on terminal import cancellation", () =>
		Effect.gen(function* () {
			const dispatch = yield* FakeImportDispatch;
			yield* runProcessImportRunWorkflow(payload, executionId);

			expect(yield* dispatch.activityNames).toContain("release-import-artifacts");
			expect(yield* dispatch.activityNames).toContain("release-import-dispatch-artifacts");
			expect(yield* dispatch.activityNames).toContain(
				"cleanup-import-uploads-on-unexpected-failure",
			);
		}),
	);
});
