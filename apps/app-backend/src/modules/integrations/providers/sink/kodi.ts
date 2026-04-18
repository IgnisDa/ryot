import { z } from "zod";

import { buildMovieOrShowImportRef } from "~/modules/imports/sources/shared/provider-refs";

import {
	createProgressResult,
	createSinkFailure,
	emptySinkResult,
	type SinkParser,
} from "./shared";

const kodiPayloadSchema = z.object({
	progress: z.coerce.number(),
	lot: z.enum(["movie", "show"]),
	show_season_number: z.coerce.number().int().optional(),
	show_episode_number: z.coerce.number().int().optional(),
	identifier: z.union([z.string(), z.number().int()]).transform(String),
});

export const parseKodiSink: SinkParser = async (input) => {
	try {
		const payload = kodiPayloadSchema.parse(JSON.parse(input.rawBody));
		const ref = buildMovieOrShowImportRef({
			sourceLabel: payload.identifier,
			entitySchemaSlug: payload.lot,
			providerIds: { tmdb: payload.identifier },
		});
		if (!ref) {
			return Promise.resolve({
				...emptySinkResult(),
				failures: [
					createSinkFailure({
						stage: "input_transformation",
						message: "Kodi webhook payload is missing a TMDB identifier",
					}),
				],
			});
		}

		return createProgressResult({
			entityRef: ref,
			consumedOn: "kodi",
			progressPercent: payload.progress,
			...(payload.lot === "show"
				? { showSeason: payload.show_season_number, showEpisode: payload.show_episode_number }
				: {}),
		});
	} catch {
		return {
			...emptySinkResult(),
			failures: [
				createSinkFailure({
					stage: "input_transformation",
					message: "Could not parse Kodi webhook payload",
				}),
			],
		};
	}
};
