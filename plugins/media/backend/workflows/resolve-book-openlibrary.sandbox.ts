import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import {
	MediaImportResolutionActivityInput,
	MediaImportResolutionActivityResult,
} from "../contracts/workflows";
import { resolve } from "../providers/book/openlibrary/shared";

export const manifest = defineManifest({
	kind: "script",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Resolve imported OpenLibrary book",
	slug: "media-import-resolve.book.openlibrary",
});

export default defineScript({
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
