import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import {
	MediaImportResolutionActivityInput,
	MediaImportResolutionActivityResult,
} from "../contracts/workflows";
import { mediaFailureMessage } from "../lib/error-message";
import { resolve } from "../providers/book/hardcover/shared";

export const manifest = defineManifest({
	kind: "script",
	name: "Resolve imported Hardcover book",
	slug: "media-import-resolve.book.hardcover",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["hardcoverApiKey"],
});

export default defineScript({
	manifest,
	input: MediaImportResolutionActivityInput,
	output: MediaImportResolutionActivityResult,
	run: (input, host) =>
		resolve.run(input, host).pipe(
			Effect.map(({ externalId }) => ({ externalId, status: "completed" as const })),
			Effect.catch((error) =>
				Effect.succeed({ status: "failed" as const, message: mediaFailureMessage(error) }),
			),
		),
});
