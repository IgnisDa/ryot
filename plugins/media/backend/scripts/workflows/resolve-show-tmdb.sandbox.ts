import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import {
	MediaImportResolutionActivityInput,
	MediaImportResolutionActivityResult,
} from "../../workflows/schemas";
import { resolve } from "../providers/media/show/tmdb";

export const manifest = defineManifest({
	kind: "script",
	requiredSystemConfigKeys: [],
	name: "Resolve imported TMDB show",
	slug: "media-import-resolve.show.tmdb",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["tmdbAccessToken"],
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
