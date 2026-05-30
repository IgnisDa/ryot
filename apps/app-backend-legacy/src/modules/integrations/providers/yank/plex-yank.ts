import { z } from "zod";

import type { ImportEntityRef } from "~/modules/imports/jobs";
import type { MediaImportAdapterResult } from "~/modules/imports/media/import-processor";
import {
	mapWithConcurrency,
	requestSourceJson,
	type SourceJsonRequestInput,
} from "~/modules/imports/runtime/source-api";

const PLEX_CONCURRENCY = 5;

const plexLibrarySchema = z.object({
	key: z.string(),
	type: z.string(),
	title: z.string().optional(),
});

const plexLibrariesResponseSchema = z.object({
	MediaContainer: z.object({
		Directory: z.array(plexLibrarySchema).optional().default([]),
	}),
});

const plexGuidSchema = z.object({
	id: z.string(),
});

const plexItemSchema = z.object({
	title: z.string(),
	type: z.string().optional(),
	Guid: z.array(plexGuidSchema).optional().default([]),
});

const plexLibraryItemsResponseSchema = z.object({
	MediaContainer: z.object({
		Metadata: z.array(plexItemSchema).optional().default([]),
	}),
});

type PlexYankInput = {
	token: string;
	baseUrl: string;
};

type PlexYankAdapterDeps = {
	mapWithConcurrency: typeof mapWithConcurrency;
	requestJson: <T>(input: SourceJsonRequestInput) => Promise<T>;
};

const defaultDeps: PlexYankAdapterDeps = {
	mapWithConcurrency,
	requestJson: requestSourceJson,
};

const extractPlexEntityRef = (item: z.infer<typeof plexItemSchema>): ImportEntityRef | null => {
	const title = item.title;
	const itemType = item.type ?? "";

	for (const guid of item.Guid) {
		const id = guid.id;

		const tmdbMatch = id.match(/^tmdb:\/\/(\d+)/);
		if (tmdbMatch?.[1]) {
			const externalId = tmdbMatch[1];
			if (itemType === "show") {
				return {
					externalId,
					kind: "resolved",
					sourceLabel: title,
					scriptSlug: "show.tmdb",
					entitySchemaSlug: "show",
				};
			}
			return {
				externalId,
				kind: "resolved",
				sourceLabel: title,
				scriptSlug: "movie.tmdb",
				entitySchemaSlug: "movie",
			};
		}

		const imdbMatch = id.match(/^imdb:\/\/(tt\d+)/);
		if (imdbMatch?.[1]) {
			const entitySchemaSlug = itemType === "show" ? "show" : "movie";
			return {
				entitySchemaSlug,
				sourceLabel: title,
				kind: "unresolved",
				identifierType: "imdb_id",
				identifierValue: imdbMatch[1],
			};
		}
	}

	return null;
};

export const fetchPlexYankProgress = (): MediaImportAdapterResult => {
	// PlexYank only contributes owned-library syncs in V2.
	return { failures: [], entityGroups: [] };
};

export const syncPlexYankOwnedItems = async (
	input: PlexYankInput,
	deps: PlexYankAdapterDeps = defaultDeps,
): Promise<Array<{ entityRef: ImportEntityRef; provider: string }>> => {
	const baseUrl = input.baseUrl.replace(/\/$/, "");
	const token = input.token;

	const librariesResp = plexLibrariesResponseSchema.parse(
		await deps.requestJson({
			baseUrl,
			sourceName: "Plex",
			path: "library/sections",
			query: { "X-Plex-Token": token },
			headers: { Accept: "application/json" },
		}),
	);

	const libraries = librariesResp.MediaContainer.Directory.filter(
		(lib) => lib.type === "movie" || lib.type === "show",
	);

	const ownedRefs: Array<{ entityRef: ImportEntityRef; provider: string }> = [];

	const results = await deps.mapWithConcurrency(libraries, PLEX_CONCURRENCY, async (library) => {
		let items: z.infer<typeof plexItemSchema>[];
		try {
			const resp = plexLibraryItemsResponseSchema.parse(
				await deps.requestJson({
					baseUrl,
					sourceName: "Plex",
					query: { "X-Plex-Token": token },
					headers: { Accept: "application/json" },
					path: `library/sections/${library.key}/all`,
				}),
			);
			items = resp.MediaContainer.Metadata;
		} catch {
			return [];
		}

		return items.flatMap((item) => {
			const ref = extractPlexEntityRef({ ...item, type: item.type ?? library.type });
			return ref ? [{ entityRef: ref, provider: "plex_yank" }] : [];
		});
	});

	for (const batch of results) {
		ownedRefs.push(...batch);
	}

	return ownedRefs;
};
