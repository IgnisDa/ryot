import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";
import { asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { MediaSandboxError } from "../../../lib/failures";
import { normalizePlainDescription } from "../../../lib/plain-description";
import { numberValue, recordsValue, stringValue, type UnknownRecord } from "../../../lib/records";
import { getImageUrl, getTmdbAccessToken, tmdbGet, type TmdbHost } from "../../../lib/vendors/tmdb";

export const manifest = defineManifest({ name: "TMDB", kind: "provider", slug: "company.tmdb" });

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) =>
		getTmdbAccessToken(host).pipe(
			Effect.flatMap((token) =>
				tmdbGet(host, "/search/company", { query: input.query, page: String(input.page) }, token),
			),
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
								title: name,
								externalId: String(Math.trunc(id)),
								...(image === null ? {} : { imageUrl: image }),
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

const TMDB_DISCOVER_MAX_PAGE = 500;
const RELATED_PAGES_PER_RUN = 40;
const RELATED_PAGE_CONCURRENCY = 5;

const productionGroups = {
	"company-to-show": { nameKey: "name", path: "/discover/tv", providerSlug: "show.tmdb" },
	"company-to-movie": { nameKey: "title", path: "/discover/movie", providerSlug: "movie.tmdb" },
} as const;

const discoverPage = (
	host: TmdbHost,
	path: string,
	externalId: string,
	page: number,
	token: string,
) =>
	tmdbGet(host, path, { language: "en-US", page: String(page), with_companies: externalId }, token);

const lastDiscoverPage = (page: UnknownRecord) => {
	const totalPages = numberValue(page["total_pages"]);
	return Math.min(
		totalPages === null ? 1 : Math.max(1, Math.trunc(totalPages)),
		TMDB_DISCOVER_MAX_PAGE,
	);
};

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
				name: stringValue(item[options.nameKey]) ?? "Loading...",
				relationshipProperties: { roles: ["Production Company"] },
			},
		];
	});

const productionGroup = (slug: keyof typeof productionGroups, firstPage: UnknownRecord) => {
	const config = productionGroups[slug];
	const lastPage = lastDiscoverPage(firstPage);
	return {
		relationshipSchemaSlug: slug,
		direction: "outgoing" as const,
		synchronization: "authoritative" as const,
		entities: productionEntities(recordsValue(firstPage["results"]), config),
		...(lastPage > 1 ? { continuation: { page: 2, totalPages: lastPage } } : {}),
	};
};

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) => {
		if (!/^\d+$/.test(input.externalId)) {
			throw new Error("externalId must be a numeric TMDB company ID");
		}
		return getTmdbAccessToken(host).pipe(
			Effect.flatMap((token) =>
				Effect.all(
					[
						tmdbGet(host, `/company/${input.externalId}`, { language: "en-US" }, token),
						discoverPage(
							host,
							productionGroups["company-to-movie"].path,
							input.externalId,
							1,
							token,
						),
						discoverPage(
							host,
							productionGroups["company-to-show"].path,
							input.externalId,
							1,
							token,
						),
					],
					{ concurrency: "unbounded" },
				),
			),
			Effect.map(([companyData, movies, shows]) => {
				const name = stringValue(companyData["name"]);
				if (!name) {
					throw new Error("TMDB returned no name for this company");
				}
				const logo = getImageUrl(companyData["logo_path"]);
				return {
					name,
					relatedEntityGroups: [
						productionGroup("company-to-movie", movies),
						productionGroup("company-to-show", shows),
					],
					properties: {
						alternateNames: [],
						website: stringValue(companyData["homepage"]),
						description: normalizePlainDescription(companyData["description"]),
						sourceUrl: `https://www.themoviedb.org/company/${input.externalId}`,
						images: logo ? [{ url: logo, type: "remote" as const, purpose: "logo" as const }] : [],
						headquarters:
							stringValue(companyData["headquarters"]) ??
							stringValue(companyData["origin_country"]),
					},
				};
			}),
		);
	},
});

const decodeContinuation = (continuation: unknown) => {
	const record = asRecord(continuation);
	const page = record === null ? null : numberValue(record["page"]);
	const totalPages = record === null ? null : numberValue(record["totalPages"]);
	return page !== null && totalPages !== null && Number.isInteger(page) && page >= 2
		? Effect.succeed({ page, totalPages: Math.min(Math.trunc(totalPages), TMDB_DISCOVER_MAX_PAGE) })
		: Effect.fail(new MediaSandboxError({ message: "Invalid TMDB company continuation" }));
};

export const related = defineProvider({
	manifest,
	operation: "related",
	run: (input, host) => {
		if (!/^\d+$/.test(input.externalId)) {
			throw new Error("externalId must be a numeric TMDB company ID");
		}
		const config =
			input.relationshipSchemaSlug === "company-to-movie" ||
			input.relationshipSchemaSlug === "company-to-show"
				? productionGroups[input.relationshipSchemaSlug]
				: null;
		if (config === null) {
			return Effect.fail(
				new MediaSandboxError({
					message: `Unsupported TMDB company relationship: ${input.relationshipSchemaSlug}`,
				}),
			);
		}
		return Effect.all([getTmdbAccessToken(host), decodeContinuation(input.continuation)]).pipe(
			Effect.flatMap(([token, { page, totalPages }]) => {
				const lastPage = Math.min(page + RELATED_PAGES_PER_RUN - 1, totalPages);
				const pageNumbers = Array.from({ length: lastPage - page + 1 }, (_, index) => page + index);
				return Effect.forEach(
					pageNumbers,
					(number) => discoverPage(host, config.path, input.externalId, number, token),
					{ concurrency: RELATED_PAGE_CONCURRENCY },
				).pipe(
					Effect.map((pages) => ({
						continuation: lastPage < totalPages ? { totalPages, page: lastPage + 1 } : null,
						entities: productionEntities(
							pages.flatMap((result) => recordsValue(result["results"])),
							config,
						),
					})),
				);
			}),
		);
	},
});
