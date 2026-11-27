import {
	genericImportActivityReference,
	genericImportSealReference,
	genericImportWorkflowInputSchema,
	genericImportWorkflowResultSchema,
} from "@ryot-app/plugin-backend-sdk/imports";
import {
	defineManifest,
	defineWorkflow,
	defineWorkflowReference,
	Effect,
	Schema,
	selectExecutable,
} from "@ryot-app/plugin-backend-sdk/workflow";

import { MediaSortedRun } from "./collection-schemas";
import {
	MediaApplicationInput,
	MediaApplicationOutput,
	MediaCollectionInput,
	MediaCollectionOutput,
} from "./process";
import { mediaControl, MediaControlOutput, mediaSources } from "./references";
import { mediaSortedRuns } from "./sorted-runs";
import { classifyTraktExportName } from "./trakt-files";

export const manifest = defineManifest({
	kind: "workflow",
	name: "Media import",
	slug: "workflow.media-import",
});
const application = defineWorkflowReference({
	input: MediaApplicationInput,
	output: MediaApplicationOutput,
	workflowSlug: "media-import-application",
});
const collection = defineWorkflowReference({
	input: MediaCollectionInput,
	output: MediaCollectionOutput,
	workflowSlug: "media-import-collection",
});
const checkpointSchema = Schema.Struct({
	serial: Schema.Int,
	offset: Schema.Int,
	ordinal: Schema.Int,
	completed: Schema.Int,
	fileIndex: Schema.Int,
	header: Schema.String,
	sourcePage: Schema.Int,
	eventOffset: Schema.Int,
	netflixFiles: Schema.Int,
	advancedAt: Schema.String,
	normalizePage: Schema.Int,
	normalizePart: Schema.Int,
	normalizedItems: Schema.Int,
	directoryDone: Schema.Boolean,
	files: Schema.Array(Schema.Int),
	raw: Schema.NullOr(MediaSortedRun),
	after: Schema.NullOr(Schema.Finite),
	carry: Schema.NullOr(Schema.String),
	entries: MediaControlOutput.fields.entries,
	settings: MediaControlOutput.fields.settings,
	runs: Schema.Array(Schema.NullOr(MediaSortedRun)),
	phase: Schema.Literals(["collection", "normalization", "application"]),
});
export default defineWorkflow({
	manifest,
	checkpoint: checkpointSchema,
	input: genericImportWorkflowInputSchema,
	output: genericImportWorkflowResultSchema,
	run: (input, step, checkpoint) =>
		Effect.gen(function* () {
			if (input.plan.operation !== "import") {
				throw new Error("Media import plan does not match its workflow");
			}
			const saved =
				checkpoint ??
				(yield* Effect.gen(function* () {
					const admitted = yield* step.activity("settings", mediaControl, {
						action: "settings",
						artifactHandle: input.sourcePayloadHandle,
					});
					let files = [0];
					if (input.source === "movary") {
						files = [0, 1, 2];
					}
					if (input.source === "myanimelist") {
						files = [];
						if (typeof admitted.settings["animeUploadToken"] === "string") {
							files.push(0);
						}
						if (typeof admitted.settings["mangaUploadToken"] === "string") {
							files.push(1);
						}
						if (!files.length) {
							throw new Error("Import job is missing MyAnimeList export files");
						}
					}
					const initial: typeof checkpointSchema.Type = {
						files,
						runs: [],
						serial: 0,
						offset: 0,
						raw: null,
						header: "",
						ordinal: 64,
						entries: [],
						after: null,
						carry: null,
						completed: 0,
						fileIndex: 0,
						sourcePage: 0,
						eventOffset: 0,
						netflixFiles: 0,
						normalizePage: 0,
						normalizePart: 0,
						normalizedItems: 0,
						phase: "collection",
						directoryDone: false,
						settings: admitted.settings,
						advancedAt: input.command.occurredAt,
					};
					return initial;
				}));
			const state = {
				...saved,
				runs: [...saved.runs],
				files: [...saved.files],
				entries: [...saved.entries],
			};
			const settings = state.settings;
			const expected =
				input.source === "trakt" && settings["mode"] === "export" ? "trakt-export" : input.source;
			if (input.plan.selection["source-parser"] !== expected) {
				throw new Error("Media import plan does not match its admitted source");
			}
			selectExecutable(mediaSources, expected);
			const attribution = { runId: input.runId, command: input.command };
			const runs = mediaSortedRuns(step, attribution, state);
			const activity = (
				id: string,
				kind: "reading" | "writing" | "preparing",
				status: "running" | "completed",
				completed: number,
			) =>
				step.child(`activity:${id}:${state.serial++}`, genericImportActivityReference, {
					...attribution,
					operation: {
						action: "activity",
						activity: {
							id,
							kind,
							completed,
							wait: null,
							state: status,
							batchId: null,
							parentId: null,
							unit: "records",
							exactTotal: null,
							lastAdvancedAt: state.advancedAt,
						},
					},
				});
			if (state.phase === "collection") {
				const archive =
					input.source === "spotify" || input.source === "netflix" || expected === "trakt-export";
				if (archive && state.entries.length === 0 && !state.directoryDone) {
					const page = yield* step.activity("directory", mediaControl, {
						after: state.after,
						action: "directory",
						key: expected === "trakt-export" ? "exportUploadToken" : "uploadToken",
					});
					state.entries = page.entries.filter((entry) => {
						const name = entry.name.split(/[\\/]/).pop() ?? "";
						if (input.source === "spotify") {
							return /^Streaming_History_(Audio|Video)_[^/]*\.json$/.test(name);
						}
						if (input.source === "netflix") {
							return ["MyList.csv", "Ratings.csv", "ViewingActivity.csv"].includes(name);
						}
						return !!classifyTraktExportName(name);
					});
					state.after = page.next;
					state.directoryDone = page.next === null;
					return yield* step.save(state);
				}
				const entry = state.entries[0];
				const fileIndex = archive ? state.fileIndex : state.files[0];
				if (archive ? entry !== undefined : fileIndex !== undefined) {
					const result = yield* step.child(`collection:${state.sourcePage}`, collection, {
						...attribution,
						settings,
						records: null,
						source: expected,
						action: "collect",
						carry: state.carry,
						offset: state.offset,
						header: state.header,
						step: state.sourcePage,
						ordinal: state.ordinal,
						fileIndex: fileIndex ?? 0,
						itemIndex: state.completed,
						prefix: `source-${fileIndex}`,
						eventOffset: state.eventOffset,
						importedAt: input.command.occurredAt,
						...(entry ? { entry } : {}),
					});
					state.completed = result.itemIndex;
					state.offset = result.offset;
					state.header = result.header;
					state.carry = result.carry;
					state.eventOffset = result.eventOffset;
					state.ordinal = result.ordinal;
					state.advancedAt = result.advancedAt;
					yield* activity("collection", "reading", "running", state.completed);
					if (result.run) {
						yield* runs.add(result.run, `source-sort-${state.sourcePage}`);
					}
					state.sourcePage = result.step;
					if (result.done) {
						if (entry && input.source === "netflix") {
							const name = entry.name.split(/[\\/]/).pop() ?? "";
							state.netflixFiles |=
								1 << ["MyList.csv", "Ratings.csv", "ViewingActivity.csv"].indexOf(name);
						}
						state.entries.shift();
						state.files.shift();
						state.fileIndex++;
						state.offset = 0;
						state.header = "";
						state.carry = null;
						state.eventOffset = 0;
					}
					return yield* step.save(state);
				}
				if (archive && !state.fileIndex) {
					throw new Error("Import archive contains no recognized source files");
				}
				if (input.source === "netflix" && state.netflixFiles !== 7) {
					throw new Error("Required Netflix CSV files were not found in the archive");
				}
				yield* activity("collection", "reading", "completed", state.completed);
				if (["anilist", "netflix", "spotify", "trakt-export", "media_tracker"].includes(expected)) {
					state.raw = yield* runs.finish("raw-final");
					state.phase = "normalization";
				} else {
					state.phase = "application";
				}
				return yield* step.save(state);
			}
			if (state.phase === "normalization") {
				const raw = state.raw;
				if (raw && state.normalizePage < raw.pages) {
					const page = state.normalizePage;
					const part = state.normalizePart;
					const result = yield* step.child(`normalize:${page}:${part}`, collection, {
						...attribution,
						settings,
						step: part,
						fileIndex: page,
						source: expected,
						carry: state.carry,
						action: "normalize",
						offset: state.offset,
						header: state.header,
						ordinal: state.ordinal,
						prefix: `normalized-${page}`,
						itemIndex: state.normalizedItems,
						records: `${raw.prefix}-${page}`,
						importedAt: input.command.occurredAt,
					});
					state.header = result.header;
					state.offset = result.offset;
					state.carry = result.carry;
					state.ordinal = result.ordinal;
					state.advancedAt = result.advancedAt;
					state.normalizedItems = result.itemIndex;
					if (result.run) {
						yield* runs.add(result.run, `normalized-sort-${page}-${part}`);
					}
					state.normalizePart = result.step;
					if (result.done) {
						state.normalizePage++;
						state.offset = 0;
						state.normalizePart = 0;
					}
					return yield* step.save(state);
				}
				yield* activity("normalization", "preparing", "completed", state.normalizedItems);
				state.phase = "application";
				return yield* step.save(state);
			}
			const run = yield* runs.finish("source-final");
			const applied = run
				? yield* step.child("application", application, {
						...attribution,
						run,
						page: 0,
						batch: 0,
						offset: 0,
						itemIndex: 0,
						dedupKey: null,
						issueLimit: 1000,
						ordinal: state.ordinal,
						integrationContext: {},
						integrationScriptSlug: null,
					})
				: null;
			const sealed = yield* step.child("seal", genericImportSealReference, {
				...attribution,
				operation: { action: "seal" },
			});
			return { summary: sealed.summary, issues: applied?.issues ?? [] };
		}),
});
