import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import {
	MediaImportResolutionActivityInput,
	MediaImportResolutionActivityResult,
} from "../contracts/workflows";
import { mediaFailureMessage } from "../lib/error-message";
import { resolve } from "../providers/book/google-books/shared";

export const manifest = defineManifest({
	kind: "script",
	activity: true,
	name: "Resolve imported Google Books book",
	slug: "media-import-resolve.book.google-books",
});

export default defineActivity({
	manifest,
	input: MediaImportResolutionActivityInput,
	output: MediaImportResolutionActivityResult,
	run: (input, host) =>
		resolve.run(input, host).pipe(
			Effect.map(({ externalId }) => ({ externalId, status: "completed" as const })),
			Effect.catch((error) =>
				Effect.succeed({ status: "failed" as const, message: mediaFailureMessage(error) }),
			),
			Effect.map((output) => ({ output })),
		),
});
