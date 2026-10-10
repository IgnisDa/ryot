import { afterEach, assert, expect, it } from "@effect/vitest";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import {
	genericImportActivityReference,
	genericImportApplyReference,
	genericImportCaptureReference,
	genericImportSealReference,
	genericImportChunkSchema,
} from "@ryot-app/sandbox-sdk/imports";
import {
	defineSandboxTestHost,
	makeWorkflowReplayHost,
	runSandboxTestScript,
} from "@ryot-app/sandbox-sdk/testing";
import { jsonValueSchema, type JsonValue } from "@ryot-app/sandbox-sdk/wire";
import type {
	WorkflowReplayEnvelope,
	WorkflowReplayJournalEntry,
} from "@ryot-app/sandbox-sdk/workflow";
import { TestClock } from "effect/testing";

import {
	execution,
	hostSuccess,
	httpSuccess,
	integrationRecord,
} from "../../tests/backend/automations/automation-test-utils";
import control from "../imports/control.sandbox";
import {
	mediaFilesystem,
	resetMediaFilesystem,
	mediaImportTestCommand,
} from "../imports/ingestion.test-support";
import root from "../imports/integration.sandbox";
import { MediaApplicationInput, MediaIntegrationCollectionInput } from "../imports/process";
import reader from "../imports/read-batch.sandbox";
import { MediaImportWriteChunkActivityInput } from "../imports/schemas";
import writer, { manifest as writerManifest } from "../imports/write-chunks.sandbox";
import segment from "../workflows/media-integration-segment.sandbox";
import spotify, { manifest as spotifyManifest } from "./yanks/spotify.sandbox";

type DriverError =
	| Schema.SchemaError
	| Effect.Error<ReturnType<typeof root.run>>
	| Effect.Error<ReturnType<typeof spotify.run>>
	| Effect.Error<ReturnType<typeof reader.run>>
	| Effect.Error<ReturnType<typeof writer.run>>;

