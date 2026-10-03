import { tmpdir } from "node:os";

import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Effect, Layer } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import { makeAppConfigLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { IngestionCaptures } from "./capture-service";
import { IngestionExecution } from "./execution-service";
import { ProcessImportRunWorkflow } from "./import-run-workflow";
import { runProcessImportRunWorkflow } from "./import-run-workflow-live";
import {
	ingestionTestDatabase,
	ingestionTestNow,
	ingestionTestRun,
	ingestionTestScope,
	ingestionTestSource,
} from "./ingestion.test-support";
import { ImportsRepository } from "./repository";
import { ImportSourceStateStore } from "./runtime/source-state-store";

const command = rootLifecycleCommand({
	source: "import",
	itemIdentity: "root",
	importRunId: ingestionTestScope.runId,
	occurredAt: IsoUtcString.make(ingestionTestNow),
	accountGeneration: ingestionTestScope.accountGeneration,
	initiator: { kind: "user", id: ingestionTestScope.userId },
	executionId: AutomationExecutionId.make(ingestionTestScope.runId),
});
const rootCase = (
	status: "running" | "cancelling",
	sealed: boolean,
	failure: "none" | "source" | "suspend",
	cancelAtStart = false,
) =>
	Effect.gen(function* () {
		let run = ingestionTestRun({ status, collectionSealed: sealed });
		const calls: unknown[] = [];
		const settlements: string[] = [];
		const instance = WorkflowInstance.initial(ProcessImportRunWorkflow, ingestionTestScope.runId);
		instance.suspended = failure === "suspend";
		const dependencies = Layer.mergeAll(
			ingestionTestDatabase(),
			makeAppConfigLayer({ fileStorage: { localTempDir: tmpdir() } }),
			BunFileSystem.layer,
			Layer.mock(DefinitionRepository)({}),
			Layer.succeed(WorkflowInstance, instance),
			Layer.succeed(
				WorkflowEngine,
				makeWorkflowEngine({
					activityExecute: (activity) =>
						Effect.map(Effect.exit(activity.execute), (exit) => new Workflow.Complete({ exit })),
				}),
			),
			Layer.mock(ImportsRepository)({
				listBatches: () => Effect.succeed([]),
				getIngestionRun: () => Effect.sync(() => run),
				startIngestion: () =>
					Effect.sync(() => {
						if (cancelAtStart) {
							run = { ...run, status: "cancelling" };
						}
						return false;
					}),
			}),
			Layer.mock(IngestionExecution)({
				cleanup: () => Effect.void,
				settle: (input) =>
					Effect.sync(() => {
						settlements.push(input.status);
						run = { ...run, status: input.status };
						return true;
					}),
			}),
			Layer.mock(IngestionCaptures)({
				recover: () => Effect.void,
				stage: () => Effect.succeed("staged-input-handle"),
			}),
			Layer.mock(ImportSourceStateStore)({
				materialize: () => Effect.succeed(ingestionTestSource),
			}),
			Layer.mock(SandboxArtifactStore)({
				retain: () => Effect.void,
				release: () => Effect.void,
				materializeInputs: (owner, _reference, grants) =>
					Effect.succeed({
						artifactOwnerExecutionId: owner,
						...(grants.namedArtifactPaths
							? { namedArtifactPaths: { ...grants.namedArtifactPaths } }
							: {}),
					}),
			}),
			Layer.mock(SandboxExecutionService)({
				executeWorkflow: (input) => {
					const call = Effect.sync(() => calls.push(input));
					if (failure === "suspend") {
						return call.pipe(Effect.andThen(Effect.interrupt));
					}
					if (failure === "source") {
						return call.pipe(
							Effect.andThen(
								Effect.fail(
									new SandboxRunError({ kind: "script-failure", message: "source failed" }),
								),
							),
						);
					}
					return call.pipe(Effect.as(null));
				},
			}),
		);
		yield* runProcessImportRunWorkflow(
			{ ...ingestionTestScope, command },
			ingestionTestScope.runId,
		).pipe(Effect.scoped, Effect.exit, Effect.provideContext(yield* Layer.build(dependencies)));
		return { run, calls, settlements };
	});

it.effect(
	"passes the accepted plan and opaque admitted input, then completes a sealed successful no-op",
	() =>
		Effect.gen(function* () {
			const result = yield* rootCase("running", true, "none");
			expect(result.calls).toEqual([
				expect.objectContaining({
					scriptId: "script-1",
					executionId: "run-1-import",
					input: {
						command,
						runId: "run-1",
						source: "fixture",
						sourcePayloadHandle: "staged-input-handle",
						plan: { selection: {}, operation: "fixture" },
					},
					subject: {
						type: "user",
						userId: ingestionTestScope.userId,
						importRunId: ingestionTestScope.runId,
						accountGeneration: ingestionTestScope.accountGeneration,
					},
				}),
			]);
			expect(result.settlements).toEqual(["completed"]);
		}),
);
it.effect("does not treat a source return as proof of collection completion", () =>
	Effect.gen(function* () {
		expect((yield* rootCase("running", false, "none")).settlements).toEqual(["failed"]);
	}),
);
it.effect("settles cancellation before entering source work", () =>
	Effect.gen(function* () {
		const result = yield* rootCase("cancelling", false, "none");
		expect(result.calls).toEqual([]);
		expect(result.settlements).toEqual(["cancelled"]);
	}),
);
it.effect("fails an execution error but retains a suspended root for recovery", () =>
	Effect.gen(function* () {
		expect((yield* rootCase("running", false, "source")).settlements).toEqual(["failed"]);
		expect((yield* rootCase("running", false, "suspend")).settlements).toEqual([]);
	}),
);

it.effect("settles cancellation when it wins the start transition", () =>
	Effect.gen(function* () {
		const result = yield* rootCase("running", false, "none", true);
		expect(result.calls).toEqual([]);
		expect(result.settlements).toEqual(["cancelled"]);
	}),
);
