import {
	defineManifest,
	defineScriptReference,
	defineWorkflow,
	Effect,
	Schema,
} from "@ryot-app/plugin-backend-sdk/workflow";

import {
	MediaTrendingProviderOutput,
	MediaTrendingRankingsInput,
	MediaTrendingRankingsOutput,
	MediaTrendingWorkflowOutput,
} from "../contracts/workflows";

export const manifest = defineManifest({
	kind: "workflow",
	name: "Media trending refresh",
	slug: "workflow.media-trending",
});

const providerReference = <const Slug extends string>(scriptSlug: Slug) =>
	defineScriptReference({
		scriptSlug,
		input: Schema.Struct({}),
		output: MediaTrendingProviderOutput,
	});

const providers = [
	{ entitySchemaSlug: "movie", reference: providerReference("movie.tmdb.trending") },
	{ entitySchemaSlug: "show", reference: providerReference("show.tmdb.trending") },
] as const;

const rankings = defineScriptReference({
	input: MediaTrendingRankingsInput,
	output: MediaTrendingRankingsOutput,
	scriptSlug: "media-trending-rankings",
});

export default defineWorkflow({
	manifest,
	input: Schema.Struct({}),
	output: MediaTrendingWorkflowOutput,
	run: (_input, replay) =>
		Effect.gen(function* () {
			const batches: Array<{ entitySchemaSlug: string; entityIds: readonly string[] }> = [];
			for (const { reference, entitySchemaSlug } of providers) {
				const result = yield* replay.activity(`fetch-${entitySchemaSlug}`, reference, {});
				if (result.status === "fetched") {
					batches.push({ entitySchemaSlug, entityIds: result.entityIds });
				}
			}
			const ranked = yield* replay.activity("rank", rankings, { batches });
			return { synced: ranked.synced, itemCount: ranked.itemCount, providerCount: batches.length };
		}),
});
