import { assert, expect, it } from "@effect/vitest";
import { genericImportKernelInputSchema } from "@ryot-app/sandbox-sdk/imports";
import type { JsonValue } from "@ryot-app/sandbox-sdk/wire";
import type { WorkflowReplayEnvelope, WorkflowReplayHost } from "@ryot-app/sandbox-sdk/workflow";
import { Effect, Schema } from "effect";

import { mediaImportTestCommand } from "../imports/ingestion.test-support";
import workflow from "./media-integration-segment.sandbox";

it.live(
	"applies multiple batches and continues the same provider with only confirmed event outcomes",
	() =>
		Effect.gen(function* () {
			const journal: JsonValue[] = [];
			const requests: Array<WorkflowReplayEnvelope["requests"][number]> = [];
			const input = {
				page: 0,
				batch: 0,
				offset: 0,
				ordinal: 64,
				itemIndex: 0,
				runId: "run",
				dedupKey: null,
				issueLimit: 1000,
				run: { pages: 2, prefix: "source" },
				command: mediaImportTestCommand("provider"),
				integrationScriptSlug: "integration.spotify",
				integrationContext: { marker: "original-context" },
			};
			const confirmations = [
				[
					{
						reason: null,
						result: "created",
						operationId: "original-event-1",
						attribution: {
							sourceLabel: "First",
							sourceIdentifier: "track-1",
							recordId: "provider-record-1",
						},
					},
				],
				[
					{
						result: "skipped",
						operationId: "original-event-2",
						reason: { key: null, code: "policy" },
						attribution: {
							sourceLabel: "Second",
							sourceIdentifier: "track-2",
							recordId: "provider-record-2",
						},
					},
				],
			];
			let prepared = 0;
			let applied = 0;
			let envelope: WorkflowReplayEnvelope;
			for (;;) {
				envelope = yield* workflow.run(
					input,
					{ replayJournal: () => Effect.succeed(journal) } satisfies WorkflowReplayHost,
					{ metadata: {}, sandboxScriptId: "media-application" },
				);
				if (envelope.state !== "pending") {
					break;
				}
				const request = envelope.requests[journal.length];
				assert(request);
				requests.push(request);
				if (request.kind === "activity") {
					if (request.args.scriptSlug === "import.read-batch") {
						journal.push({
							offset: 10,
							done: true,
							dedupKey: null,
							itemIndex: prepared,
							chunkHandles: [`source-batch-${prepared++}`],
							batch: { failures: [], totalItems: 0, entityGroups: [] },
						});
					} else if (request.args.scriptSlug === "import.write-chunks") {
						journal.push({ chunkHandles: [`writes-${applied}`] });
					} else {
						expect(request.args.scriptSlug).toBe("integration.spotify");
						expect(request.args.input).toEqual({
							marker: "original-context",
							ingestionConfirmation: {
								part: 0,
								final: true,
								runId: "run",
								batchId: `media-${applied - 1}`,
								confirmed: confirmations[applied - 1],
								inputFingerprint: `fingerprint-${applied - 1}`,
							},
						});
						journal.push({ chunkHandles: [] });
					}
				} else {
					assert(request.kind === "child");
					expect(request.args.workflowSlug).toBe("kernel:process-import-chunks");
					const { operation } = yield* Schema.decodeUnknownEffect(genericImportKernelInputSchema)(
						request.args.input,
					);
					if (operation.action === "capture") {
						journal.push({
							handle: operation.handle,
							captureId: operation.captureId,
							inputFingerprint: `fingerprint-${applied}`,
						});
					} else {
						expect(operation.action).toBe("apply");
						journal.push({ issues: [], summary: [], confirmed: confirmations[applied++] ?? [] });
					}
				}
			}
			assert(envelope.state === "completed");
			expect(prepared).toBe(2);
			expect(applied).toBe(2);
			expect(
				requests.filter(
					(request) =>
						request.kind === "activity" && request.args.scriptSlug === "integration.spotify",
				),
			).toHaveLength(2);
			for (const request of requests) {
				if (request.kind === "child") {
					expect(
						(yield* Schema.decodeUnknownEffect(genericImportKernelInputSchema)(request.args.input))
							.command,
					).toEqual(input.command);
				}
			}
		}),
);
