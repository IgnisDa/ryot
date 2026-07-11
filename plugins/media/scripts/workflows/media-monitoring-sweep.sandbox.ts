import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot/sandbox-sdk/workflow";

import {
	MediaMonitoringSweepWorkflowInput,
	MediaMonitoringSweepWorkflowOutput,
	MediaMonitoringTargetsActivityInput,
	MediaMonitoringTargetsActivityOutput,
} from "../../workflows/schemas";

export const manifest = defineManifest({
	kind: "workflow",
	capabilities: [],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Media monitoring sweep",
	slug: "workflow.media-monitoring-sweep",
});

const BATCH_SIZE = 100;

const listTargets = {
	scriptSlug: "media-monitoring-targets",
	input: MediaMonitoringTargetsActivityInput,
	output: MediaMonitoringTargetsActivityOutput,
};

const providerEntityPopulation = {
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
};

export default defineWorkflow({
	manifest,
	input: MediaMonitoringSweepWorkflowInput,
	output: MediaMonitoringSweepWorkflowOutput,
	run: (_input, replay) =>
		Effect.gen(function* () {
			const targets = new Map<
				string,
				(typeof MediaMonitoringTargetsActivityOutput.Type)["items"][number]
			>();
			let page = 1;
			let hasMore: boolean;
			do {
				const result = yield* replay.activity(`targets-${page}`, listTargets, {
					page,
					limit: BATCH_SIZE,
				});
				for (const target of result.items) {
					targets.set(target.entityId, target);
				}
				hasMore = result.hasMore;
				page += 1;
			} while (hasMore);

			const items = [...targets.values()];
			let batchCount = 0;
			for (let start = 0; start < items.length; start += BATCH_SIZE) {
				const batch = items.slice(start, start + BATCH_SIZE);
				yield* replay.child(`refresh-${batchCount}`, providerEntityPopulation, {
					mode: "refresh",
					items: batch.map(({ externalId, providerId, entitySchemaSlug }) => ({
						externalId,
						providerId,
						entitySchemaSlug,
					})),
				});
				batchCount += 1;
			}
			return { batchCount, targetCount: items.length };
		}),
});
