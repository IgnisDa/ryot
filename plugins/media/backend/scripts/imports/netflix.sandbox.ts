import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { strFromU8, unzipSync } from "@ryot-app/sandbox-sdk/fflate";
import { readNamedArtifact } from "@ryot-app/sandbox-sdk/filesystem";

import { nowIso } from "../../imports/dates";
import { batchMediaImportResult } from "../../imports/helpers";
import { adaptNetflixExports } from "../../imports/netflix";
import { MediaImportAdapterBatch, NetflixImportParserInput } from "../../imports/schemas";
import {
	chooseBestMetadataLookupTitleMatch,
	type MetadataLookupTitleMatchCandidate,
} from "../../shared/title-matching";
import { extractMetadataLookupBaseTitle } from "../../shared/title-parsing";
import { manifest as movieManifest, search as movieSearch } from "../providers/media/movie/tmdb";
import { manifest as showManifest, search as showSearch } from "../providers/media/show/tmdb";

export const manifest = defineManifest({
	kind: "script",
	slug: "import.netflix",
	name: "Parse Netflix import",
	requiredSystemConfigKeys: [],
	requiredPluginConfigKeys: ["tmdbAccessToken"],
	capabilities: ["artifact-read", "httpCall", "getPluginConfig", "getUserPreferences"],
});

const csvEntry = (archive: ReturnType<typeof unzipSync>, baseName: string) => {
	for (const [name, bytes] of Object.entries(archive)) {
		if ((name.split(/[\\/]/).pop() ?? "") === baseName) {
			return strFromU8(bytes);
		}
	}
	return undefined;
};

export default defineScript({
	manifest,
	input: NetflixImportParserInput,
	output: MediaImportAdapterBatch,
	run: (input, host, execution) =>
		Effect.gen(function* () {
			const archive = unzipSync(yield* readNamedArtifact("uploadToken"));
			const myListCsv = csvEntry(archive, "MyList.csv");
			const ratingsCsv = csvEntry(archive, "Ratings.csv");
			const viewingActivityCsv = csvEntry(archive, "ViewingActivity.csv");
			if (!myListCsv || !ratingsCsv || !viewingActivityCsv) {
				throw new Error("Required Netflix CSV files were not found in the archive");
			}
			const result = yield* adaptNetflixExports(
				{
					myListCsv,
					ratingsCsv,
					viewingActivityCsv,
					importedAt: nowIso(),
					profileName: input.profileName,
				},
				({ title, preferredEntitySchemaSlug }) => {
					const query = extractMetadataLookupBaseTitle(title);
					if (!query) {
						return Effect.fail("Metadata not found");
					}
					const movieResults =
						preferredEntitySchemaSlug === "show"
							? Effect.succeed<MetadataLookupTitleMatchCandidate[]>([])
							: movieSearch.run({ query, page: 1, pageSize: 20 }, host, execution).pipe(
									Effect.map(({ items }) =>
										items.map(
											(item): MetadataLookupTitleMatchCandidate => ({
												title: item.title,
												entitySchemaSlug: "movie",
												externalId: item.externalId,
												providerSlug: movieManifest.slug,
												publishYear:
													item.metadata?.find(
														(value): value is number => typeof value === "number",
													) ?? null,
											}),
										),
									),
								);
					const showResults =
						preferredEntitySchemaSlug === "movie"
							? Effect.succeed<MetadataLookupTitleMatchCandidate[]>([])
							: showSearch.run({ query, page: 1, pageSize: 20 }, host, execution).pipe(
									Effect.map(({ items }) =>
										items.map(
											(item): MetadataLookupTitleMatchCandidate => ({
												title: item.title,
												entitySchemaSlug: "show",
												externalId: item.externalId,
												providerSlug: showManifest.slug,
												publishYear:
													item.metadata?.find(
														(value): value is number => typeof value === "number",
													) ?? null,
											}),
										),
									),
								);
					return Effect.all([movieResults, showResults], { concurrency: 2 }).pipe(
						Effect.flatMap((searched) => {
							const results = searched.flat();
							const match = chooseBestMetadataLookupTitleMatch({
								title,
								results,
								preferredEntitySchemaSlug,
							});
							if (!match) {
								if (results.length === 0) {
									return Effect.fail("Metadata not found");
								}
								if (preferredEntitySchemaSlug) {
									return Effect.fail(
										`Title matched only ${preferredEntitySchemaSlug === "movie" ? "show" : "movie"} results`,
									);
								}
								return Effect.fail("Could not match title to a supported movie or show");
							}
							return Effect.succeed({
								matchedTitle: match.title,
								entityRef: {
									sourceLabel: match.title,
									kind: "resolved" as const,
									externalId: match.externalId,
									providerSlug: match.providerSlug,
									entitySchemaSlug: match.entitySchemaSlug,
								},
							});
						}),
						Effect.mapError((error) => (error instanceof Error ? error.message : String(error))),
					);
				},
			);
			return batchMediaImportResult(result, input.start, input.limit);
		}),
});
