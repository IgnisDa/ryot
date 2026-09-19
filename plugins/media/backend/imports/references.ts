import { zipEntrySchema } from "@ryot-app/sandbox-sdk/fflate";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import {
	defineExecutableAlternatives,
	defineScriptReference,
	Schema,
} from "@ryot-app/sandbox-sdk/workflow";

import { MediaSourceInput, MediaSourceResult } from "./collection-schemas";
import { MediaIntegrationArtifactResult } from "./process";

const source = <const Slug extends string>(scriptSlug: Slug) =>
	defineScriptReference({ scriptSlug, input: MediaSourceInput, output: MediaSourceResult });
export const mediaSources = defineExecutableAlternatives({
	stage: "settings",
	id: "source-parser",
	references: {
		imdb: source("import.imdb"),
		igdb: source("import.igdb"),
		plex: source("import.plex"),
		trakt: source("import.trakt"),
		movary: source("import.movary"),
		anilist: source("import.anilist"),
		grouvee: source("import.grouvee"),
		netflix: source("import.netflix"),
		spotify: source("import.spotify"),
		jellyfin: source("import.jellyfin"),
		watcharr: source("import.watcharr"),
		goodreads: source("import.goodreads"),
		hardcover: source("import.hardcover"),
		storygraph: source("import.storygraph"),
		myanimelist: source("import.myanimelist"),
		media_tracker: source("import.media_tracker"),
		"trakt-export": source("import.trakt-export"),
		audiobookshelf: source("import.audiobookshelf"),
	},
});
export const MediaControlInput = Schema.Union([
	Schema.Struct({ artifactHandle: Schema.String, action: Schema.Literal("settings") }),
	Schema.Struct({
		key: Schema.String,
		action: Schema.Literal("directory"),
		after: Schema.NullOr(Schema.Finite),
	}),
]);
export const MediaControlOutput = Schema.Struct({
	next: Schema.NullOr(Schema.Finite),
	entries: Schema.Array(zipEntrySchema),
	settings: Schema.Record(Schema.String, jsonValueSchema),
});
export const mediaControl = defineScriptReference({
	input: MediaControlInput,
	output: MediaControlOutput,
	scriptSlug: "import.control",
});
export const mediaMerge = defineScriptReference({
	input: MediaSourceInput,
	output: MediaSourceResult,
	scriptSlug: "import.merge",
});

const integration = <const Slug extends string>(scriptSlug: Slug) =>
	defineScriptReference({
		scriptSlug,
		input: Schema.Unknown,
		output: MediaIntegrationArtifactResult,
	});
export const mediaIntegrations = defineExecutableAlternatives({
	stage: "settings",
	id: "integration-adapter",
	references: {
		"integration.emby": integration("integration.emby"),
		"integration.kodi": integration("integration.kodi"),
		"integration.komga": integration("integration.komga"),
		"integration.spotify": integration("integration.spotify"),
		"integration.plex-sink": integration("integration.plex-sink"),
		"integration.plex-yank": integration("integration.plex-yank"),
		"integration.jellyfin-sink": integration("integration.jellyfin-sink"),
		"integration.youtube-music": integration("integration.youtube-music"),
		"integration.audiobookshelf": integration("integration.audiobookshelf"),
		"integration.browser-extension": integration("integration.browser-extension"),
	},
});
