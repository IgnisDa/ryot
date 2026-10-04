import { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import type {
	IngestionIssue,
	IngestionSummary,
} from "@ryot-app/contract/modules/imports/ingestion";
import {
	configureSandboxFilesystem,
	type SandboxFilesystemBinding,
} from "@ryot-app/sandbox-sdk/filesystem";
import {
	genericImportChunkSchema,
	genericImportKernelInputSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { makeWorkflowReplayHost } from "@ryot-app/sandbox-sdk/testing";
import { jsonValueSchema, type JsonValue } from "@ryot-app/sandbox-sdk/wire";
import type {
	WorkflowReplayEnvelope,
	WorkflowReplayJournalEntry,
} from "@ryot-app/sandbox-sdk/workflow";
import { Effect, Schema } from "effect";
import { afterEach, assert, expect, it } from "vitest";

import applicationWorkflow from "../workflows/fitness-import-application.sandbox";
import mergeWorkflow from "../workflows/fitness-import-merge.sandbox";
import workflow from "./import.sandbox";
import { FitnessApplicationInput, FitnessMergeInput, FitnessStageInput } from "./schemas";
import { FitnessSettingsInput } from "./settings";
import settingsScript from "./settings.sandbox";
import { runFitnessStage } from "./shared";

let filesystemBinding: SandboxFilesystemBinding | undefined;
configureSandboxFilesystem(() => filesystemBinding);
afterEach(() => {
	filesystemBinding = undefined;
});

const command = Schema.decodeSync(LifecycleCommand)({
	occurredAt: "2026-09-16T00:00:00.000Z",
	itemIdentity: '["import-run","run-1"]',
	accountGeneration: { userId: "user-1", token: "generation" },
	causation: {
		depth: 0,
		source: "import",
		parentRunId: null,
		importRunId: "run-1",
		executionId: "run-1",
		parentTriggerId: null,
		rootExecutionId: "run-1",
		initiator: { id: "user-1", kind: "user" },
	},
});

const runImport = Effect.fn(function* (source: string, csv: string) {
	const encoder = new TextEncoder();
	const upload = encoder.encode(csv);
	const captures = new Map<string, Uint8Array>();
	const handles = new Map<string, Uint8Array>();
	const journal: WorkflowReplayJournalEntry[] = [];
	const requests: Array<WorkflowReplayEnvelope["requests"][number]> = [];
	const chunks: Array<typeof genericImportChunkSchema.Type> = [];
	const collectionOffsets: number[] = [];
	let uploadBytesRead = 0;
	let grants: Record<string, Uint8Array> = {};
	const primary = encoder.encode('{"timezone":"Asia/Kolkata"}');
	let files: Array<{ name: string; contents: Uint8Array }> = [];
	let writing = false;
	let maximumRead = 0;
	const summary: Array<IngestionSummary[number]> = [];
	const issues: IngestionIssue[] = [];
	const add = (
		recordKind: string,
		unit: string,
		result: keyof IngestionSummary[number]["counts"],
	) => {
		let dimension = summary.find((value) => value.recordKind === recordKind && value.unit === unit);
		if (!dimension) {
			dimension = {
				unit,
				recordKind,
				counts: { created: 0, updated: 0, skipped: 0, unchanged: 0, unsuccessful: 0 },
			};
			summary.push(dimension);
		}
		summary[summary.indexOf(dimension)] = {
			...dimension,
			counts: { ...dimension.counts, [result]: dimension.counts[result] + 1 },
		};
	};
	filesystemBinding = {
		readArtifact: () => Promise.resolve(primary),
		writeScratchChunks: (scratch) => {
			files = [...scratch];
			return Promise.resolve();
		},
		readNamedArtifact: (key: string) => {
			let bytes = key === "uploadToken" ? upload : grants[key];
			assert(bytes, `Missing grant ${key}`);
			return Promise.resolve(bytes);
		},
		readArtifactRange: (offset: number, length: number, key?: string) => {
			maximumRead = Math.max(maximumRead, length);
			let bytes = key === undefined ? primary : grants[key];
			if (key === "uploadToken") {
				bytes = upload;
			}
			assert(bytes, `Missing grant ${key}`);
			if (key === "uploadToken") {
				expect(writing).toBe(false);
				expect(offset).toBe(uploadBytesRead);
				collectionOffsets.push(offset);
				uploadBytesRead += bytes.slice(offset, offset + length).length;
			}
			return Promise.resolve({ size: bytes.length, bytes: bytes.slice(offset, offset + length) });
		},
	};
	let parser = "import.open-scale";
	if (source === "hevy") {
		parser = "import.hevy";
	}
	if (source === "strong_app") {
		parser = "import.strong-app";
	}
	const input = {
		source,
		command,
		runId: "run-1",
		sourcePayloadHandle: "admitted-settings",
		plan: { operation: "import", selection: { "source-parser": parser } },
	};
	const executeRequest = (
		request: WorkflowReplayEnvelope["requests"][number],
	): Effect.Effect<
		JsonValue,
		Effect.Error<ReturnType<typeof runFitnessStage>> | Effect.Error<ReturnType<typeof workflow.run>>
	> =>
		Effect.gen(function* () {
			requests.push(request);
			let value: unknown;
			if (request.kind === "activity") {
				if (request.args.scriptSlug === "import.settings") {
					const settingsInput = yield* Schema.decodeUnknownEffect(FitnessSettingsInput)(
						request.args.input,
					);
					const observed = yield* settingsScript.run(settingsInput);
					value = observed;
				} else {
					const stageInput = yield* Schema.decodeUnknownEffect(FitnessStageInput)(
						request.args.input,
					);
					grants = {};
					if ("ingestionArtifacts" in stageInput && stageInput.ingestionArtifacts) {
						for (const [name, captureId] of Object.entries(
							stageInput.ingestionArtifacts.captures,
						)) {
							const bytes = captures.get(captureId);
							assert(bytes);
							grants[name] = bytes;
						}
					}
					files = [];
					const observed = yield* runFitnessStage(source, stageInput);
					const { chunkFiles, ...result } = observed;
					const chunkHandles = chunkFiles.map((name) => {
						const file = files.find((candidate) => candidate.name === name);
						assert(file);
						expect(file.contents.length).toBeLessThanOrEqual(4 * 1024 * 1024);
						const handle = `${request.index}:${name}`;
						handles.set(handle, file.contents);
						return handle;
					});
					value = { ...result, chunkHandles };
				}
			} else if (request.kind === "child" && request.args.workflowSlug === "import-application") {
				const childInput = yield* Schema.decodeUnknownEffect(FitnessApplicationInput)(
					request.args.input,
				);
				const childJournal: WorkflowReplayJournalEntry[] = [];
				for (;;) {
					const envelope = yield* applicationWorkflow.run(
						childInput,
						makeWorkflowReplayHost(childJournal),
						{ metadata: {}, sandboxScriptId: "fitness-import-application" },
					);
					if (envelope.state === "failed") {
						assert.fail(envelope.error);
					}
					if (envelope.state === "completed") {
						value = envelope.output;
						break;
					}
					const pending = envelope.requests[childJournal.length];
					assert(pending);
					childJournal.push({ request: pending, value: yield* executeRequest(pending) });
				}
			} else if (request.kind === "child" && request.args.workflowSlug === "import-merge") {
				const childInput = yield* Schema.decodeUnknownEffect(FitnessMergeInput)(request.args.input);
				const childJournal: WorkflowReplayJournalEntry[] = [];
				for (;;) {
					const envelope = yield* mergeWorkflow.run(
						childInput,
						makeWorkflowReplayHost(childJournal),
						{ metadata: {}, sandboxScriptId: "fitness-import-merge" },
					);
					if (envelope.state === "failed") {
						assert.fail(envelope.error);
					}
					if (envelope.state === "completed") {
						value = envelope.output;
						break;
					}
					const pending = envelope.requests[childJournal.length];
					assert(pending);
					childJournal.push({ request: pending, value: yield* executeRequest(pending) });
				}
			} else {
				assert(request.kind === "child");
				const child = yield* Schema.decodeUnknownEffect(genericImportKernelInputSchema)(
					request.args.input,
				);
				expect(child.command).toEqual(command);
				const operation = child.operation;
				switch (operation.action) {
					case "capture": {
						const bytes = handles.get(operation.handle);
						assert(bytes);
						captures.set(operation.captureId, bytes);
						handles.delete(operation.handle);
						value = {
							handle: operation.handle,
							captureId: operation.captureId,
							inputFingerprint: `fingerprint:${operation.captureId}`,
						};
						break;
					}
					case "activity":
						value = { recorded: true };
						break;
					case "seal":
						value = { summary, sealed: true };
						break;
					case "apply": {
						writing = true;
						const bytes = captures.get(operation.captureId);
						assert(bytes);
						const chunk = yield* Schema.decodeEffect(
							Schema.fromJsonString(genericImportChunkSchema),
						)(new TextDecoder().decode(bytes));
						chunks.push(chunk);
						const batchSummary: Array<IngestionSummary[number]> = [];
						const before = structuredClone(summary);
						for (const item of chunk.items) {
							for (const intent of [...item.entities, ...item.events]) {
								if (intent.outcome) {
									let result: keyof IngestionSummary[number]["counts"] = "created";
									if (
										item.itemIndex === 1 &&
										item.events.some((event, index) => index >= 1 && event === intent)
									) {
										result = "unsuccessful";
									}
									if (item.itemIndex === 2 && intent === item.events[0]) {
										result = "skipped";
									}
									add(intent.outcome.recordKind, intent.outcome.unit, result);
									if (result === "unsuccessful") {
										issues.push({
											severity: "error",
											id: intent.operationId,
											operationId: intent.operationId,
											recordKind: intent.outcome.recordKind,
											reason: { key: null, code: "database-commit-failed" },
											attribution: intent.attribution ?? {
												recordId: item.recordId,
												sourceLabel: item.sourceLabel,
												sourceIdentifier: item.sourceIdentifier,
											},
										});
									}
								}
							}
						}
						for (const failure of chunk.failures) {
							add(failure.recordKind, failure.unit, "unsuccessful");
						}
						for (const dimension of summary) {
							const prior = before.find(
								(candidate) =>
									candidate.recordKind === dimension.recordKind &&
									candidate.unit === dimension.unit,
							);
							batchSummary.push({
								...dimension,
								counts: {
									updated: 0,
									unchanged: 0,
									created: dimension.counts.created - (prior?.counts.created ?? 0),
									skipped: dimension.counts.skipped - (prior?.counts.skipped ?? 0),
									unsuccessful: dimension.counts.unsuccessful - (prior?.counts.unsuccessful ?? 0),
								},
							});
						}
						value = {
							confirmed: [],
							summary: batchSummary,
							issues: issues.filter((issue) =>
								chunk.items.some((item) => item.recordId === issue.attribution?.recordId),
							),
						};
						break;
					}
					case "captures":
					case "materialize":
						assert.fail("Unexpected core operation");
				}
			}
			return yield* Schema.decodeUnknownEffect(jsonValueSchema)(structuredClone(value));
		});
	for (;;) {
		const envelope = yield* workflow.run(input, makeWorkflowReplayHost(journal), {
			metadata: {},
			sandboxScriptId: "fitness-import",
		});
		if (envelope.state === "failed") {
			assert.fail(envelope.error);
		}
		if (envelope.state === "completed") {
			expect(uploadBytesRead).toBe(upload.length);
			const replayed = yield* workflow.run(input, makeWorkflowReplayHost(journal), {
				metadata: {},
				sandboxScriptId: "fitness-import",
			});
			expect(replayed).toEqual(envelope);
			return {
				chunks,
				requests,
				captures,
				maximumRead,
				collectionOffsets,
				output: envelope.output,
			};
		}
		const request = envelope.requests[journal.length];
		assert(request);
		journal.push({ request, value: yield* executeRequest(request) });
	}
});

it.each(["hevy", "strong_app"])(
	"collects %s once across byte pages and application batches, grouping nonadjacent sets in original workout order",
	(source) => {
		const comment = '"' + '🏋️ note\n""quoted"" '.repeat(100) + '"';
		const header =
			source === "hevy"
				? "title,start_time,end_time,exercise_title,set_type,set_order,weight_kg,reps,exercise_notes"
				: "Date,Workout Name,Duration,Exercise Name,Set Order,Weight (kg),Reps,Notes";
		const rows = [];
		for (let set = 0; set < 3; set++) {
			for (let index = 0; index < 76; index++) {
				const date = `2026-01-${String((index % 28) + 1).padStart(2, "0")} 08:00:00`;
				rows.push(
					source === "hevy"
						? `Workout ${index},${date},${date},Bench Press,normal,${set},${100 + set},5,${comment}`
						: `${date},Workout ${index},3600,Bench Press,${set},${100 + set},5,${comment}`,
				);
			}
		}
		return Effect.runPromise(
			runImport(source, [header, ...rows].join("\r\n")).pipe(
				Effect.map((result) => {
					const items = result.chunks.flatMap((chunk) => chunk.items);
					expect(items).toHaveLength(76);
					expect(result.chunks.length).toBeGreaterThan(1);
					expect(result.collectionOffsets.length).toBeGreaterThan(1);
					expect(result.maximumRead).toBeLessThanOrEqual(1024 * 1024);
					expect(items.map((item) => item.itemIndex)).toEqual(
						Array.from({ length: 76 }, (_, index) => index),
					);
					expect(items[51]?.events.map((event) => event.properties["weight"])).toEqual([
						100, 101, 102,
					]);
					expect(items[51]?.events.map((event) => event.properties["setOrder"])).toEqual([0, 1, 2]);
					expect(items[51]?.events[0]?.properties["note"]).toContain('🏋️ note\n"quoted"');
					expect(
						items.every((item) =>
							item.events.every(
								(event) => event.properties["note"] === '🏋️ note\n"quoted" '.repeat(100).trim(),
							),
						),
					).toBe(true);
					const operationIds = items.flatMap((item) =>
						[...item.entities, ...item.events, ...item.relationships].map(
							(intent) => intent.operationId,
						),
					);
					expect(new Set(operationIds).size).toBe(operationIds.length);
					expect(items[51]?.entities[0]?.providerResolution).toEqual({
						value: "Bench Press",
						identifierType: "name",
						providerSlug: "exercise.free-exercise-db",
					});
					expect(result.output).toMatchObject({
						issues: [
							{ reason: { code: "database-commit-failed" } },
							{ reason: { code: "database-commit-failed" } },
						],
						summary: [
							{ unit: "workouts", counts: { created: 76 } },
							{ unit: "sets", counts: { skipped: 1, created: 225, unsuccessful: 2 } },
						],
					});
					expect(JSON.stringify(result.output)).not.toContain("chunkHandles");
				}),
			),
		);
	},
	30000,
);

it("applies more than one OpenScale batch with original row identities and measurement units", () =>
	Effect.runPromise(
		runImport(
			"open_scale",
			[
				"dateTime,Weight,comment",
				...Array.from(
					{ length: 76 },
					(_, index) =>
						`2026-01-01T08:${String(index % 60).padStart(2, "0")}:00Z,${index === 55 ? "bad" : 70 + index},"note 🏋️"`,
				),
			].join("\n"),
		).pipe(
			Effect.map((result) => {
				expect(result.chunks.flatMap((chunk) => chunk.items)).toHaveLength(75);
				expect(result.chunks.flatMap((chunk) => chunk.failures)).toMatchObject([
					{ itemIndex: 55, unit: "measurements", recordKind: "measurements" },
				]);
				expect(result.chunks.flatMap((chunk) => chunk.items).at(-1)?.recordId).toBe(
					'["measurement",75]',
				);
				expect(result.output).toMatchObject({
					summary: [{ unit: "measurements", counts: { created: 75, unsuccessful: 1 } }],
				});
				expect(
					result.requests.filter(
						(request) => request.kind === "activity" && request.name.startsWith("collect:"),
					),
				).toHaveLength(1);
			}),
		),
	));

it("keeps failures of one workout distinct when its only exercise cannot be imported", () =>
	Effect.runPromise(
		runImport(
			"hevy",
			[
				"title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_order,weight_kg,reps,set_type,distance_m,duration_seconds",
				"Push Day,2026-01-01T10:00:00,2026-01-01T11:00:00,,Mystery,,,1,,,normal,,",
			].join("\n"),
		).pipe(
			Effect.map((result) => {
				const failures = result.chunks.flatMap((chunk) => chunk.failures);
				expect(failures.map(({ operationId }) => operationId)).toEqual([
					'["fitness-source",0,"2026-01-01T10:00:00:Push Day:Mystery"]',
					'["fitness-source",0,"2026-01-01T10:00:00:Push Day"]',
				]);
			}),
		),
	));

it("keeps OpenScale failures distinct when rows share a timestamp", () =>
	Effect.runPromise(
		runImport(
			"open_scale",
			["dateTime,Weight", "2026-01-01T08:00:00Z,bad", "2026-01-01T08:00:00Z,bad"].join("\n"),
		).pipe(
			Effect.map((result) => {
				const failures = result.chunks.flatMap((chunk) => chunk.failures);
				expect(failures).toHaveLength(2);
				expect(new Set(failures.map(({ operationId }) => operationId)).size).toBe(2);
			}),
		),
	));

it("rejects an admitted parser pin that does not match the source before collecting", () =>
	Effect.runPromise(
		workflow
			.run(
				{
					command,
					source: "hevy",
					runId: "run-1",
					sourcePayloadHandle: "settings",
					plan: { operation: "import", selection: { "source-parser": "import.open-scale" } },
				},
				makeWorkflowReplayHost([]),
				{ metadata: {}, sandboxScriptId: "fitness-import" },
			)
			.pipe(
				Effect.map((envelope) => {
					expect(envelope).toMatchObject({
						requests: [],
						state: "failed",
						error: expect.stringContaining("plan does not match"),
					});
				}),
			),
	));

it("restores a quoted measurement record across source and JSON capture windows without a full-file read", () => {
	const comment = '🏋️x\n"quoted" '.repeat(40000).trim();
	const csv = `dateTime,Weight,comment\r\n2026-01-01T08:00:00Z,72,"${comment.replaceAll('"', '""')}"\r\n2026-01-02T08:00:00Z,73,end`;
	return Effect.runPromise(
		runImport("open_scale", csv).pipe(
			Effect.map((result) => {
				const items = result.chunks.flatMap((chunk) => chunk.items);
				expect(items.map((item) => item.itemIndex)).toEqual([0, 1]);
				expect(items[0]?.entities[0]?.properties["comment"]).toBe(comment);
				expect(items[1]?.entities[0]?.properties["comment"]).toBe("end");
				expect(result.collectionOffsets.length).toBeGreaterThan(1);
				expect(result.output).toMatchObject({
					summary: [{ unit: "measurements", counts: { created: 2 } }],
				});
			}),
		),
	);
});

it("continues application in a new bounded workflow segment without recollecting measurements", () =>
	Effect.runPromise(
		runImport(
			"open_scale",
			["dateTime,Weight", ...Array.from({ length: 1601 }, () => "2026-01-01T08:00:00Z,72")].join(
				"\n",
			),
		).pipe(
			Effect.map((result) => {
				expect(
					result.requests.filter(
						(request) =>
							request.kind === "child" && request.args.workflowSlug === "import-application",
					),
				).toHaveLength(2);
				const items = result.chunks.flatMap((chunk) => chunk.items);
				expect(items).toHaveLength(1601);
				expect(items.at(-1)?.recordId).toBe('["measurement",1600]');
				expect(new Set(items.map((item) => item.recordId)).size).toBe(1601);
				expect(result.output).toMatchObject({
					summary: [{ unit: "measurements", counts: { created: 1601 } }],
				});
			}),
		),
	));

it("reports a workout above the operation bound while applying an independent workout", () =>
	Effect.runPromise(
		runImport(
			"strong_app",
			[
				"Date,Workout Name,Duration,Exercise Name,Set Order,Weight (kg),Reps",
				...Array.from(
					{ length: 1001 },
					(_, index) => `2026-01-01 08:00:00,Big,3600,Bench Press,${index},100,5`,
				),
				"2026-01-02 08:00:00,Good,3600,Bench Press,0,100,5",
			].join("\n"),
		).pipe(
			Effect.map((result) => {
				expect(result.chunks.flatMap((chunk) => chunk.items).map((item) => item.recordId)).toEqual([
					'["workout",1001]',
				]);
				expect(result.chunks.flatMap((chunk) => chunk.failures)).toMatchObject([
					{ itemIndex: 0, unit: "workouts", recordKind: "workouts", stage: "input_transformation" },
				]);
				expect(result.output).toMatchObject({
					summary: [
						{ unit: "workouts", counts: { created: 1, unsuccessful: 1 } },
						{ unit: "sets", counts: { created: 1 } },
					],
				});
			}),
		),
	));
