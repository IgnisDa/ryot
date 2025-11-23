function parseJsonResponse(responseBody) {
	try {
		return JSON.parse(responseBody);
	} catch {
		throw new Error("Anilist returned invalid JSON");
	}
}

function extractGraphQlErrorMessage(payload) {
	if (!Array.isArray(payload?.errors) || payload.errors.length === 0) {
		return null;
	}

	const firstError = payload.errors[0];
	const message = typeof firstError?.message === "string" ? firstError.message.trim() : "";

	return message ?? "unknown GraphQL error";
}

driver("search", async function (context) {
	const { z } = await import("npm:zod");

	const {
		query,
		page: currentPage,
		pageSize,
	} = z
		.object({
			query: z.string().trim().min(1, "query is required"),
			page: z.coerce.number().min(1).transform(Math.floor).catch(1),
			pageSize: z.coerce.number().min(1).max(100).transform(Math.floor).catch(20),
		})
		.parse(context ?? {});

	const graphqlQuery = `
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

	const response = await httpCall("POST", "https://graphql.anilist.co", {
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			query: graphqlQuery,
			variables: {
				search: query,
				page: currentPage,
				perPage: pageSize,
			},
		}),
	});

	if (!response?.success) {
		throw new Error(response?.error ?? "Anilist studio search request failed");
	}

	const payload = parseJsonResponse(response.data.body);

	const graphQlErrorMessage = extractGraphQlErrorMessage(payload);
	if (graphQlErrorMessage) {
		throw new Error(`Anilist studio search GraphQL error: ${graphQlErrorMessage}`);
	}

	const pageData =
		payload?.data?.Page && typeof payload.data.Page === "object" ? payload.data.Page : null;

	if (!pageData) {
		throw new Error("Anilist returned invalid response structure");
	}

	const totalItems =
		typeof pageData?.pageInfo?.total === "number" && Number.isFinite(pageData.pageInfo.total)
			? Math.max(0, Math.trunc(pageData.pageInfo.total))
			: 0;

	const studios = Array.isArray(pageData.studios) ? pageData.studios : [];

	const items = studios
		.map((studio) => {
			if (!studio || typeof studio !== "object") {
				return null;
			}

			const studioId =
				typeof studio.id === "number" && Number.isFinite(studio.id) ? Math.trunc(studio.id) : null;
			if (studioId === null) {
				return null;
			}

			const name =
				typeof studio.name === "string" && studio.name.trim() ? studio.name.trim() : null;
			if (!name) {
				return null;
			}

			return {
				externalId: String(studioId),
				calloutProperty: { kind: "null", value: null },
				titleProperty: { kind: "text", value: name },
				primarySubtitleProperty: { kind: "null", value: null },
				secondarySubtitleProperty: { kind: "null", value: null },
				imageProperty: { kind: "null", value: null },
			};
		})
		.filter((item) => item !== null);

	return {
		items,
		details: {
			totalItems,
			nextPage: currentPage * pageSize < totalItems ? currentPage + 1 : null,
		},
	};
});

driver("details", async function (context) {
	const { z } = await import("npm:zod");

	const { externalId: contextIdentifier } = z
		.object({
			externalId: z.string().trim().min(1, "externalId is required"),
		})
		.parse(context ?? {});

	if (!/^\d+$/.test(contextIdentifier)) {
		throw new Error("externalId must be a numeric Anilist studio id");
	}

	const studioId = Number(contextIdentifier);
	if (!Number.isSafeInteger(studioId) || studioId <= 0) {
		throw new Error("externalId must be a positive safe integer Anilist studio id");
	}

	const graphqlQuery = `
query StudioDetailsQuery($id: Int!) {
  Studio(id: $id) {
    id
    name
    siteUrl
		media(page: 1, perPage: 50) {
			edges {
				node { id type title { userPreferred english romaji native } }
			}
		}
  }
}
`;

	const response = await httpCall("POST", "https://graphql.anilist.co", {
		body: JSON.stringify({ query: graphqlQuery, variables: { id: studioId } }),
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
	});

	if (!response?.success) {
		throw new Error(response?.error ?? "Anilist studio details request failed");
	}

	const payload = parseJsonResponse(response.data.body);

	const graphQlErrorMessage = extractGraphQlErrorMessage(payload);
	if (graphQlErrorMessage) {
		throw new Error(`Anilist studio details GraphQL error: ${graphQlErrorMessage}`);
	}

	const studio =
		payload?.data?.Studio && typeof payload.data.Studio === "object" ? payload.data.Studio : null;

	if (!studio) {
		throw new Error("Anilist returned no studio data");
	}

	const name = typeof studio.name === "string" && studio.name.trim() ? studio.name.trim() : null;
	if (!name) {
		throw new Error("Anilist studio payload is missing name");
	}

	const sourceUrl =
		typeof studio.siteUrl === "string" && studio.siteUrl.trim()
			? studio.siteUrl.trim()
			: `https://anilist.co/studio/${contextIdentifier}`;
	const mediaEntities = (Array.isArray(studio?.media?.edges) ? studio.media.edges : [])
		.map((edge) => {
			const media = edge?.node;
			const mediaId =
				typeof media?.id === "number" && Number.isFinite(media.id)
					? String(Math.trunc(media.id))
					: null;
			const scriptSlug =
				media?.type === "ANIME"
					? "anime.anilist"
					: media?.type === "MANGA"
						? "manga.anilist"
						: null;
			const mediaName =
				typeof media?.title?.userPreferred === "string" && media.title.userPreferred.trim()
					? media.title.userPreferred.trim()
					: typeof media?.title?.english === "string" && media.title.english.trim()
						? media.title.english.trim()
						: typeof media?.title?.romaji === "string" && media.title.romaji.trim()
							? media.title.romaji.trim()
							: "Loading...";
			return {
				scriptSlug,
				name: mediaName,
				externalId: mediaId,
				relationshipProperties: { roles: ["Animation Studio"] },
			};
		})
		.filter((entity) => entity.externalId !== null && entity.scriptSlug !== null);

	return {
		name,
		properties: {sourceUrl,images: [],alternateNames: [],},
		relatedEntityGroups: [
			{
				direction: "outgoing",
				relationshipSchemaSlug: "company-to-anime",
				entities: mediaEntities.filter((entity) => entity.scriptSlug === "anime.anilist"),
			},
			{
				direction: "outgoing",
				relationshipSchemaSlug: "company-to-manga",
				entities: mediaEntities.filter((entity) => entity.scriptSlug === "manga.anilist"),
			},
		],
	};
});
