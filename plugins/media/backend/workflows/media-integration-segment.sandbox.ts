import {
	defineManifest,
	defineWorkflow,
	Effect,
	Schema,
	selectExecutable,
} from "@ryot-app/sandbox-sdk/workflow";

import { applyMediaSegment } from "../imports/application-segment";
import {
	MediaApplicationInput,
	MediaApplicationOutput,
	MediaIntegrationCollectionInput,
	MediaIntegrationCollectionOutput,
} from "../imports/process";
import { mediaIntegrations } from "../imports/references";
import { collectMediaIntegrationWindows } from "../integrations/collection";

export const manifest = defineManifest({
	kind: "workflow",
	slug: "workflow.media-integration-segment",
	name: "Collect and apply bounded media integration windows",
});
const contextSchema = Schema.Record(Schema.String, Schema.Unknown);
export default defineWorkflow({
	manifest,
	input: Schema.Union([MediaApplicationInput, MediaIntegrationCollectionInput]),
	output: Schema.Union([MediaApplicationOutput, MediaIntegrationCollectionOutput]),
	run: (input, replay) =>
		"carry" in input
			? Effect.gen(() => collectMediaIntegrationWindows(input, replay))
			: Effect.gen(function* () {
					if (!input.integrationScriptSlug) {
						throw new Error("Media integration application is missing its admitted adapter");
					}
					const adapter = selectExecutable(mediaIntegrations, input.integrationScriptSlug);
					const context = yield* Schema.decodeUnknownEffect(contextSchema)(
						input.integrationContext,
					);
					return yield* applyMediaSegment(input, replay, function* (ingestionConfirmation, batch) {
						return yield* replay.activity(
							`confirm:${batch}:${ingestionConfirmation.part}`,
							adapter,
							{ ...context, ingestionConfirmation },
						);
					});
				}),
});
