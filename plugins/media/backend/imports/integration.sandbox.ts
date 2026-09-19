import {
	genericImportActivityReference,
	genericImportSealReference,
	genericImportWorkflowInputSchema,
	genericImportWorkflowResultSchema,
	integrationConfirmationWorkflowInputSchema,
	integrationConfirmationWorkflowResultSchema,
} from "@ryot-app/sandbox-sdk/imports";
import {
	defineManifest,
	defineWorkflow,
	defineWorkflowReference,
	Effect,
	Schema,
	selectExecutable,
} from "@ryot-app/sandbox-sdk/workflow";

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
	capabilities: [],
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
export default defineWorkflow({
	manifest,
	input: Schema.Union([
		genericImportWorkflowInputSchema,
		integrationConfirmationWorkflowInputSchema,
	]),
	output: Schema.Union([
		genericImportWorkflowResultSchema,
		integrationConfirmationWorkflowResultSchema,
	]),
	run: (input, replay) =>
		Effect.gen(function* () {
			if ("ingestionConfirmation" in input) {
				const slug = input.plan.selection["integration-adapter"];
				if (input.plan.operation !== manifest.slug || typeof slug !== "string") {
					throw new Error("Media confirmation plan does not select its admitted adapter");
				}
				const context = yield* Schema.decodeUnknownEffect(
					Schema.Record(Schema.String, Schema.Unknown),
				)(input.integrationContext);
				yield* replay.activity(
					`confirm:${input.ingestionConfirmation.batchId}:${input.ingestionConfirmation.part}`,
					selectExecutable(mediaIntegrations, slug),
					{ ...context, ingestionConfirmation: input.ingestionConfirmation },
				);
				return { confirmed: true as const };
			}
			const admitted = yield* replay.activity("settings", mediaControl, {
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
			const integrationContext = admitted.settings["integrationContext"] ?? {};
			const attribution = { runId: input.runId, command: input.command };
			const state = { ordinal: 64 };
			const runs = mediaSortedRuns(replay, attribution, state);
			const issues: Array<(typeof genericImportWorkflowResultSchema.Type)["issues"][number]> = [];
			let carry: string | null = null;
			let collectionPage = 0;
			for (let segment = 0; ; segment++) {
				const collected: typeof MediaIntegrationCollectionOutput.Type = yield* replay.child(
					`collection:${segment}`,
					collection,
					{
						...attribution,
						carry,
						integrationContext,
						page: collectionPage,
						integrationScriptSlug,
						ordinal: state.ordinal,
					},
				);
				state.ordinal = collected.ordinal;
				collectionPage = collected.page;
				carry = collected.carry;
				if (collected.sourceFailure) {
					issues.push({
						severity: "error",
						attribution: null,
						operationId: null,
						recordKind: "source",
						id: `integration-source-failure:${segment}`,
						reason: { key: null, code: collected.sourceFailure },
					});
				}
				if (collected.run) {
					yield* runs.add(collected.run, `integration-sort-segment-${segment}`);
				}
				if (collected.done) {
					break;
				}
			}
			const run = yield* runs.finish("source-final");
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
							integrationContext,
							integrationScriptSlug,
							ordinal: state.ordinal,
							issueLimit: 1000 - issues.length,
						},
					);
					({ page, batch, offset, dedupKey, itemIndex } = result);
					state.ordinal = result.ordinal;
					appendMediaIssues(issues, result.issues, 1000);
					yield* replay.child(`progress:${segment}`, genericImportActivityReference, {
						...attribution,
						operation: {
							action: "activity",
							activity: {
								wait: null,
								batchId: null,
								parentId: null,
								kind: "writing",
								unit: "batches",
								completed: batch,
								exactTotal: null,
								id: "application",
								lastAdvancedAt: input.command.occurredAt,
								state: result.done ? "completed" : "running",
							},
						},
					});
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
