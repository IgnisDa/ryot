import { definePlugin } from "@ryot/plugin-kit/manifest";

import { mediaSavedViews } from "./saved-views";
import { mediaEntitySchemas } from "./schemas/entity-schemas";
import { builtinMediaEntitySchemaSlugs } from "./schemas/media-schema-slugs";
import { builtinRelationshipSchemas } from "./schemas/relationship-schemas";
import { mediaSignalSchemas } from "./schemas/signal-schemas";
import { mediaScripts } from "./script-catalog";

const entitySchemas = mediaEntitySchemas();
const relationshipSchemas = builtinRelationshipSchemas();
const eventSlugs = (eventSlug: string) =>
	entitySchemas.flatMap((schema) =>
		schema.eventSchemas.some(({ slug }) => slug === eventSlug)
			? [`${schema.slug}:${eventSlug}`]
			: [],
	);
const creditRelationshipSlugs = relationshipSchemas
	.filter(({ sourceEntitySchemaSlug, targetEntitySchemaSlug }) => {
		const isCreditSource =
			sourceEntitySchemaSlug === "person" || sourceEntitySchemaSlug === "company";
		const isCreditTarget =
			targetEntitySchemaSlug !== null &&
			(targetEntitySchemaSlug.endsWith("-group") ||
				builtinMediaEntitySchemaSlugs.includes(targetEntitySchemaSlug));
		return isCreditSource && isCreditTarget;
	})
	.map(({ slug }) => slug);
const schemaScriptLinks = (
	[
		["show", "show.tmdb"],
		["show", "show.tvdb"],
		["movie", "movie.tvdb"],
		["movie", "movie.tmdb"],
		["music", "music.spotify"],
		["manga", "manga.anilist"],
		["anime", "anime.anilist"],
		["book", "book.hardcover"],
		["book", "book.openlibrary"],
		["book", "book.google-books"],
		["podcast", "podcast.itunes"],
		["music", "music.music-brainz"],
		["anime", "anime.myanimelist"],
		["manga", "manga.myanimelist"],
		["manga", "manga.manga-updates"],
		["music", "music.youtube-music"],
		["video-game", "video-game.igdb"],
		["audiobook", "audiobook.audible"],
		["podcast", "podcast.listennotes"],
		["comic-book", "comic-book.metron"],
		["visual-novel", "visual-novel.vndb"],
		["video-game", "video-game.giant-bomb"],
		["person", "person.tmdb"],
		["person", "person.tvdb"],
		["person", "person.metron"],
		["person", "person.anilist"],
		["person", "person.audible"],
		["person", "person.spotify"],
		["person", "person.hardcover"],
		["person", "person.music-brainz"],
		["person", "person.openlibrary"],
		["person", "person.youtube-music"],
		["person", "person.giant-bomb"],
		["person", "person.manga-updates"],
		["company", "company.igdb"],
		["company", "company.tmdb"],
		["company", "company.tvdb"],
		["company", "company.vndb"],
		["company", "company.anilist"],
		["company", "company.hardcover"],
		["company", "company.giant-bomb"],
		["movie-group", "movie-group.tmdb"],
		["movie-group", "movie-group.tvdb"],
		["book-group", "book-group.hardcover"],
		["music-group", "music-group.spotify"],
		["music-group", "music-group.music-brainz"],
		["music-group", "music-group.youtube-music"],
		["video-game-group", "video-game-group.igdb"],
		["audiobook-group", "audiobook-group.audible"],
		["comic-book-group", "comic-book-group.metron"],
		["video-game-group", "video-game-group.giant-bomb"],
	] as const
).map(([entitySchemaSlug, scriptSlug]) => ({ entitySchemaSlug, scriptSlug }));

export const mediaPlugin = definePlugin({
	metadata: {
		icon: "film",
		name: "Media",
		slug: "media",
		version: "1.0.0",
		accentColor: "#5B7FFF",
		description:
			"Track media across movies, shows, books, comic books, anime, manga, audiobooks, podcasts, video games, and music.",
	},
	scripts: mediaScripts,
	entitySchemas,
	savedViews: mediaSavedViews(),
	signalSchemas: mediaSignalSchemas("media-monitoring"),
	relationshipSchemas,
	bindings: {
		schemaScriptLinks,
		signalAutomations: [],
		entityAutomations: [...builtinMediaEntitySchemaSlugs, "show-episode", "podcast-episode"].map(
			(entitySchemaSlug) => ({
				entitySchemaSlug,
				operation: "update" as const,
				scriptSlug: "automation.media-entity-updated",
			}),
		),
		eventAutomations: [
			...[...eventSlugs("review"), "collection:review"].map((eventSchemaSlug) => ({
				eventSchemaSlug,
				kind: "subscription" as const,
				scriptSlug: "automation.review-created",
			})),
			...eventSlugs("progress").flatMap((eventSchemaSlug) => [
				{
					eventSchemaSlug,
					kind: "subscription" as const,
					scriptSlug: "trigger.auto-complete-on-full-progress",
					metadata: { inheritedProperties: ["consumedOn"] },
				},
				{
					position: 100,
					eventSchemaSlug,
					kind: "policy" as const,
					scriptSlug: "trigger.integration-progress-policy",
				},
			]),
			{
				kind: "subscription",
				eventSchemaSlug: "collection:add-entity-to-collection",
				scriptSlug: "trigger.radarr-push",
			},
			{
				kind: "subscription",
				eventSchemaSlug: "collection:add-entity-to-collection",
				scriptSlug: "trigger.sonarr-push",
			},
			...eventSlugs("complete").map((eventSchemaSlug) => ({
				eventSchemaSlug,
				kind: "subscription" as const,
				scriptSlug: "trigger.jellyfin-push",
			})),
		],
		relationshipAutomations: [
			...[
				"show-to-show-season",
				"show-season-to-show-episode",
				"podcast-to-podcast-episode",
			].flatMap((relationshipSchemaSlug) =>
				(["create", "update", "delete"] as const).map((operation) => ({
					operation,
					relationshipSchemaSlug,
					scriptSlug: "automation.media-relationship-sync",
				})),
			),
			...creditRelationshipSlugs.flatMap((relationshipSchemaSlug) =>
				(["create", "update", "delete"] as const).map((operation) => ({
					operation,
					relationshipSchemaSlug,
					scriptSlug: "automation.media-association",
				})),
			),
		],
	},
});

export default mediaPlugin;
