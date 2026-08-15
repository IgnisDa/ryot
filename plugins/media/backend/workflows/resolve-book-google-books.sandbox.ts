import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import {
	MediaImportResolutionActivityInput,
	MediaImportResolutionActivityResult,
} from "../contracts/workflows";
import { resolve } from "../providers/book/google-books/shared";

export const manifest = defineManifest({
	kind: "script",
	requiredSystemConfigKeys: [],
	name: "Resolve imported Google Books book",
	capabilities: ["httpCall", "getPluginConfig"],
	slug: "media-import-resolve.book.google-books",
	requiredPluginConfigKeys: ["googleBooksApiKey"],
});

export default defineScript({
	manifest,
	input: MediaImportResolutionActivityInput,
	output: MediaImportResolutionActivityResult,
	run: (input, host, execution) =>
		resolve.run(input, host, execution).pipe(
			Effect.map(({ externalId }) => ({ externalId, status: "completed" as const })),
			Effect.catch((error) =>
				Effect.succeed({ message: String(error), status: "failed" as const }),
			),
		),
});
