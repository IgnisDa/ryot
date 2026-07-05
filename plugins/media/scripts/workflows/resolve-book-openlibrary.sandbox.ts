import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import {
	MediaImportResolutionActivityInput,
	MediaImportResolutionActivityResult,
} from "../../workflows/schemas";
import { resolve } from "../providers/media/book/openlibrary";

export const manifest = defineManifest({
	kind: "activity",
	name: "Resolve imported OpenLibrary book",
	slug: "activity.media-import-resolve.book.openlibrary",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall"],
});

export default defineActivity({
	manifest,
	input: MediaImportResolutionActivityInput,
	output: MediaImportResolutionActivityResult,
	run: (input, host, execution) =>
		resolve.run(input, host, execution).pipe(
			Effect.map(({ externalId }) => ({ status: "completed" as const, externalId })),
			Effect.catchAll((error) =>
				Effect.succeed({ status: "failed" as const, message: String(error) }),
			),
		),
});
