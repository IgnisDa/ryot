import { defineManifest } from "@ryot/sandbox-sdk";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import {
	getImageUrl,
	getTmdbAccessToken,
	numberValue,
	recordsValue,
	stringValue,
	tmdbGet,
	type TmdbHost,
	type UnknownRecord,
} from "../tmdb-shared";

export const manifest = defineManifest({
	name: "TMDB",
	kind: "provider",
	slug: "company.tmdb",
	providerInformation: { source: "tmdb" },
	capabilities: ["httpCall", "getAppConfigValue"],
	requiredAppConfigKeys: ["providers.tmdbAccessToken"],
});

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	getTmdbAccessToken(host)
		.then((token) =>
			tmdbGet(host, "/search/company", { query: input.query, page: String(input.page) }, token),
		)
		.then((data) => {
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
);

const discoverCompanyResults = (host: TmdbHost, path: string, externalId: string, token: string) =>
	tmdbGet(host, path, { language: "en-US", page: "1", with_companies: externalId }, token).then(
		(firstPage) => {
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
				.reduce<Promise<UnknownRecord[]>>(
					(pages, batch) =>
						pages.then((loaded) =>
							Promise.all(
								batch.map((page) =>
									tmdbGet(
										host,
										path,
										{ language: "en-US", page: String(page), with_companies: externalId },
										token,
									),
								),
							).then((results) => [...loaded, ...results]),
						),
					Promise.resolve([firstPage]),
				)
				.then((pages) => pages.flatMap((page) => recordsValue(page["results"])));
		},
	);

const productionEntities = (
	items: readonly UnknownRecord[],
	options: { readonly nameKey: string; readonly scriptSlug: string },
) =>
	items.flatMap((item) => {
		const id = numberValue(item["id"]);
		if (id === null) {
			return [];
		}
		return [
			{
				scriptSlug: options.scriptSlug,
				externalId: String(Math.trunc(id)),
				relationshipProperties: { roles: ["Production Company"] },
				name: stringValue(item[options.nameKey]) ?? "Loading...",
			},
		];
	});

export const details = defineProviderDriver(manifest, "details", (input, host) => {
	if (!/^\d+$/.test(input.externalId)) {
		throw new Error("externalId must be a numeric TMDB company ID");
	}
	return getTmdbAccessToken(host)
		.then((token) =>
			Promise.all([
				tmdbGet(host, `/company/${input.externalId}`, { language: "en-US" }, token),
				discoverCompanyResults(host, "/discover/movie", input.externalId, token),
				discoverCompanyResults(host, "/discover/tv", input.externalId, token),
			]),
		)
		.then(([companyData, movies, shows]) => {
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
							scriptSlug: "movie.tmdb",
						}),
					},
					{
						direction: "outgoing" as const,
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "company-to-show",
						entities: productionEntities(shows, {
							nameKey: "name",
							scriptSlug: "show.tmdb",
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
						stringValue(companyData["headquarters"]) ?? stringValue(companyData["origin_country"]),
				},
			};
		});
});

export default defineProvider({ manifest, drivers: { search, details } });
