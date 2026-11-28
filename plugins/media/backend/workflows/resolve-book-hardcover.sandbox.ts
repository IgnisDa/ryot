import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineActivity, defineManifest } from "@ryot-app/plugin-backend-sdk/workflow";

import {
	MediaImportResolutionActivityInput,
	MediaImportResolutionActivityResult,
} from "../contracts/workflows";
import { mediaFailureMessage } from "../lib/error-message";
import { resolve } from "../providers/book/hardcover/shared";

export const manifest = defineManifest({
	kind: "script",
	activity: true,
	name: "Resolve imported Hardcover book",
	slug: "media-import-resolve.book.hardcover",
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
