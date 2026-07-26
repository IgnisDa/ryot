import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { SandboxRunError } from "@ryot/contract/errors";
import { ImportRunId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer, Option } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";
import { assert } from "vitest";

import { RedisService } from "#lib/infrastructure/redis";
import {
	dbRunnerLayer,
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
	source: "netflix",
	pluginSlug: "media",
	sourcePayloadKey: "run-1",
	filePath: "/tmp/netflix.zip",
	uploadIntentIds: ["intent-netflix"],
	userId: UserId.make("user-1"),
	runId: ImportRunId.make("run-1"),
	workflowScriptId: SandboxScriptId.make("accepted.netflix-import"),
} satisfies ImportRunJobData;

type SandboxCall = { method: string; input: unknown };

const makeHarness = (suspendWorkflow = false, failWorkflow = false) => {
	const activityNames: string[] = [];
	const sandboxCalls: SandboxCall[] = [];
	const sandboxParents: boolean[] = [];
	const instance = WorkflowInstance.initial(ProcessImportRunWorkflow, executionId);
	const engine = makeWorkflowEngine({
		activityExecute: (activity) =>
			Effect.sync(() => {
				activityNames.push(activity.name);
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
			dbRunnerLayer,
			BunFileSystem.layer,
			Layer.succeed(RedisService, makeRedisService()),
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
				grants: { artifactPath: "/tmp/netflix.zip" },
				authority: { type: "user", userId: "user-1" },
				scriptId: SandboxScriptId.make("accepted.netflix-import"),
			},
		});
		expect(harness.activityNames).toEqual([
			"mark-import-run-started",
			"load-import-source-payload",
			"cleanup-import-artifacts-on-success",
			"cleanup-import-uploads-on-success",
		]);
		expect(harness.sandboxParents).toEqual([false]);
	}).pipe(Effect.provide(harness.layer));
});

it.effect("grants only registry-declared named artifacts to a plugin import workflow", () => {
	const harness = makeHarness();

	return Effect.gen(function* () {
		yield* runProcessImportRunWorkflow(
			{
				...payload,
				source: "movary",
				filePath: "/tmp/history.csv",
				namedArtifactPaths: {
					ignoredFilePath: "/tmp/ignored.csv",
					historyFilePath: "/tmp/history.csv",
				},
			},
			executionId,
		);

		const executed = harness.sandboxCalls.find(({ method }) => method === "executeWorkflow");
		expect(executed).toMatchObject({
			input: { grants: { namedArtifactPaths: { historyFilePath: "/tmp/history.csv" } } },
		});
	}).pipe(Effect.provide(harness.layer));
});

it.effect("hands declared source payload to the plugin import workflow", () => {
	const harness = makeHarness();

	return Effect.gen(function* () {
		yield* runProcessImportRunWorkflow(
			{
				...payload,
				source: "igdb",
				filePath: "/tmp/games.csv",
				sourcePayload: { collection: "Favorites" },
			},
			executionId,
		);

		const executed = harness.sandboxCalls.find(({ method }) => method === "executeWorkflow");
		expect(executed).toMatchObject({
			input: {
				input: { runId: "run-1", source: "igdb", sourcePayload: { collection: "Favorites" } },
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
