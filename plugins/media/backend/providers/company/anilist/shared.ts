import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";
import { asArray, asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { mediaFailureMessage } from "../../../lib/error-message";
import { MediaSandboxError } from "../../../lib/failures";
import { numberValue, stringValue, type UnknownRecord } from "../../../lib/records";
import { createRoleAccumulator } from "../../../lib/role-accumulator";
import {
	anilistConnection,
	anilistGraphql,
	type AnilistHost,
	anilistRelatedPage,
	mediaScriptSlug,
	parseAnilistId,
	pickPreferredMediaName,
} from "../../../lib/vendors/anilist";

export const manifest = defineManifest({
	name: "Anilist",
	kind: "provider",
	slug: "company.anilist",
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

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) =>
		anilistGraphql(host, "studio search", STUDIO_SEARCH_QUERY, {
			page: input.page,
			search: input.query,
			perPage: input.pageSize,
		}).pipe(
			Effect.map((data) => {
				const pageData = asRecord(data?.["Page"]);
				if (!pageData) {
					throw new Error("Anilist returned invalid response structure");
				}
				const totalValue = numberValue(asRecord(pageData["pageInfo"])?.["total"]);
				const totalItems = totalValue === null ? 0 : Math.max(0, Math.trunc(totalValue));
				const studios = asArray(pageData["studios"]);
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
					return [{ title: name, externalId: String(Math.trunc(idValue)) }];
				});
				return {
					items,
					details: {
						totalItems,
						nextPage: input.page * input.pageSize < totalItems ? input.page + 1 : null,
					},
				};
			}),
		),
});

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

const getStudioPage = (host: AnilistHost, studioId: number, page: number) =>
	anilistGraphql(host, "studio details", STUDIO_DETAILS_QUERY, { page, id: studioId }).pipe(
		Effect.map((data) => {
			const studio = asRecord(data?.["Studio"]);
			if (!studio) {
				throw new Error("Anilist returned no studio data");
			}
			return studio;
		}),
	);

const studioInventory = (studio: UnknownRecord, page: number) => {
	const media = anilistConnection(studio["media"], "edges");
	const accumulator = createRoleAccumulator();
	for (const edge of media.items) {
		const node = asRecord(asRecord(edge)?.["node"]);
		const id = numberValue(node?.["id"]);
		const providerSlug = mediaScriptSlug(node?.["type"]);
		if (!node || id === null || !Number.isSafeInteger(id) || id <= 0 || !providerSlug) {
			throw new MediaSandboxError({ message: "AniList studio inventory media edge is malformed" });
		}
		accumulator.add({
			providerSlug,
			externalId: String(Math.trunc(id)),
			name: pickPreferredMediaName(node["title"]),
			relationshipProperties: { roles: ["Animation Studio"] },
		});
	}
	return {
		entities: accumulator.entities,
		coverage: media.hasNextPage
			? { status: "more" as const, continuation: { page: page + 1 } }
			: { status: "complete" as const },
	};
};

export const related = defineProvider({
	manifest,
	operation: "related",
	run: (input, host) => {
		if (
			input.direction !== "outgoing" ||
			!["company-to-anime", "company-to-manga"].includes(input.relationshipSchemaSlug)
		) {
			throw new Error("Unsupported AniList studio inventory");
		}
		const page = anilistRelatedPage(input.continuation);
		return getStudioPage(host, parseAnilistId(input.externalId, "studio"), page).pipe(
			Effect.flatMap((studio) =>
				Effect.try({
					try: () => studioInventory(studio, page),
					catch: (error) => new MediaSandboxError({ message: mediaFailureMessage(error) }),
				}).pipe(
					Effect.map((inventory) => ({
						coverage: inventory.coverage,
						entities: inventory.entities.filter(
							(entity) =>
								entity.providerSlug ===
								(input.relationshipSchemaSlug === "company-to-anime"
									? "anime.anilist"
									: "manga.anilist"),
						),
					})),
				),
			),
		);
	},
});

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) => {
		const studioId = parseAnilistId(input.externalId, "studio");
		return getStudioPage(host, studioId, 1).pipe(
			Effect.flatMap((studio) =>
				Effect.try({
					try: () => studioInventory(studio, 1),
					catch: (error) => new MediaSandboxError({ message: mediaFailureMessage(error) }),
				}).pipe(
					Effect.map((inventory) => {
						const name = stringValue(studio["name"]);
						if (!name) {
							throw new Error("Anilist studio payload is missing name");
						}
						const sourceUrl =
							stringValue(studio["siteUrl"]) ?? `https://anilist.co/studio/${input.externalId}`;
						return {
							name,
							properties: { sourceUrl, images: [], alternateNames: [] },
							relatedEntityGroups: [
								{
									coverage: inventory.coverage,
									direction: "outgoing" as const,
									synchronization: "additive" as const,
									relationshipSchemaSlug: "company-to-anime",
									entities: inventory.entities.filter(
										(entity) => entity.providerSlug === "anime.anilist",
									),
								},
								{
									coverage: inventory.coverage,
									direction: "outgoing" as const,
									synchronization: "additive" as const,
									relationshipSchemaSlug: "company-to-manga",
									entities: inventory.entities.filter(
										(entity) => entity.providerSlug === "manga.anilist",
									),
								},
							],
						};
					}),
				),
			),
		);
	},
});
