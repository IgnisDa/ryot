import {
	defineManifest,
	defineScriptReference,
	defineWorkflow,
	defineWorkflowReference,
	Effect,
	Schema,
} from "@ryot-app/plugin-backend-sdk/workflow";

import {
	MediaMonitoringSweepWorkflowInput,
	MediaMonitoringSweepWorkflowOutput,
	MediaMonitoringTargetsActivityInput,
	MediaMonitoringTargetsActivityOutput,
} from "../contracts/workflows";

export const manifest = defineManifest({
	kind: "workflow",
	name: "Media monitoring sweep",
	slug: "workflow.media-monitoring-sweep",
});

const BATCH_SIZE = 100;

const listTargets = defineScriptReference({
	scriptSlug: "media-monitoring-targets",
	input: MediaMonitoringTargetsActivityInput,
	output: MediaMonitoringTargetsActivityOutput,
});

const providerEntityPopulation = defineWorkflowReference({
	output: Schema.Array(Schema.Unknown),
	workflowSlug: "kernel:provider-entity-population",
	input: Schema.Struct({
		mode: Schema.Literal("refresh"),
		items: Schema.Array(
			Schema.Struct({
				externalId: Schema.String,
				providerId: Schema.String,
				entitySchemaSlug: Schema.String,
			}),
		),
	}),
});

export default defineWorkflow({
	manifest,
	input: MediaMonitoringSweepWorkflowInput,
	output: MediaMonitoringSweepWorkflowOutput,
	checkpoint: Schema.Struct({
		after: Schema.String,
		pageIndex: Schema.Int,
		batchIndex: Schema.Int,
		targetCount: Schema.Int,
	}),
	run: (_input, step, checkpoint) =>
		Effect.gen(function* () {
			const after = checkpoint?.after;
			let pageIndex = checkpoint?.pageIndex ?? 0;
			let batchIndex = checkpoint?.batchIndex ?? 0;
			let targetCount = checkpoint?.targetCount ?? 0;
			const result = yield* step.activity(`targets-${pageIndex}`, listTargets, {
				limit: BATCH_SIZE,
				...(after === undefined ? {} : { after }),
			});
			targetCount += result.items.length;
			for (let start = 0; start < result.items.length; start += BATCH_SIZE) {
				const batch = result.items.slice(start, start + BATCH_SIZE);
				yield* step.child(`refresh-${batchIndex}`, providerEntityPopulation, {
					mode: "refresh",
					items: batch.map(({ externalId, providerId, entitySchemaSlug }) => ({
						externalId,
						providerId,
						entitySchemaSlug,
					})),
				});
				batchIndex += 1;
			}
			pageIndex += 1;
			if (result.nextCursor === null || result.nextCursor === "") {
				return { targetCount, batchCount: batchIndex };
			}
			return yield* step.save({ pageIndex, batchIndex, targetCount, after: result.nextCursor });
		}),
});
