import { defineManifest, defineWorkflow, Effect, Schema } from "@ryot-app/sandbox-sdk/workflow";

import {
	MediaMonitoringSweepWorkflowInput,
	MediaMonitoringSweepWorkflowOutput,
	MediaMonitoringTargetsActivityInput,
	MediaMonitoringTargetsActivityOutput,
} from "../contracts/workflows";

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
			let after: string | undefined;
			let batchIndex = 0;
			do {
				const result = yield* replay.activity(`targets-${batchIndex}`, listTargets, {
					limit: BATCH_SIZE,
					...(after ? { after } : {}),
				});
				for (const target of result.items) {
					targets.set(target.entityId, target);
				}
				after = result.nextCursor ?? undefined;
				batchIndex += 1;
			} while (after !== undefined);

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
