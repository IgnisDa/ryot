import {
	genericImportKernelInputSchema,
	genericImportWorkflowInputSchema,
	genericImportWorkflowResultSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";

import {
	BATCH_SIZE,
	MediaImportSegmentInput,
	MediaImportSegmentOutput,
	MediaWorkflowError,
	runMediaImportBatch,
} from "./batch";
import type { MediaImportDispatchParserInput } from "./schemas";
import { MediaIntegrationAdapterResult, TraktImportTarget, TraktImportUrl } from "./schemas";

export const manifest = defineManifest({
	kind: "workflow",
	capabilities: [],
	name: "Media import",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "workflow.media-import",
});

const integrationAdapter = (scriptSlug: string) => ({
	scriptSlug,
	input: Schema.Unknown,
	output: MediaIntegrationAdapterResult,
});

const segment = {
	input: MediaImportSegmentInput,
	output: MediaImportSegmentOutput,
	workflowSlug: "media-import-segment",
};

const kernelImport = {
	input: genericImportKernelInputSchema,
	output: genericImportWorkflowResultSchema,
	workflowSlug: "kernel:process-import-chunks",
};

export default defineWorkflow({
	manifest,
	input: genericImportWorkflowInputSchema,
	output: genericImportWorkflowResultSchema,
	run: (input, replay) =>
		Effect.gen(function* () {
			const integrationId = input.sourcePayload?.["integrationId"];
			const integrationScriptSlug = input.sourcePayload?.["integrationScriptSlug"];
			const isIntegration =
				typeof integrationId === "string" && typeof integrationScriptSlug === "string";
			let parserInput: typeof MediaImportDispatchParserInput.Type = { start: 0, limit: BATCH_SIZE };
			if (!isIntegration) {
				if (input.source === "igdb") {
					const collection = input.sourcePayload?.["collection"];
					if (typeof collection !== "string" || !collection.trim()) {
						return yield* Effect.fail(
							new MediaWorkflowError("Import job is missing IGDB collection"),
						);
					}
					parserInput = { ...parserInput, collection: collection.trim() };
				}
				if (input.source === "anilist") {
					const timezone = input.sourcePayload?.["timezone"];
					if (typeof timezone !== "string" || !timezone.trim()) {
						return yield* Effect.fail(
							new MediaWorkflowError("Import job is missing AniList timezone"),
						);
					}
					parserInput = { ...parserInput, timezone: timezone.trim() };
				}
				if (input.source === "netflix") {
					const profileName = input.sourcePayload?.["profileName"];
					if (typeof profileName === "string") {
						parserInput = { ...parserInput, profileName };
					}
				}
				if (input.source === "myanimelist") {
					const hasAnimeFile = typeof input.sourcePayload?.["animeUploadToken"] === "string";
					const hasMangaFile = typeof input.sourcePayload?.["mangaUploadToken"] === "string";
					if (!hasAnimeFile && !hasMangaFile) {
						return yield* Effect.fail(
							new MediaWorkflowError("Import job is missing MyAnimeList export files"),
						);
					}
					parserInput = { ...parserInput, hasAnimeFile, hasMangaFile };
				}
				if (input.source === "trakt") {
					const target = input.sourcePayload ?? {};
					const mode = target["mode"];
					if (!Schema.is(TraktImportTarget)(target)) {
						if (
							mode === "user" &&
							(!Schema.is(Schema.NonEmptyString)(target["username"]) ||
								!String(target["username"]).trim())
						) {
							return yield* Effect.fail(
								new MediaWorkflowError("Import job is missing Trakt username"),
							);
						}
						if (mode === "user") {
							return yield* Effect.fail(
								new MediaWorkflowError("Import job has invalid Trakt user fields"),
							);
						}
						if (mode === "list") {
							if (!Schema.is(TraktImportUrl)(target["url"])) {
								return yield* Effect.fail(
									new MediaWorkflowError("Import job is missing or invalid Trakt list URL"),
								);
							}
							if (
								!Schema.is(Schema.NonEmptyString)(target["collection"]) ||
								!String(target["collection"]).trim()
							) {
								return yield* Effect.fail(
									new MediaWorkflowError("Import job is missing Trakt collection"),
								);
							}
							return yield* Effect.fail(
								new MediaWorkflowError("Import job has invalid Trakt list fields"),
							);
						}
						if (mode === "export") {
							return yield* Effect.fail(
								new MediaWorkflowError("Import job is missing Trakt export ZIP"),
							);
						}
						return yield* Effect.fail(
							new MediaWorkflowError("Import job is missing or invalid Trakt mode"),
						);
					}
					if (target.mode === "user" && !target.username.trim()) {
						return yield* Effect.fail(
							new MediaWorkflowError("Import job is missing Trakt username"),
						);
					}
					if (target.mode === "list" && !target.collection.trim()) {
						return yield* Effect.fail(
							new MediaWorkflowError("Import job is missing Trakt collection"),
						);
					}
					parserInput =
						target.mode === "export"
							? { ...parserInput, mode: "export", hasExportFile: true }
							: {
									...parserInput,
									...target,
									...(target.mode === "user"
										? { username: target.username.trim() }
										: { url: target.url.trim(), collection: target.collection.trim() }),
								};
				}
				if (["plex", "audiobookshelf", "media_tracker"].includes(input.source)) {
					const apiKey = input.sourcePayload?.["apiKey"];
					const apiUrl = input.sourcePayload?.["apiUrl"];
					if (typeof apiKey !== "string" || !apiKey || typeof apiUrl !== "string" || !apiUrl) {
						return yield* Effect.fail(
							new MediaWorkflowError(`Import job is missing ${input.source} credentials`),
						);
					}
					parserInput = {
						...parserInput,
						apiKey,
						apiUrl,
						...(typeof input.sourcePayload["allowInsecureConnections"] === "boolean"
							? { allowInsecureConnections: input.sourcePayload["allowInsecureConnections"] }
							: {}),
					};
				}
				if (input.source === "jellyfin") {
					const apiUrl = input.sourcePayload?.["apiUrl"];
					const username = input.sourcePayload?.["username"];
					if (typeof apiUrl !== "string" || !apiUrl || typeof username !== "string" || !username) {
						return yield* Effect.fail(
							new MediaWorkflowError("Import job is missing Jellyfin connection details"),
						);
					}
					parserInput = {
						...parserInput,
						apiUrl,
						username,
						...(typeof input.sourcePayload["password"] === "string"
							? { password: input.sourcePayload["password"] }
							: {}),
						...(typeof input.sourcePayload["allowInsecureConnections"] === "boolean"
							? { allowInsecureConnections: input.sourcePayload["allowInsecureConnections"] }
							: {}),
					};
				}
			}
			let totalItems = 0;
			let failRun = false;
			let failureCount = 0;
			let writeItemCount = 0;
			const chunkHandles: string[] = [];

			if (typeof integrationScriptSlug === "string" && typeof integrationId === "string") {
				const result = yield* replay.activity(
					"integration-adapter",
					integrationAdapter(integrationScriptSlug),
					input.sourcePayload?.["integrationContext"] ?? {},
				);
				failRun = result.entityGroups.length === 0 && result.failures.length > 0;
				const chunk = yield* runMediaImportBatch(replay, {
					integrationId,
					batchIndex: 0,
					runId: input.runId,
					command: input.command,
					batch: { ...result, totalItems: result.failures.length + result.entityGroups.length },
				});
				chunkHandles.push(...chunk.chunkHandles);
				totalItems += chunk.totalItems;
				failureCount += chunk.failureCount;
				writeItemCount += chunk.writeItemCount;
			} else {
				let start: number | null = 0;
				for (let segmentIndex = 0; start !== null; segmentIndex += 1) {
					const output: typeof MediaImportSegmentOutput.Type = yield* replay.child(
						`segment-${segmentIndex}`,
						segment,
						{
							start,
							parserInput,
							runId: input.runId,
							source: input.source,
							command: input.command,
						},
					);
					chunkHandles.push(...output.chunkHandles);
					totalItems += output.totalItems;
					failureCount += output.failureCount;
					writeItemCount += output.writeItemCount;
					start = output.nextStart;
				}
			}

			return yield* replay.child("write-import", kernelImport, {
				totalItems,
				chunkHandles,
				failureCount,
				writeItemCount,
				runId: input.runId,
				command: input.command,
				...(failRun ? { failRun: true } : {}),
			});
		}),
});
