import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import {
	type UnknownRecord,
	numberValue,
	recordsValue,
	stringValue,
} from "../../script-helpers/records";
import { getImageUrl, getTmdbAccessToken, tmdbGet, type TmdbHost } from "../tmdb-shared";

export const manifest = defineManifest({
	name: "TMDB",
	kind: "provider",
	slug: "company.tmdb",
	capabilities: ["httpCall", "getPluginConfig"],
	requiredPluginConfigKeys: ["tmdbAccessToken"],
	requiredSystemConfigKeys: [],
});

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) =>
		getTmdbAccessToken(host)
			.pipe(
				Effect.flatMap((token) =>
					tmdbGet(host, "/search/company", { query: input.query, page: String(input.page) }, token),
				),
			)
			.pipe(
				Effect.map((data) => {
					const results = recordsValue(data["results"]);
					const totalItems = numberValue(data["total_results"]) ?? results.length;
					const totalPages = numberValue(data["total_pages"]) ?? 1;
					const items = results
						.flatMap((company) => {
							const id = numberValue(company["id"]);
							const name = stringValue(company["name"]);
							if (id === null || !name) {
								return [];
							}
							const image = getImageUrl(company["logo_path"]);
							return [
								{
									externalId: String(Math.trunc(id)),
									titleProperty: { kind: "text" as const, value: name },
									calloutProperty: { kind: "null" as const, value: null },
									primarySubtitleProperty: { kind: "null" as const, value: null },
									secondarySubtitleProperty: { kind: "null" as const, value: null },
									imageProperty: image
										? { kind: "image" as const, value: { type: "remote" as const, url: image } }
										: { kind: "null" as const, value: null },
								},
							];
						})
						.slice(0, input.pageSize);
					return {
						items,
						details: { totalItems, nextPage: input.page < totalPages ? input.page + 1 : null },
					};
				}),
			),
});

const discoverCompanyResults = (host: TmdbHost, path: string, externalId: string, token: string) =>
	tmdbGet(host, path, { language: "en-US", page: "1", with_companies: externalId }, token).pipe(
		Effect.flatMap((firstPage) => {
			const totalPagesValue = numberValue(firstPage["total_pages"]);
			const totalPages = totalPagesValue === null ? 1 : Math.max(1, Math.trunc(totalPagesValue));
			const pageNumbers = Array.from(
				{ length: Math.max(0, totalPages - 1) },
				(_, index) => index + 2,
			);
			const batches = Array.from({ length: Math.ceil(pageNumbers.length / 5) }, (_, index) =>
				pageNumbers.slice(index * 5, index * 5 + 5),
			);
			return batches
				.reduce<Effect.Effect<UnknownRecord[], unknown>>(
					(pages, batch) =>
						pages.pipe(
							Effect.flatMap((loaded) =>
								Effect.all(
									batch.map((page) =>
										tmdbGet(
											host,
											path,
											{ language: "en-US", page: String(page), with_companies: externalId },
											token,
										),
									),
									{ concurrency: "unbounded" },
								).pipe(Effect.map((results) => [...loaded, ...results])),
							),
						),
					Effect.succeed([firstPage]),
				)
				.pipe(Effect.map((pages) => pages.flatMap((page) => recordsValue(page["results"]))));
		}),
	);

const productionEntities = (
	items: readonly UnknownRecord[],
	options: { readonly nameKey: string; readonly providerSlug: string },
) =>
	items.flatMap((item) => {
		const id = numberValue(item["id"]);
		if (id === null) {
			return [];
		}
		return [
			{
				providerSlug: options.providerSlug,
				externalId: String(Math.trunc(id)),
				relationshipProperties: { roles: ["Production Company"] },
				name: stringValue(item[options.nameKey]) ?? "Loading...",
			},
		];
	});

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) => {
		if (!/^\d+$/.test(input.externalId)) {
			throw new Error("externalId must be a numeric TMDB company ID");
		}
		return getTmdbAccessToken(host)
			.pipe(
				Effect.flatMap((token) =>
					Effect.all(
						[
							tmdbGet(host, `/company/${input.externalId}`, { language: "en-US" }, token),
							discoverCompanyResults(host, "/discover/movie", input.externalId, token),
							discoverCompanyResults(host, "/discover/tv", input.externalId, token),
						],
						{ concurrency: "unbounded" },
					),
				),
			)
			.pipe(
				Effect.map(([companyData, movies, shows]) => {
					const name = stringValue(companyData["name"]);
					if (!name) {
						throw new Error("TMDB returned no name for this company");
					}
					const logo = getImageUrl(companyData["logo_path"]);
					return {
						name,
						relatedEntityGroups: [
							{
								direction: "outgoing" as const,
								synchronization: "authoritative" as const,
								relationshipSchemaSlug: "company-to-movie",
								entities: productionEntities(movies, {
									nameKey: "title",
									providerSlug: "movie.tmdb",
								}),
							},
							{
								direction: "outgoing" as const,
								synchronization: "authoritative" as const,
								relationshipSchemaSlug: "company-to-show",
								entities: productionEntities(shows, {
									nameKey: "name",
									providerSlug: "show.tmdb",
								}),
							},
						],
						properties: {
							alternateNames: [],
							website: stringValue(companyData["homepage"]),
							description: stringValue(companyData["description"]),
							images: logo ? [{ type: "remote" as const, url: logo }] : [],
							sourceUrl: `https://www.themoviedb.org/company/${input.externalId}`,
							headquarters:
								stringValue(companyData["headquarters"]) ??
								stringValue(companyData["origin_country"]),
						},
					};
				}),
			);
	},
});
