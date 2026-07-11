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
import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { EventsService } from "#modules/events/service";
import {
	ImportSourceCatalog,
	type RegisteredImportSource,
} from "#modules/plugins/import-source-catalog";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { ImportRunFailuresService } from "./failure-service";
import { ProcessImportRunWorkflow } from "./import-run-workflow";
import { runProcessImportRunWorkflow } from "./import-run-workflow-live";
import type { ImportRunJobData } from "./jobs";
import { MediaImportWorkflowOperations } from "./media/types-workflow";
import { NonMediaImportWorkflowOperations } from "./non-media-workflow";
import { ImportRunError } from "./runtime/workflow-errors";
import { ImportRunArtifacts } from "./runtime/workflow-helpers";
import { ImportsService } from "./service";

const executionId = "import-run-dispatch";

const payload = {
	source: "netflix",
	sourcePayloadKey: "run-1",
	filePath: "/tmp/netflix.zip",
	userId: UserId.make("user-1"),
	runId: ImportRunId.make("run-1"),
} satisfies ImportRunJobData;

const netflixSource = {
	input: "file",
	name: "Netflix",
	slug: "netflix",
	pluginSlug: "media",
	requiredAppConfigKeys: [],
	description: "Netflix export",
	workflowSlug: "netflix-import",
	allowedFileExtensions: ["zip"],
} satisfies RegisteredImportSource;

type SandboxCall = { method: string; input: unknown };

const makeHarness = (registered: RegisteredImportSource | null) => {
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
						return null;
					}),
			}),
			Layer.mock(NonMediaImportWorkflowOperations)({
				getOperations: () =>
					Effect.suspend(() => {
						sandboxCalls.push({ input: null, method: "nonMediaGetOperations" });
						return Effect.fail(new ImportRunError({ message: "not wired in this test" }));
					}),
			}),
			dbRunnerLayer,
			BunFileSystem.layer,
			Layer.succeed(RedisService, makeRedisService()),
			Layer.mock(EntitiesService)({ _tag: "EntitiesService" }),
			Layer.mock(EntitiesRepository)({ _tag: "EntitiesRepository" }),
			Layer.mock(EntitySchemasRepository)({ _tag: "EntitySchemasRepository" }),
			Layer.mock(EventSchemasRepository)({ _tag: "EventSchemasRepository" }),
			Layer.mock(EventsService)({ _tag: "EventsService" }),
			Layer.mock(ImportsService)({ _tag: "ImportsService" }),
			Layer.mock(ImportRunFailuresService)({ _tag: "ImportRunFailuresService" }),
			Layer.mock(MediaImportWorkflowOperations)({}),
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
				authority: { type: "user", userId: "user-1" },
				scriptId: SandboxScriptId.make("workflow.netflix-import"),
				input: {
					runId: "run-1",
					userId: "user-1",
					sourcePayloadRef: "run-1",
					artifactPath: "/tmp/netflix.zip",
				},
			},
		});
		expect(harness.activityNames).toEqual([
			"mark-import-run-started",
			"cleanup-import-artifacts-on-success",
		]);
	}).pipe(Effect.provide(harness.layer));
});

it.effect("keeps an undeclared media source on the native media orchestration", () => {
	const harness = makeHarness(null);

	return Effect.gen(function* () {
		yield* runProcessImportRunWorkflow(payload, executionId);

		expect(harness.sandboxCalls).toEqual([]);
		expect(harness.activityNames).toContain("mark-import-run-started");
		expect(harness.activityNames).toContain("load-media-import-adapter-result");
	}).pipe(Effect.provide(harness.layer));
});

it.effect("keeps an undeclared non-media source on the native non-media orchestration", () => {
	const harness = makeHarness(null);

	return Effect.gen(function* () {
		yield* runProcessImportRunWorkflow({ ...payload, source: "hevy" }, executionId);

		expect(harness.sandboxCalls.map(({ method }) => method)).toEqual(["nonMediaGetOperations"]);
	}).pipe(Effect.provide(harness.layer));
});
