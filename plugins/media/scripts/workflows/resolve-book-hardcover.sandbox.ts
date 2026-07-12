import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import {
	MediaImportResolutionActivityInput,
	MediaImportResolutionActivityResult,
} from "../../workflows/schemas";
import { resolve } from "../providers/media/book/hardcover";

export const manifest = defineManifest({
	kind: "activity",
	name: "Resolve imported Hardcover book",
	slug: "activity.media-import-resolve.book.hardcover",
	capabilities: ["httpCall", "getPluginConfigValue"],
	requiredPluginConfigKeys: ["hardcoverApiKey"],
	requiredSystemConfigKeys: [],
});

export default defineActivity({
	manifest,
	input: MediaImportResolutionActivityInput,
	output: MediaImportResolutionActivityResult,
	run: (input, host, execution) =>
		resolve.run(input, host, execution).pipe(
			Effect.map(({ externalId }) => ({ status: "completed" as const, externalId })),
			Effect.catch((error) =>
				Effect.succeed({ status: "failed" as const, message: String(error) }),
			),
		),
});
