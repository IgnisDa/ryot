import {
	defineManifest,
	defineWorkflow,
	defineWorkflowReference,
	Effect,
} from "@ryot-app/sandbox-sdk/workflow";

import { applyMediaSegments } from "../imports/application";
import { MediaApplicationInput, MediaApplicationOutput } from "../imports/process";

export const manifest = defineManifest({
	kind: "workflow",
	name: "Apply media capture segments",
	slug: "workflow.media-import-application",
});
const segment = defineWorkflowReference({
	input: MediaApplicationInput,
	output: MediaApplicationOutput,
	workflowSlug: "media-import-segment",
});
export default defineWorkflow({
	manifest,
	input: MediaApplicationInput,
	output: MediaApplicationOutput,
	run: (input, replay) =>
		Effect.gen(function* () {
			return yield* applyMediaSegments(input, replay, function* (part, current) {
				return yield* replay.child(`segment:${part}`, segment, current);
			});
		}),
});
