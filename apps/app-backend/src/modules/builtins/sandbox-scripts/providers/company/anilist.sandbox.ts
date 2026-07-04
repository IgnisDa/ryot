import { defineManifest } from "@ryot/sandbox-sdk/core";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import {
	type UnknownRecord,
	asRecord,
	numberValue,
	stringValue,
} from "../../script-helpers/records";
import {
	anilistGraphql,
	mediaScriptSlug,
	parseAnilistId,
	pickPreferredMediaName,
	type AnilistHost,
} from "../anilist-shared";

export const manifest = defineManifest({
	name: "Anilist",
	kind: "provider",
	slug: "company.anilist",
	capabilities: ["httpCall"],
	requiredAppConfigKeys: [],
	providerInformation: { source: "anilist" },
});

const STUDIO_SEARCH_QUERY = `
query StudioSearchQuery($search: String!, $page: Int!, $perPage: Int!) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total }
    studios(search: $search) {
      id
      name
    }
  }
}
`;

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	anilistGraphql(host, "studio search", STUDIO_SEARCH_QUERY, {
		search: input.query,
		page: input.page,
		perPage: input.pageSize,
	}).then((data) => {
		const pageData = asRecord(data?.["Page"]);
		if (!pageData) {
			throw new Error("Anilist returned invalid response structure");
		}
		const totalValue = numberValue(asRecord(pageData["pageInfo"])?.["total"]);
		const totalItems = totalValue === null ? 0 : Math.max(0, Math.trunc(totalValue));
		const studios = Array.isArray(pageData["studios"]) ? pageData["studios"] : [];
		const items = studios.flatMap((studio) => {
			const record = asRecord(studio);
			if (!record) {
				return [];
			}
			const idValue = numberValue(record["id"]);
			if (idValue === null) {
				return [];
			}
			const name = stringValue(record["name"]);
			if (!name) {
				return [];
			}
			return [
				{
					externalId: String(Math.trunc(idValue)),
					titleProperty: { kind: "text" as const, value: name },
					imageProperty: { kind: "null" as const, value: null },
					calloutProperty: { kind: "null" as const, value: null },
					primarySubtitleProperty: { kind: "null" as const, value: null },
					secondarySubtitleProperty: { kind: "null" as const, value: null },
				},
			];
		});
		return {
			items,
			details: {
				totalItems,
				nextPage: input.page * input.pageSize < totalItems ? input.page + 1 : null,
			},
		};
	}),
);

const STUDIO_DETAILS_QUERY = `
query StudioDetailsQuery($id: Int!, $page: Int!) {
  Studio(id: $id) {
    id
    name
    siteUrl
    media(page: $page, perPage: 25) {
      pageInfo { hasNextPage }
      edges {
        node { id type title { userPreferred english romaji native } }
      }
    }
  }
}
`;

type StudioPages = { studio: UnknownRecord; mediaEdges: unknown[] };

const getStudioPage = (host: AnilistHost, studioId: number, page: number) =>
	anilistGraphql(host, "studio details", STUDIO_DETAILS_QUERY, { id: studioId, page }).then(
		(data) => {
			const studio = asRecord(data?.["Studio"]);
			if (!studio) {
				throw new Error("Anilist returned no studio data");
			}
			return studio;
		},
	);

const collectStudioPages = (
	host: AnilistHost,
	studioId: number,
	page: number,
	collected: { studio: UnknownRecord | null; mediaEdges: unknown[] },
): Promise<StudioPages> =>
	getStudioPage(host, studioId, page).then((studioPage) => {
		const studio = collected.studio ?? studioPage;
		const media = asRecord(studioPage["media"]);
		const pageEdges = media?.["edges"];
		collected.mediaEdges.push(...(Array.isArray(pageEdges) ? pageEdges : []));
		if (asRecord(media?.["pageInfo"])?.["hasNextPage"] === true) {
			return collectStudioPages(host, studioId, page + 1, { ...collected, studio });
		}
		return { studio, mediaEdges: collected.mediaEdges };
	});

export const details = defineProviderDriver(manifest, "details", (input, host) => {
	const studioId = parseAnilistId(input.externalId, "studio");
	return collectStudioPages(host, studioId, 1, { studio: null, mediaEdges: [] }).then(
		({ studio, mediaEdges }) => {
			const name = stringValue(studio["name"]);
			if (!name) {
				throw new Error("Anilist studio payload is missing name");
			}
			const sourceUrl =
				stringValue(studio["siteUrl"]) ?? `https://anilist.co/studio/${input.externalId}`;
			const mediaEntities = mediaEdges.flatMap((edge) => {
				const media = asRecord(asRecord(edge)?.["node"]);
				const idValue = numberValue(media?.["id"]);
				const scriptSlug = mediaScriptSlug(media?.["type"]);
				if (!media || idValue === null || !scriptSlug) {
					return [];
				}
				return [
					{
						scriptSlug,
						externalId: String(Math.trunc(idValue)),
						name: pickPreferredMediaName(media["title"]),
						relationshipProperties: { roles: ["Animation Studio"] },
					},
				];
			});
			return {
				name,
				properties: { sourceUrl, images: [], alternateNames: [] },
				relatedEntityGroups: [
					{
						direction: "outgoing" as const,
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "company-to-anime",
						entities: mediaEntities.filter((entity) => entity.scriptSlug === "anime.anilist"),
					},
					{
						direction: "outgoing" as const,
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "company-to-manga",
						entities: mediaEntities.filter((entity) => entity.scriptSlug === "manga.anilist"),
					},
				],
			};
		},
	);
});

export default defineProvider({ manifest, drivers: { search, details } });
