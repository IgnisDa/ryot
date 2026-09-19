import {
	genericImportActivityReference,
	genericImportSealReference,
	genericImportWorkflowInputSchema,
	genericImportWorkflowResultSchema,
} from "@ryot-app/sandbox-sdk/imports";
import {
	defineManifest,
	defineWorkflow,
	defineWorkflowReference,
	Effect,
	selectExecutable,
} from "@ryot-app/sandbox-sdk/workflow";

import type { MediaSourceInput } from "./collection-schemas";
import {
	MediaApplicationInput,
	MediaApplicationOutput,
	MediaCollectionInput,
	MediaCollectionOutput,
} from "./process";
import type { MediaControlOutput } from "./references";
import { mediaControl, mediaSources } from "./references";
import { appendMediaIssues } from "./reports";
import { mediaSortedRuns } from "./sorted-runs";
import { classifyTraktExportName } from "./trakt-files";

export const manifest = defineManifest({
	kind: "workflow",
	capabilities: [],
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
export default defineWorkflow({
	manifest,
	input: genericImportWorkflowInputSchema,
	output: genericImportWorkflowResultSchema,
	run: (input, replay) =>
		Effect.gen(function* () {
			const admitted = yield* replay.activity("settings", mediaControl, {
				action: "settings",
				artifactHandle: input.sourcePayloadHandle,
			});
			const settings = admitted.settings;
			const attribution = { runId: input.runId, command: input.command };
			if (input.plan.operation !== "import") {
				throw new Error("Media import plan does not match its workflow");
			}
			const state = { ordinal: 64 };
			const runs = mediaSortedRuns(replay, attribution, state);
			let completed = 0;
			let serial = 0;
			let advancedAt = input.command.occurredAt;
			const activity = (
				id: string,
				kind: "reading" | "preparing" | "writing",
				activityState: "running" | "completed",
				unit: string,
				value: number,
			) =>
				Effect.gen(function* () {
					yield* replay.child(`activity:${id}:${serial++}`, genericImportActivityReference, {
						...attribution,
						operation: {
							action: "activity",
							activity: {
								id,
								kind,
								unit,
								wait: null,
								batchId: null,
								parentId: null,
								completed: value,
								exactTotal: null,
								state: activityState,
								lastAdvancedAt: advancedAt,
							},
						},
					});
				});
			yield* activity("collection", "reading", "running", "records", 0);
			const selected = input.plan.selection["source-parser"];
			const expected =
				input.source === "trakt" && settings["mode"] === "export" ? "trakt-export" : input.source;
			if (selected !== expected) {
				throw new Error("Media import plan does not match its admitted source");
			}
			selectExecutable(mediaSources, selected);
			let sourcePage = 0;
			const collect = (fileIndex: number, entry?: MediaSourceInput["entry"]) =>
				Effect.gen(function* () {
					let offset = 0;
					let header = "";
					let carry: string | null = null;
					let eventOffset = 0;
					for (;;) {
						const result: typeof MediaCollectionOutput.Type = yield* replay.child(
							`collection:${sourcePage}`,
							collection,
							{
								...attribution,
								carry,
								offset,
								header,
								settings,
								fileIndex,
								eventOffset,
								records: null,
								source: expected,
								step: sourcePage,
								action: "collect",
								itemIndex: completed,
								ordinal: state.ordinal,
								prefix: `source-${fileIndex}`,
								importedAt: input.command.occurredAt,
								...(entry ? { entry } : {}),
							},
						);
						completed = result.itemIndex;
						offset = result.offset;
						header = result.header;
						carry = result.carry;
						state.ordinal = result.ordinal;
						advancedAt = result.advancedAt;
						eventOffset = result.eventOffset;
						yield* activity("collection", "reading", "running", "records", completed);
						if (result.run) {
							yield* runs.add(result.run, `source-sort-${sourcePage}`);
						}
						sourcePage = result.step;
						if (result.done) {
							break;
						}
					}
				});
			if (input.source === "spotify" || input.source === "netflix" || expected === "trakt-export") {
				const key = expected === "trakt-export" ? "exportUploadToken" : "uploadToken";
				let after: number | null = null;
				let fileIndex = 0;
				let netflixFiles = 0;
				for (let directory = 0; ; directory++) {
					const page: typeof MediaControlOutput.Type = yield* replay.activity(
						`directory:${directory}`,
						mediaControl,
						{ key, after, action: "directory" },
					);
					for (const entry of page.entries) {
						const name = entry.name.split(/[\\/]/).pop() ?? "";
						let selectedEntry = !!classifyTraktExportName(name);
						if (input.source === "spotify") {
							selectedEntry = /^Streaming_History_(Audio|Video)_[^/]*\.json$/.test(name);
						}
						if (input.source === "netflix") {
							selectedEntry = ["MyList.csv", "Ratings.csv", "ViewingActivity.csv"].includes(name);
						}
						if (selectedEntry) {
							yield* collect(fileIndex++, entry);
							if (input.source === "netflix") {
								netflixFiles |=
									1 << ["MyList.csv", "Ratings.csv", "ViewingActivity.csv"].indexOf(name);
							}
						}
					}
					after = page.next;
					if (after === null) {
						break;
					}
				}
				if (!fileIndex) {
					throw new Error("Import archive contains no recognized source files");
				}
				if (input.source === "netflix" && netflixFiles !== 7) {
					throw new Error("Required Netflix CSV files were not found in the archive");
				}
			} else if (input.source === "movary") {
				for (const fileIndex of [0, 1, 2]) {
					yield* collect(fileIndex);
				}
			} else if (input.source === "myanimelist") {
				if (
					typeof settings["animeUploadToken"] !== "string" &&
					typeof settings["mangaUploadToken"] !== "string"
				) {
					throw new Error("Import job is missing MyAnimeList export files");
				}
				if (typeof settings["animeUploadToken"] === "string") {
					yield* collect(0);
				}
				if (typeof settings["mangaUploadToken"] === "string") {
					yield* collect(1);
				}
			} else {
				yield* collect(0);
			}
			if (["anilist", "media_tracker", "netflix", "spotify", "trakt-export"].includes(expected)) {
				const raw = yield* runs.finish("raw-final");
				let header = "";
				let carry: string | null = null;
				let normalizedItems = 0;
				if (raw) {
					for (let page = 0; page < raw.pages; page++) {
						let offset = 0;
						for (let part = 0; ;) {
							const result: typeof MediaCollectionOutput.Type = yield* replay.child(
								`normalize:${page}:${part}`,
								collection,
								{
									...attribution,
									carry,
									offset,
									header,
									settings,
									step: part,
									fileIndex: page,
									source: expected,
									action: "normalize",
									ordinal: state.ordinal,
									itemIndex: normalizedItems,
									prefix: `normalized-${page}`,
									records: `${raw.prefix}-${page}`,
									importedAt: input.command.occurredAt,
								},
							);
							header = result.header;
							offset = result.offset;
							carry = result.carry;
							state.ordinal = result.ordinal;
							advancedAt = result.advancedAt;
							normalizedItems = result.itemIndex;
							if (result.run) {
								yield* runs.add(result.run, `normalized-sort-${page}-${part}`);
							}
							part = result.step;
							if (result.done) {
								break;
							}
						}
					}
				}
				yield* activity("normalization", "preparing", "completed", "records", normalizedItems);
			}
			yield* activity("collection", "reading", "completed", "records", completed);
			const run = yield* runs.finish("source-final");
			const issues: Array<(typeof genericImportWorkflowResultSchema.Type)["issues"][number]> = [];
			if (run) {
				let page = 0;
				let offset = 0;
				let batch = 0;
				let itemIndex = 0;
				let dedupKey: string | null = null;
				for (let segment = 0; ; segment++) {
					const result: typeof MediaApplicationOutput.Type = yield* replay.child(
						`application:${segment}`,
						application,
						{
							...attribution,
							run,
							page,
							batch,
							offset,
							dedupKey,
							itemIndex,
							ordinal: state.ordinal,
							integrationContext: {},
							integrationScriptSlug: null,
							issueLimit: 1000 - issues.length,
						},
					);
					({ page, batch, offset, dedupKey, itemIndex } = result);
					state.ordinal = result.ordinal;
					appendMediaIssues(issues, result.issues, 1000);
					if (result.done) {
						break;
					}
				}
			}
			const sealed = yield* replay.child("seal", genericImportSealReference, {
				...attribution,
				operation: { action: "seal" },
			});
			return { issues, summary: sealed.summary };
		}),
});
