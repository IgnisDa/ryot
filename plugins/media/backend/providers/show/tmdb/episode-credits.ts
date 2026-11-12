import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import type {
	ProviderRelatedInput,
	ProviderRelatedResult,
} from "@ryot-app/plugin-backend-sdk/provider";

import { mediaFailureMessage } from "../../../lib/error-message";
import { MediaSandboxError } from "../../../lib/failures";
import { collectPeople, tmdbGet, type TmdbHost } from "../../../lib/vendors/tmdb";
import { tmdbShowChildPath } from "./child-path";

export const getTmdbEpisodeCredits = (
	input: ProviderRelatedInput,
	host: TmdbHost,
	language: string,
	token: string,
) =>
	Effect.gen(function* () {
		if (
			input.entitySchemaSlug !== "show-episode" ||
			input.relationshipSchemaSlug !== "person-to-show-episode"
		) {
			return yield* new MediaSandboxError({
				message: "show.tmdb related supports only show episode person credits",
			});
		}
		const path = yield* Effect.try({
			try: () => tmdbShowChildPath(input),
			catch: (error) => new MediaSandboxError({ message: mediaFailureMessage(error) }),
		});
		const credits = yield* tmdbGet(host, `${path}/credits`, { language }, token);
		if (
			!Array.isArray(credits["cast"]) ||
			!Array.isArray(credits["crew"]) ||
			!Array.isArray(credits["guest_stars"])
		) {
			return {
				entities: [],
				coverage: {
					status: "source-limited",
					reason: "TMDB episode credits did not include cast, guest star, and crew arrays",
				},
			} satisfies ProviderRelatedResult;
		}
		return {
			coverage: { status: "complete" },
			entities: collectPeople(credits["cast"], credits["crew"], undefined, {
				guestStars: credits["guest_stars"],
			}),
		} satisfies ProviderRelatedResult;
	});
