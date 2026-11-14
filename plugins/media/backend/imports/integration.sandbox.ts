import {
	genericImportActivityReference,
	genericImportSealReference,
	genericImportWorkflowInputSchema,
	genericImportWorkflowResultSchema,
	integrationConfirmationWorkflowInputSchema,
	integrationConfirmationWorkflowResultSchema,
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
	MediaIntegrationCollectionInput,
	MediaIntegrationCollectionOutput,
} from "./process";
import { mediaControl, mediaIntegrations } from "./references";
import { appendMediaIssues } from "./reports";
import { mediaSortedRuns } from "./sorted-runs";

export const manifest = defineManifest({
	kind: "workflow",
	slug: "workflow.media-integration",
	name: "Media integration ingestion",
});
const application = defineWorkflowReference({
	input: MediaApplicationInput,
	output: MediaApplicationOutput,
	workflowSlug: "media-integration-segment",
});
const collection = defineWorkflowReference({
	input: MediaIntegrationCollectionInput,
	output: MediaIntegrationCollectionOutput,
	workflowSlug: "media-integration-collection",
});
const checkpointSchema = Schema.Struct({
	ordinal: Schema.Int,
	segment: Schema.Int,
	collectionPage: Schema.Int,
	run: Schema.NullOr(MediaSortedRun),
	integrationContext: Schema.Unknown,
	carry: Schema.NullOr(Schema.String),
	integrationScriptSlug: Schema.String,
	runs: Schema.Array(Schema.NullOr(MediaSortedRun)),
	application: Schema.NullOr(MediaApplicationOutput),
	issues: genericImportWorkflowResultSchema.fields.issues,
	phase: Schema.Literals(["collection", "application", "seal"]),
});
export default defineWorkflow({
	manifest,
	checkpoint: checkpointSchema,
	input: Schema.Union([
		genericImportWorkflowInputSchema,
		integrationConfirmationWorkflowInputSchema,
	]),
	output: Schema.Union([
		genericImportWorkflowResultSchema,
		integrationConfirmationWorkflowResultSchema,
	]),
	run: (input, step, checkpoint) =>
		Effect.gen(function* () {
			if ("ingestionConfirmation" in input) {
				const slug = input.plan.selection["integration-adapter"];
				if (input.plan.operation !== manifest.slug || typeof slug !== "string") {
					throw new Error("Media confirmation plan does not select its admitted adapter");
				}
				const context = yield* Schema.decodeUnknownEffect(
					Schema.Record(Schema.String, Schema.Unknown),
				)(input.integrationContext);
				yield* step.activity(
					`confirm:${input.ingestionConfirmation.batchId}:${input.ingestionConfirmation.part}`,
					selectExecutable(mediaIntegrations, slug),
					{ ...context, ingestionConfirmation: input.ingestionConfirmation },
				);
				return { confirmed: true as const };
			}
			const saved =
				checkpoint ??
				(yield* Effect.gen(function* () {
					const admitted = yield* step.activity("settings", mediaControl, {
						action: "settings",
						artifactHandle: input.sourcePayloadHandle,
					});
					const integrationScriptSlug = admitted.settings["integrationScriptSlug"];
					if (
						input.plan.operation !== "workflow.media-integration" ||
						typeof integrationScriptSlug !== "string" ||
						input.plan.selection["integration-adapter"] !== integrationScriptSlug
					) {
						throw new Error("Media integration plan does not match its admitted collector");
					}
					const initial: typeof checkpointSchema.Type = {
						runs: [],
						run: null,
						issues: [],
						segment: 0,
						ordinal: 64,
						carry: null,
						collectionPage: 0,
						application: null,
						phase: "collection",
						integrationScriptSlug,
						integrationContext: admitted.settings["integrationContext"] ?? {},
					};
					return initial;
				}));
			const state = { ...saved, runs: [...saved.runs], issues: [...saved.issues] };
			const attribution = { runId: input.runId, command: input.command };
			const runs = mediaSortedRuns(step, attribution, state);
			if (state.phase === "collection") {
				const collected = yield* step.child(`collection:${state.segment}`, collection, {
					...attribution,
					carry: state.carry,
					ordinal: state.ordinal,
					page: state.collectionPage,
					integrationContext: state.integrationContext,
					integrationScriptSlug: state.integrationScriptSlug,
				});
				state.ordinal = collected.ordinal;
				state.collectionPage = collected.page;
				state.carry = collected.carry;
				if (collected.sourceFailure) {
					appendMediaIssues(
						state.issues,
						[
							{
								severity: "error",
								attribution: null,
								operationId: null,
								recordKind: "source",
								id: `integration-source-failure:${state.segment}`,
								reason: { key: null, code: collected.sourceFailure },
							},
						],
						1000,
					);
				}
				if (collected.run) {
					yield* runs.add(collected.run, `integration-sort-segment-${state.segment}`);
				}
				state.segment++;
				if (collected.done) {
					state.run = yield* runs.finish("source-final");
					state.phase = state.run ? "application" : "seal";
					state.segment = 0;
				}
				return yield* step.save(state);
			}
			if (state.phase === "application" && state.run) {
				const previous = state.application;
				const result = yield* step.child(`application:${state.segment}`, application, {
					...attribution,
					run: state.run,
					ordinal: state.ordinal,
					page: previous?.page ?? 0,
					batch: previous?.batch ?? 0,
					offset: previous?.offset ?? 0,
					itemIndex: previous?.itemIndex ?? 0,
					dedupKey: previous?.dedupKey ?? null,
					issueLimit: 1000 - state.issues.length,
					integrationContext: state.integrationContext,
					integrationScriptSlug: state.integrationScriptSlug,
				});
				state.ordinal = result.ordinal;
				appendMediaIssues(state.issues, result.issues, 1000);
				state.application = { ...result, issues: [] };
				yield* step.child(`progress:${state.segment}`, genericImportActivityReference, {
					...attribution,
					operation: {
						action: "activity",
						activity: {
							wait: null,
							batchId: null,
							parentId: null,
							kind: "writing",
							unit: "batches",
							exactTotal: null,
							id: "application",
							completed: result.batch,
							lastAdvancedAt: input.command.occurredAt,
							state: result.done ? "completed" : "running",
						},
					},
				});
				state.segment++;
				if (result.done) {
					state.phase = "seal";
				}
				return yield* step.save(state);
			}
			const sealed = yield* step.child("seal", genericImportSealReference, {
				...attribution,
				operation: { action: "seal" },
			});
			return { issues: state.issues, summary: sealed.summary };
		}),
});