afterEach(resetMediaFilesystem);
it.effect(
	"executes the admitted integration entrypoint through durable artifacts, generic receipt results, and the original adapter confirmation namespace",
	() =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.parse(execution.startedAt));
			const fs = mediaFilesystem({
				"": new TextEncoder().encode(
					'{"integrationContext":{},"integrationScriptSlug":"integration.spotify"}',
				),
			});
			const artifacts = new Map<string, Uint8Array>();
			const captures = new Map<string, Uint8Array>();
			const saved = new Set<string>();
			const receipts = new Map<string, JsonValue>();
			let fetched = 0;
			let confirms = 0;
			let materialized = 0;
			let writes = 0;
			const sourceHost = defineSandboxTestHost(spotifyManifest, {
				log: () => hostSuccess(null),
				span: () => hostSuccess(null),
				getPersistentValue: (key) => hostSuccess(saved.has(key) ? true : null),
				getCurrentIntegration: () =>
					hostSuccess(integrationRecord({ lot: "yank", provider: "spotify" })),
				claimPersistentValue: (key) => {
					saved.add(key);
					return hostSuccess({ claimed: true });
				},
				getOAuthAccessToken: () =>
					hostSuccess({ accessToken: "token", expiresAt: "2026-01-02T00:00:00Z" }),
				httpCall: () => {
					fetched++;
					return httpSuccess({
						items: [0, 1].map((index) => ({
							played_at: `2026-01-01T00:0${index}:00Z`,
							track: { id: "track", name: "Song", duration_ms: 60000 },
						})),
					});
				},
			});
			const writerHost = defineSandboxTestHost(writerManifest, {
				log: () => hostSuccess(null),
				getPluginConfig: () => hostSuccess({}),
				executeRyotql: () => Effect.die("Complete plays must not read progress"),
				getCurrentIntegration: () => Effect.die("Complete plays must not read progress settings"),
			});
			const materialize = (files: readonly string[]) =>
				files.map((file) => {
					const bytes = fs.scratch.get(file);
					assert(bytes);
					expect(bytes.length).toBeLessThanOrEqual(4 * 1024 * 1024);
					const handle = `opaque-${materialized++}`;
					artifacts.set(handle, bytes.slice());
					return handle;
				});
			const drive = Effect.fnUntraced(function* (
				run: (
					journal: WorkflowReplayJournalEntry[],
				) => Effect.Effect<WorkflowReplayEnvelope, DriverError>,
			): Effect.fn.Return<JsonValue, DriverError> {
				const journal: WorkflowReplayJournalEntry[] = [];
				for (;;) {
					const envelope = yield* run(journal);
					if (envelope.state === "completed") {
						return envelope.output;
					}
					assert(envelope.state === "pending");
					const request = envelope.requests[journal.length];
					assert(request);
					let result: unknown;
					if (request.kind === "activity") {
						if (request.args.scriptSlug === "import.control") {
							result = yield* control.run(
								yield* Schema.decodeUnknownEffect(control.input)(request.args.input),
							);
						} else if (request.args.scriptSlug === "integration.spotify") {
							const input = yield* Schema.decodeUnknownEffect(spotify.input)(request.args.input);
							if (input.ingestionConfirmation) {
								confirms++;
							}
							const output = yield* runSandboxTestScript(spotify, input, sourceHost, execution);
							result = { ...output, chunkHandles: materialize(output.chunkFiles) };
						} else if (request.args.scriptSlug === "import.read-batch") {
							const input = yield* Schema.decodeUnknownEffect(reader.input)(request.args.input);
							for (const [key, capture] of Object.entries(input.ingestionArtifacts.captures)) {
								const bytes = captures.get(capture);
								assert(bytes);
								fs.files.set(key, bytes);
							}
							const output = yield* reader.run(input);
							result = { ...output, chunkHandles: materialize(output.chunkFiles) };
						} else {
							expect(request.args.scriptSlug).toBe("import.write-chunks");
							const input = yield* Schema.decodeUnknownEffect(MediaImportWriteChunkActivityInput)(
								request.args.input,
							);
							for (const [key, capture] of Object.entries(
								input.ingestionArtifacts?.captures ?? {},
							)) {
								const bytes = captures.get(capture);
								assert(bytes);
								fs.files.set(key, bytes);
							}
							const output = yield* writer.run(input, writerHost);
							result = { chunkHandles: materialize(output.chunkFiles) };
						}
					} else {
						assert(request.kind === "child");
						const slug = request.args.workflowSlug;
						if (slug === "media-integration-collection") {
							const input = yield* Schema.decodeUnknownEffect(MediaIntegrationCollectionInput)(
								request.args.input,
							);
							result = yield* drive((childJournal) =>
								segment.run(input, makeWorkflowReplayHost(childJournal), execution),
							);
						} else if (slug === "media-integration-segment") {
							const input = yield* Schema.decodeUnknownEffect(MediaApplicationInput)(
								request.args.input,
							);
							result = yield* drive((childJournal) =>
								segment.run(input, makeWorkflowReplayHost(childJournal), execution),
							);
						} else if (slug === "media-import-population") {
							result = { results: [{ index: 0, entityId: "music", status: "completed" }] };
						} else {
							const input = yield* Schema.decodeUnknownEffect(
								Schema.Union([
									genericImportCaptureReference.input,
									genericImportApplyReference.input,
									genericImportSealReference.input,
									genericImportActivityReference.input,
								]),
							)(request.args.input);
							const operation = input.operation;
							if (operation.action === "capture") {
								const bytes = artifacts.get(operation.handle);
								assert(bytes);
								captures.set(operation.captureId, bytes.slice());
								result = {
									handle: operation.handle,
									captureId: operation.captureId,
									inputFingerprint: operation.captureId,
								};
							} else if (operation.action === "apply") {
								const replay = receipts.get(operation.batchId);
								if (replay) {
									result = replay;
								} else {
									const chunk = yield* Schema.decodeEffect(
										Schema.fromJsonString(genericImportChunkSchema),
									)(new TextDecoder().decode(captures.get(operation.captureId)));
									const events = chunk.items.flatMap((item) => item.events);
									writes += events.length;
									result = {
										issues: [],
										summary: [],
										confirmed: events.map((event) => ({
											reason: null,
											result: "created",
											operationId: event.operationId,
											attribution: event.attribution,
										})),
									};
									receipts.set(
										operation.batchId,
										yield* Schema.decodeUnknownEffect(jsonValueSchema)(result),
									);
								}
							} else {
								result =
									operation.action === "activity"
										? { recorded: true }
										: { summary: [], sealed: true };
							}
						}
					}
					journal.push({
						request,
						value: yield* Schema.decodeUnknownEffect(jsonValueSchema)(result),
					});
				}
			});
			const rootJournal: WorkflowReplayJournalEntry[] = [];
			const input = {
				runId: "run",
				source: "spotify",
				sourcePayloadHandle: "settings",
				command: mediaImportTestCommand("integration-1"),
				plan: {
					operation: "workflow.media-integration",
					selection: { "integration-adapter": "integration.spotify" },
				},
			};
			yield* drive((journal) => {
				rootJournal.splice(0, rootJournal.length, ...journal);
				return root.run(input, makeWorkflowReplayHost(journal), execution);
			});
			expect(fetched).toBe(1);
			expect(writes).toBe(2);
			expect(confirms).toBe(1);
			expect(saved.size).toBe(2);
			expect(captures.has("integration-source-0-0")).toBe(true);
			expect((yield* root.run(input, makeWorkflowReplayHost(rootJournal), execution)).state).toBe(
				"completed",
			);
			expect(fetched).toBe(1);
			expect(writes).toBe(2);
		}),
);
