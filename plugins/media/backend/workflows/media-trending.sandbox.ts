import {
	defineManifest,
	defineScriptReference,
	defineWorkflow,
	Effect,
	Schema,
} from "@ryot-app/plugin-backend-sdk/workflow";

import { MediaTrendingProviderOutput, MediaTrendingWorkflowOutput } from "../contracts/workflows";

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

export default defineWorkflow({
	manifest,
	input: Schema.Struct({}),
	output: MediaTrendingWorkflowOutput,
	run: (_input, step) =>
		Effect.gen(function* () {
			let itemCount = 0;
			let providerCount = 0;
			for (const { reference, entitySchemaSlug } of providers) {
				const result = yield* step.activity(`fetch-${entitySchemaSlug}`, reference, {});
				if (result.status === "fetched") {
					itemCount += result.itemCount;
					providerCount += 1;
				}
			}
			return { output: { itemCount, providerCount, synced: providerCount > 0 } };
		}),
});
