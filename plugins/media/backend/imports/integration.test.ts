import { assert, expect, it } from "@effect/vitest";
import type { JsonValue } from "@ryot-app/sandbox-sdk/wire";
import type { WorkflowReplayEnvelope, WorkflowReplayHost } from "@ryot-app/sandbox-sdk/workflow";
import { Cause, Effect, Exit } from "effect";

import { mediaImportTestCommand } from "./ingestion.test-support";
import workflow from "./integration.sandbox";

it.live(
	"collects the admitted integration once and applies captures through integration segments",
	() =>
		Effect.gen(function* () {
			const input = {
				runId: "run",
				source: "spotify",
				sourcePayloadHandle: "settings",
				command: mediaImportTestCommand("provider"),
				plan: {
					operation: "workflow.media-integration",
					selection: { "integration-adapter": "integration.spotify" },
				},
			};
			const journal: JsonValue[] = [];
			const requests: Array<WorkflowReplayEnvelope["requests"][number]> = [];
			let envelope: WorkflowReplayEnvelope;
			for (;;) {
				envelope = yield* workflow.run(
					input,
					{ replayJournal: () => Effect.succeed(journal) } satisfies WorkflowReplayHost,
					{ metadata: {}, sandboxScriptId: "media-integration" },
				);
				if (envelope.state !== "pending") {
					break;
				}
				const request = envelope.requests[journal.length];
				assert(request);
				requests.push(request);
				if (request.kind === "activity") {
					if (request.args.scriptSlug === "import.control") {
						journal.push({
							next: null,
							entries: [],
							settings: {
								integrationContext: { marker: "admitted" },
								integrationScriptSlug: "integration.spotify",
							},
						});
					}
				} else {
					assert(request.kind === "child");
					if (request.name === "seal") {
						journal.push({ summary: [], sealed: true });
					} else if (request.args.workflowSlug === "media-integration-collection") {
						expect(request.args.input).toMatchObject({
							page: 0,
							carry: null,
							integrationContext: { marker: "admitted" },
							integrationScriptSlug: "integration.spotify",
						});
						journal.push({
							page: 1,
							done: true,
							carry: null,
							ordinal: 65,
							run: { pages: 1, prefix: "integration-source-0" },
						});
					} else if (request.args.workflowSlug === "media-integration-segment") {
						expect(request.args.input).toMatchObject({
							integrationContext: { marker: "admitted" },
							integrationScriptSlug: "integration.spotify",
							run: { pages: 1, prefix: "integration-source-0" },
						});
						journal.push({
							page: 1,
							batch: 1,
							offset: 0,
							issues: [],
							done: true,
							ordinal: 67,
							itemIndex: 1,
							dedupKey: null,
						});
					} else if (request.name.startsWith("progress:")) {
						journal.push({ recorded: true });
					} else {
						expect(request.args.workflowSlug).toBe("kernel:process-import-chunks");
						journal.push({
							handle: "page-0",
							inputFingerprint: "fingerprint",
							captureId: "integration-source-0-0",
						});
					}
				}
			}
			expect(envelope.state).toBe("completed");
			expect(
				requests.filter(
					(request) =>
						request.kind === "child" &&
						request.args.workflowSlug === "media-integration-collection",
				),
			).toHaveLength(1);
			expect(
				requests.filter(
					(request) =>
						request.kind === "child" && request.args.workflowSlug === "media-import-collection",
				),
			).toHaveLength(0);
		}),
);

it.live("rejects a collector that differs from the accepted plan before collection", () =>
	Effect.gen(function* () {
		const exit = yield* Effect.exit(
			workflow.run(
				{
					runId: "run",
					source: "spotify",
					sourcePayloadHandle: "settings",
					command: mediaImportTestCommand("provider"),
					plan: {
						operation: "workflow.media-integration",
						selection: { "integration-adapter": "integration.spotify" },
					},
				},
				{
					replayJournal: () =>
						Effect.succeed([
							{
								next: null,
								entries: [],
								settings: {
									integrationContext: {},
									integrationScriptSlug: "integration.youtube-music",
								},
							},
						]),
				},
				{ metadata: {}, sandboxScriptId: "media-integration" },
			),
		);
		assert(Exit.isFailure(exit));
		expect(Cause.pretty(exit.cause)).toContain(
			"Media integration plan does not match its admitted collector",
		);
	}),
);

it.live("reports a collector-wide parse failure without assigning it to a record", () =>
	Effect.gen(function* () {
		const envelope = yield* workflow.run(
			{
				runId: "run",
				source: "kodi",
				sourcePayloadHandle: "settings",
				command: mediaImportTestCommand("provider"),
				plan: {
					operation: "workflow.media-integration",
					selection: { "integration-adapter": "integration.kodi" },
				},
			},
			{
				replayJournal: () =>
					Effect.succeed<readonly JsonValue[]>([
						{
							next: null,
							entries: [],
							settings: { integrationContext: {}, integrationScriptSlug: "integration.kodi" },
						},
						{
							page: 1,
							run: null,
							done: true,
							carry: null,
							ordinal: 65,
							sourceFailure: "input-transformation-failed",
						},
						{ summary: [], sealed: true },
					]),
			},
			{ metadata: {}, sandboxScriptId: "media-integration" },
		);
		assert(envelope.state === "completed");
		expect(envelope.output).toEqual({
			summary: [],
			issues: [
				{
					severity: "error",
					attribution: null,
					operationId: null,
					recordKind: "source",
					id: "integration-source-failure:0",
					reason: { key: null, code: "input-transformation-failed" },
				},
			],
		});
	}),
);
