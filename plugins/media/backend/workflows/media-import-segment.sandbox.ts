import { defineManifest, defineWorkflow, Effect } from "@ryot-app/sandbox-sdk/workflow";

import { applyMediaSegment } from "../imports/application-segment";
import { MediaApplicationInput, MediaApplicationOutput } from "../imports/process";

export const manifest = defineManifest({
	kind: "workflow",
	capabilities: [],
	name: "Apply captured media batches",
	slug: "workflow.media-import-segment",
});
export default defineWorkflow({
	manifest,
	input: MediaApplicationInput,
	output: MediaApplicationOutput,
	run: (input, replay) =>
		Effect.gen(function* () {
			if (input.integrationScriptSlug !== null) {
				throw new Error("Media source application cannot select an integration adapter");
			}
			return yield* applyMediaSegment(input, replay);
		}),
});
