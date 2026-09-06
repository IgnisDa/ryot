import { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type { WorkflowReplayEnvelope, WorkflowReplayHost } from "@ryot-app/sandbox-sdk/workflow";
import { Effect, Schema } from "effect";
import { assert, expect, it } from "vitest";

import workflow from "./import.sandbox";

const importCommand = (runId: string) =>
	Schema.decodeSync(LifecycleCommand)({
		occurredAt: "2026-09-16T00:00:00.000Z",
		itemIdentity: JSON.stringify(["import-run", runId]),
		accountGeneration: { userId: "user-1", token: "test-account-generation" },
		causation: {
			depth: 0,
			source: "import",
			parentRunId: null,
			importRunId: runId,
			parentTriggerId: null,
			executionId: `execution-${runId}`,
			rootExecutionId: `execution-${runId}`,
			initiator: { id: "user-1", kind: "user" },
		},
	});

it("dispatches every fitness source to its matching parser activity", () =>
	Effect.runPromise(
		Effect.forEach(
			[
				["hevy", "import.hevy"],
				["strong_app", "import.strong-app"],
				["open_scale", "import.open-scale"],
			] as const,
			([source, scriptSlug]) =>
				workflow
					.run(
						{ source, runId: `run-${source}`, command: importCommand(`run-${source}`) },
						{ replayJournal: () => Effect.succeed([]) } satisfies WorkflowReplayHost,
						{ metadata: {}, sandboxScriptId: "fitness-import" },
					)
					.pipe(
						Effect.map((envelope) => {
							expect(envelope).toMatchObject({
								state: "pending",
								requests: [{ kind: "activity", args: { scriptSlug } }],
							});
							return envelope;
						}),
					),
		),
	));

it("orchestrates the source script and kernel chunk consumer", () => {
	const journal: JsonValue[] = [];
	const requests: Array<WorkflowReplayEnvelope["requests"][number]> = [];
	const replay = Effect.gen(function* () {
		for (;;) {
			const envelope = yield* workflow.run(
				{ runId: "run-1", source: "strong_app", command: importCommand("run-1") },
				{ replayJournal: () => Effect.succeed(journal) } satisfies WorkflowReplayHost,
				{ metadata: {}, sandboxScriptId: "fitness-import" },
			);
			requests.splice(0, requests.length, ...envelope.requests);
			if (envelope.state === "completed") {
				return envelope.output;
			}
			if (envelope.state === "failed") {
				assert.fail(envelope.error);
			}
			const request = envelope.requests[journal.length];
			assert(request);
			journal.push(
				request.kind === "activity"
					? {
							totalItems: 2,
							failureCount: 1,
							writeItemCount: 1,
							chunkHandles: ["harvest-handle-0"],
						}
					: { failedItems: 1, importedItems: 1, processedItems: 2 },
			);
		}
	});

	return Effect.runPromise(
		replay.pipe(
			Effect.map((result) => {
				expect(result).toEqual({ failedItems: 1, importedItems: 1, processedItems: 2 });
				expect(requests).toEqual([
					expect.objectContaining({
						kind: "activity",
						args: expect.objectContaining({ scriptSlug: "import.strong-app" }),
					}),
					expect.objectContaining({
						kind: "child",
						args: {
							workflowSlug: "kernel:process-import-chunks",
							input: {
								totalItems: 2,
								runId: "run-1",
								failureCount: 1,
								writeItemCount: 1,
								command: importCommand("run-1"),
								chunkHandles: ["harvest-handle-0"],
							},
						},
					}),
				]);
				return result;
			}),
		),
	);
});
