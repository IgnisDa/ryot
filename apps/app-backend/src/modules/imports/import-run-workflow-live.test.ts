import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { Workflow } from "@effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "@effect/workflow/WorkflowEngine";
import { ImportRunId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";
import { assert } from "vitest";

import { RedisService } from "#lib/infrastructure/redis";
import {
	dbRunnerLayer,
	makeAppConfigLayer,
	makeRedisService,
	makeWorkflowEngine,
} from "#lib/test-utils/effect";
import {
	ImportSourceCatalog,
	type RegisteredImportSource,
} from "#modules/plugins/import-source-catalog";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { ImportRunFailuresService } from "./failure-service";
import { ProcessImportRunWorkflow } from "./import-run-workflow";
import { runProcessImportRunWorkflow } from "./import-run-workflow-live";
import type { ImportRunJobData } from "./jobs";
import { ImportRunArtifacts } from "./runtime/workflow-helpers";
import { ImportsService } from "./service";

const executionId = "import-run-dispatch";
const configSchema = { fields: {}, unknownKeys: "strict" } as const;

const payload = {
	source: "netflix",
	sourcePayloadKey: "run-1",
	filePath: "/tmp/netflix.zip",
	userId: UserId.make("user-1"),
	runId: ImportRunId.make("run-1"),
} satisfies ImportRunJobData;

const netflixSource = {
	lot: "single",
	input: "file",
	name: "Netflix",
	slug: "netflix",
	pluginSlug: "media",
	configSchema,
	requiredPluginConfigKeys: [],
	description: "Netflix export",
	workflowSlug: "netflix-import",
	allowedFileExtensions: ["zip"],
} satisfies RegisteredImportSource;

type SandboxCall = { method: string; input: unknown };

const makeHarness = (registered: RegisteredImportSource | null, suspendWorkflow = false) => {
	const activityNames: string[] = [];
	const sandboxCalls: SandboxCall[] = [];
	const instance = WorkflowInstance.initial(ProcessImportRunWorkflow, executionId);
	const engine = makeWorkflowEngine({
		activityExecute: (activity) =>
			Effect.sync(() => {
				activityNames.push(activity.name);
				return new Workflow.Complete({ exit: Exit.void });
			}),
	});

	return {
		activityNames,
		sandboxCalls,
		layer: Layer.mergeAll(
			makeAppConfigLayer(),
			Layer.succeed(WorkflowEngine, engine),
			Layer.succeed(WorkflowInstance, instance),
			Layer.mock(ImportRunArtifacts)({ _tag: "ImportRunArtifacts" }),
			Layer.mock(ImportSourceCatalog)({
				find: () => registered,
				_tag: "ImportSourceCatalog",
				list: () => (registered ? [registered] : []),
			}),
			Layer.mock(SandboxExecutionService)({
				_tag: "SandboxExecutionService",
				resolveWorkflowScript: (input) =>
					Effect.sync(() => {
						sandboxCalls.push({ input, method: "resolveWorkflowScript" });
						return SandboxScriptId.make("workflow.netflix-import");
					}),
				executeWorkflow: (input) =>
					Effect.sync(() => {
						sandboxCalls.push({ input, method: "executeWorkflow" });
					}).pipe(Effect.zipRight(suspendWorkflow ? Effect.interrupt : Effect.succeed(null))),
			}),
			dbRunnerLayer,
			BunFileSystem.layer,
			Layer.succeed(RedisService, makeRedisService()),
			Layer.mock(ImportsService)({ _tag: "ImportsService" }),
			Layer.mock(ImportRunFailuresService)({ _tag: "ImportRunFailuresService" }),
		),
	};
};

it.effect("dispatches a registry-declared source to its owning plugin's import workflow", () => {
	const harness = makeHarness(netflixSource);

	return Effect.gen(function* () {
		yield* runProcessImportRunWorkflow(payload, executionId);

		const [resolved, executed] = harness.sandboxCalls;
		assert(resolved !== undefined && executed !== undefined);
		expect(resolved).toEqual({
			method: "resolveWorkflowScript",
			input: { executionId, pluginSlug: "media", workflowSlug: "netflix-import" },
		});
		expect(executed).toEqual({
			method: "executeWorkflow",
			input: {
				executionId: `${executionId}-import`,
				input: { runId: "run-1", source: "netflix" },
				grants: { artifactPath: "/tmp/netflix.zip" },
				authority: { type: "user", userId: "user-1" },
				scriptId: SandboxScriptId.make("workflow.netflix-import"),
			},
		});
		expect(harness.activityNames).toEqual([
			"mark-import-run-started",
			"load-import-source-payload",
			"cleanup-import-artifacts-on-success",
		]);
	}).pipe(Effect.provide(harness.layer));
});

it.effect("grants only registry-declared named artifacts to a plugin import workflow", () => {
	const source = {
		lot: "named",
		input: "file",
		slug: "movary",
		name: "Movary",
		pluginSlug: "media",
		configSchema,
		requiredPluginConfigKeys: [],
		description: "Movary export",
		workflowSlug: "movary-import",
		artifacts: [
			{
				required: true,
				key: "historyFilePath",
				allowedFileExtensions: ["csv"],
				uploadTokenField: "historyUploadToken",
			},
		],
	} satisfies RegisteredImportSource;
	const harness = makeHarness(source);

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
	const harness = makeHarness({
		...netflixSource,
		slug: "igdb",
		name: "IGDB",
		workflowSlug: "import",
		allowedFileExtensions: ["csv"],
	});

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

it.effect("fails a run whose source is not registered", () => {
	const harness = makeHarness(null);

	return Effect.gen(function* () {
		yield* runProcessImportRunWorkflow(payload, executionId);

		expect(harness.sandboxCalls).toEqual([]);
		expect(harness.activityNames).toEqual(["fail-import-run"]);
	}).pipe(Effect.provide(harness.layer));
});

it.effect("preserves workflow suspension while awaiting the plugin import child", () => {
	const harness = makeHarness(netflixSource, true);

	return Effect.gen(function* () {
		const exit = yield* Effect.exit(runProcessImportRunWorkflow(payload, executionId));

		expect(Exit.isInterrupted(exit)).toBe(true);
		expect(harness.activityNames).not.toContain("fail-import-run-unexpected");
	}).pipe(Effect.provide(harness.layer));
});
