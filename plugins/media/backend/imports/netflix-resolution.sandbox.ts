import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

import {
	chooseBestMetadataLookupTitleMatch,
	type MetadataLookupTitleMatchCandidate,
} from "../lib/title-matching";
import { extractMetadataLookupBaseTitle } from "../lib/title-parsing";
import { manifest as movieManifest, search as movieSearch } from "../providers/movie/tmdb/shared";
import { manifest as showManifest, search as showSearch } from "../providers/show/tmdb/shared";
import { NetflixResolutionInput, NetflixResolutionOutput } from "./schemas";

export const manifest = defineManifest({
	kind: "script",
	name: "Resolve Netflix titles",
	slug: "import.netflix-resolution",
});
export default defineScript({
	manifest,
	input: NetflixResolutionInput,
	output: NetflixResolutionOutput,
	run: (input, host) =>
		Effect.gen(function* () {
			const results: Array<(typeof NetflixResolutionOutput.Type)["results"][number]> = [];
			for (const item of input.items) {
				const query = extractMetadataLookupBaseTitle(item.title);
				let preferredEntitySchemaSlug: "movie" | "show" | undefined;
				if (item.entitySchemaSlug === "show" || item.entitySchemaSlug === "movie") {
					preferredEntitySchemaSlug = item.entitySchemaSlug;
				}
				const lookup = yield* Effect.gen(function* () {
					const movie =
						preferredEntitySchemaSlug === "show"
							? []
							: (yield* movieSearch.run({ query, page: 1, pageSize: 20 }, host)).items;
					const show =
						preferredEntitySchemaSlug === "movie"
							? []
							: (yield* showSearch.run({ query, page: 1, pageSize: 20 }, host)).items;
					const candidates: MetadataLookupTitleMatchCandidate[] = [
						...movie.map((value): MetadataLookupTitleMatchCandidate => ({
							title: value.title,
							entitySchemaSlug: "movie",
							externalId: value.externalId,
							providerSlug: movieManifest.slug,
							publishYear:
								value.metadata?.find(
									(metadataValue): metadataValue is number => typeof metadataValue === "number",
								) ?? null,
						})),
						...show.map((value): MetadataLookupTitleMatchCandidate => ({
							title: value.title,
							entitySchemaSlug: "show",
							externalId: value.externalId,
							providerSlug: showManifest.slug,
							publishYear:
								value.metadata?.find(
									(metadataValue): metadataValue is number => typeof metadataValue === "number",
								) ?? null,
						})),
					];
					return chooseBestMetadataLookupTitleMatch({
						title: item.title,
						results: candidates,
						preferredEntitySchemaSlug,
					});
				}).pipe(Effect.result);
				if (lookup._tag === "Success" && lookup.success) {
					const match = lookup.success;
					results.push({
						index: item.index,
						entityRef: {
							kind: "resolved",
							sourceLabel: match.title,
							externalId: match.externalId,
							providerSlug: match.providerSlug,
							entitySchemaSlug: match.entitySchemaSlug,
						},
					});
				} else {
					results.push({ entityRef: null, index: item.index });
				}
			}
			return { results };
		}),
});
