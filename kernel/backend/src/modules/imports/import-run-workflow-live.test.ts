import { BunServices } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { SandboxRunError } from "@ryot/contract/errors";
import { ImportRunId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer, Option, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";
import { assert } from "vitest";

import {
	ImportSourceStateFromJson,
	RedisService,
	type ImportSourceState,
} from "#lib/infrastructure/redis";
import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import {
	databaseLayer,
	makeAppConfigLayer,
	makeRedisService,
	makeWorkflowEngine,
} from "#lib/test-utils/effect";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { ImportRunFailuresService } from "./failure-service";
import { ProcessImportRunWorkflow } from "./import-run-workflow";
import { runProcessImportRunWorkflow } from "./import-run-workflow-live";
import type { ImportRunJobData } from "./jobs";
import { ImportRunArtifacts } from "./runtime/workflow-helpers";
import { ImportsService } from "./service";

const executionId = "import-run-dispatch";
const payload = {
	userId: UserId.make("user-1"),
	runId: ImportRunId.make("run-1"),
	sourceStateId: "source-state-1",
} satisfies ImportRunJobData;

const sourceState = {
	source: "netflix",
	sourcePayload: {},
	pluginId: "media-plugin-id",
	uploadIntentIds: ["intent-netflix"],
	pluginInstallationId: "media-installation",
	namedArtifactPaths: { uploadToken: "/tmp/netflix.zip" },
	workflowScriptId: SandboxScriptId.make("accepted.netflix-import"),
};

type SandboxCall = { method: string; input: unknown };

const makeHarness = (
	suspendWorkflow = false,
	failWorkflow = false,
	suspended = suspendWorkflow,
	storedSourceState: ImportSourceState = sourceState,
) => {
	const activityNames: string[] = [];
	const sandboxCalls: SandboxCall[] = [];
	const sandboxParents: boolean[] = [];
	const instance = WorkflowInstance.initial(ProcessImportRunWorkflow, executionId);
	instance.suspended = suspended;
	const engine = makeWorkflowEngine({
		activityExecute: (activity) =>
			Effect.gen(function* () {
				activityNames.push(activity.name);
				if (
					activity.name === "claim-import-source-state" ||
					activity.name === "materialize-import-artifacts"
				) {
					return new Workflow.Complete({ exit: yield* Effect.exit(activity.execute) });
				}
				return new Workflow.Complete({ exit: Exit.void });
			}),
	});
	const workflowResult = suspendWorkflow
		? Effect.interrupt
		: Effect.fail(new SandboxRunError({ message: "import failed" })).pipe(
				Effect.when(Effect.succeed(failWorkflow)),
				Effect.as(null),
			);

	return {
		activityNames,
		sandboxCalls,
		sandboxParents,
		layer: Layer.mergeAll(
			makeAppConfigLayer(),
			Layer.succeed(WorkflowEngine, engine),
			Layer.succeed(WorkflowInstance, instance),
			Layer.mock(ImportRunArtifacts)({}),
			Layer.mock(SandboxArtifactStore)({
				materializeInputs: (ownerExecutionId, _referenceExecutionId, grants) =>
					Effect.succeed({
						artifactOwnerExecutionId: ownerExecutionId,
						...(grants.namedArtifactPaths ? { namedArtifactPaths: grants.namedArtifactPaths } : {}),
					}),
			}),
			Layer.mock(SandboxExecutionService)({
				executeWorkflow: (input) =>
					Effect.serviceOption(WorkflowInstance).pipe(
						Effect.tap((parent) =>
							Effect.sync(() => {
								sandboxParents.push(Option.isSome(parent));
								sandboxCalls.push({ input, method: "executeWorkflow" });
							}),
						),
						Effect.andThen(workflowResult),
					),
			}),
			databaseLayer,
			BunServices.layer,
			Layer.succeed(
				RedisService,
				makeRedisService({
					claim: () =>
						Effect.succeed(Schema.encodeSync(ImportSourceStateFromJson)(storedSourceState)),
				}),
			),
			Layer.mock(ImportsService)({}),
			Layer.mock(ImportRunFailuresService)({}),
		),
	};
};

it.effect("dispatches a registry-declared source to its owning plugin's import workflow", () => {
	const harness = makeHarness();

	return Effect.gen(function* () {
		yield* runProcessImportRunWorkflow(payload, executionId);

		const [executed] = harness.sandboxCalls;
		assert(executed !== undefined);
		expect(executed).toEqual({
			method: "executeWorkflow",
			input: {
				executionId: `${executionId}-import`,
				input: { runId: "run-1", source: "netflix" },
				authority: { type: "user", userId: "user-1" },
				scriptId: SandboxScriptId.make("accepted.netflix-import"),
				grants: {
					artifactOwnerExecutionId: `${executionId}-import`,
					namedArtifactPaths: { uploadToken: "/tmp/netflix.zip" },
				},
			},
		});
		expect(harness.activityNames).toEqual([
			"mark-import-run-started",
			"claim-import-source-state",
			"materialize-import-artifacts",
			"retain-import-dispatch-artifacts",
			"release-import-dispatch-artifacts",
			"release-import-artifacts",
			"cleanup-import-artifacts-on-success",
			"cleanup-import-uploads-on-success",
		]);
		expect(harness.sandboxParents).toEqual([false]);
	}).pipe(Effect.provide(harness.layer));
});

it.effect("grants every stored named artifact to a plugin import workflow", () => {
	const harness = makeHarness(false, false, false, {
		...sourceState,
		source: "movary",
		namedArtifactPaths: {
			ignoredFilePath: "/tmp/ignored.csv",
			historyFilePath: "/tmp/history.csv",
		},
	});

	return Effect.gen(function* () {
		yield* runProcessImportRunWorkflow(payload, executionId);

		const executed = harness.sandboxCalls.find(({ method }) => method === "executeWorkflow");
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
	}).pipe(Effect.provide(harness.layer));
});

it.effect("hands a secret-bearing stored source payload to the plugin import workflow", () => {
	const harness = makeHarness(false, false, false, {
		...sourceState,
		source: "igdb",
		sourcePayload: { apiKey: "secret", collection: "Favorites" },
	});

	return Effect.gen(function* () {
		yield* runProcessImportRunWorkflow(payload, executionId);

		const executed = harness.sandboxCalls.find(({ method }) => method === "executeWorkflow");
		expect(executed).toMatchObject({
			input: {
				input: {
					runId: "run-1",
					source: "igdb",
					sourcePayload: { apiKey: "secret", collection: "Favorites" },
				},
			},
		});
	}).pipe(Effect.provide(harness.layer));
});

it.effect("preserves workflow suspension while awaiting the plugin import child", () => {
	const harness = makeHarness(true);

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(runProcessImportRunWorkflow(payload, executionId));

		expect(Exit.hasInterrupts(exit)).toBe(true);
		expect(harness.activityNames).not.toContain("fail-import-run-unexpected");
	}).pipe(Effect.provide(harness.layer));
});

it.effect("releases the pre-registered pin when import orchestration fails terminally", () => {
	const harness = makeHarness(false, true);

	return Effect.gen(function* () {
		yield* runProcessImportRunWorkflow(payload, executionId);

		expect(harness.activityNames).toContain("release-import-workflow-pin");
		expect(harness.activityNames).toContain("cleanup-import-uploads-on-unexpected-failure");
	}).pipe(Effect.provide(harness.layer));
});

it.effect("releases input artifacts on terminal import cancellation", () => {
	const harness = makeHarness(true, false, false);

	return Effect.gen(function* () {
		yield* runProcessImportRunWorkflow(payload, executionId);

		expect(harness.activityNames).toContain("release-import-artifacts");
		expect(harness.activityNames).toContain("release-import-dispatch-artifacts");
		expect(harness.activityNames).toContain("cleanup-import-uploads-on-unexpected-failure");
	}).pipe(Effect.provide(harness.layer));
});
