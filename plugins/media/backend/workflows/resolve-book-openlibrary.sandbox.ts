import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import {
	MediaImportResolutionActivityInput,
	MediaImportResolutionActivityResult,
} from "../contracts/workflows";
import { mediaFailureMessage } from "../lib/error-message";
import { resolve } from "../providers/book/openlibrary/shared";

export const manifest = defineManifest({
	kind: "script",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	name: "Resolve imported OpenLibrary book",
	slug: "media-import-resolve.book.openlibrary",
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
