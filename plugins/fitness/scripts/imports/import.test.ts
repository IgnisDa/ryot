import type { JsonValue } from "@ryot/sandbox-sdk/wire";
import type { WorkflowReplayEnvelope, WorkflowSandboxHost } from "@ryot/sandbox-sdk/workflow";
import { Effect } from "effect";
import { assert, expect, it } from "vitest";

import workflow from "./import.sandbox";

it("orchestrates the source script and kernel chunk consumer", async () => {
	const journal: JsonValue[] = [];
	const requests: Array<WorkflowReplayEnvelope["requests"][number]> = [];
	const replay = (): Promise<JsonValue> =>
		Effect.runPromise(
			workflow.run(
				{ runId: "run-1", source: "strong_app" },
				{ durableCalls: () => Effect.succeed(journal) } satisfies WorkflowSandboxHost,
				{ metadata: {}, sandboxScriptId: "fitness-import" },
			),
		).then((envelope) => {
			requests.splice(0, requests.length, ...envelope.requests);
			if (envelope.state === "completed") {
				return envelope.output;
			}
			if (envelope.state === "failed") {
				throw new Error(envelope.error);
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
			return replay();
		});

	const result = await replay();
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
					chunkHandles: ["harvest-handle-0"],
				},
			},
		}),
	]);
});
