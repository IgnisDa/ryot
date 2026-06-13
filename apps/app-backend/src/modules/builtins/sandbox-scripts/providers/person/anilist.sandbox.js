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

function formatDate(dateObj, dayjs) {
	if (!dateObj || typeof dateObj !== "object") {
		return null;
	}

	const { year, month, day } = dateObj;
	if (
		typeof year !== "number" ||
		!Number.isFinite(year) ||
		typeof month !== "number" ||
		!Number.isFinite(month) ||
		typeof day !== "number" ||
		!Number.isFinite(day)
	) {
		return null;
	}

	const d = dayjs(new Date(Date.UTC(Math.trunc(year), Math.trunc(month) - 1, Math.trunc(day))));
	return d.isValid() ? d.format("YYYY-MM-DD") : null;
}

async function cleanHtmlDescription(html) {
	if (typeof html !== "string" || !html.trim()) {
		return null;
	}
	const { load } = await import("npm:cheerio");
	const $ = load(html);
	$("br").replaceWith("\n");
	return $.root().text().trim() ?? null;
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
query StaffSearchQuery($search: String!, $page: Int!, $perPage: Int!) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total }
    staff(search: $search) {
      id
      name { full }
      image { medium }
      dateOfBirth { year }
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
		throw new Error(response?.error ?? "Anilist person search request failed");
	}

	const payload = parseJsonResponse(response.data.body);

	const graphQlErrorMessage = extractGraphQlErrorMessage(payload);
	if (graphQlErrorMessage) {
		throw new Error(`Anilist person search GraphQL error: ${graphQlErrorMessage}`);
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

	const staffItems = Array.isArray(pageData.staff) ? pageData.staff : [];
	const items = staffItems
		.map((item) => {
			if (!item || typeof item !== "object") {
				return null;
			}

			const staffId =
				typeof item.id === "number" && Number.isFinite(item.id) ? Math.trunc(item.id) : null;
			if (staffId === null || staffId <= 0) {
				return null;
			}

			const name = typeof item?.name?.full === "string" ? item.name.full.trim() : "";

			const image =
				typeof item?.image?.medium === "string" && item.image.medium.trim()
					? item.image.medium.trim()
					: null;

			const birthYear =
				typeof item?.dateOfBirth?.year === "number" && Number.isFinite(item.dateOfBirth.year)
					? Math.trunc(item.dateOfBirth.year)
					: null;

			return {
				externalId: String(staffId),
				calloutProperty: { kind: "null", value: null },
				titleProperty: { kind: "text", value: name },
				primarySubtitleProperty:
					birthYear === null ? { kind: "null", value: null } : { kind: "number", value: birthYear },
				secondarySubtitleProperty: { kind: "null", value: null },
				imageProperty:
					image === null
						? { kind: "null", value: null }
						: { kind: "image", value: { type: "remote", url: image } },
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
	const dayjsModule = await import("npm:dayjs");
	const dayjs = dayjsModule.default;

	const { externalId: contextIdentifier } = z
		.object({
			externalId: z.string().trim().min(1, "externalId is required"),
		})
		.parse(context ?? {});

	if (!/^\d+$/.test(contextIdentifier)) {
		throw new Error("externalId must be a numeric Anilist staff id");
	}

	const staffId = Number(contextIdentifier);
	if (!Number.isSafeInteger(staffId) || staffId <= 0) {
		throw new Error("externalId must be a positive safe integer Anilist staff id");
	}

	const graphqlQuery = `
query StaffQuery($id: Int!) {
  Staff(id: $id) {
    id
    name { full }
    image { large }
    gender
    description
    homeTown
    dateOfBirth { day year month }
    dateOfDeath { day year month }
		characterMedia(page: 1, perPage: 50) {
			edges {
				characters { name { full } }
				node { id type title { userPreferred english romaji native } }
			}
		}
		staffMedia(page: 1, perPage: 50) {
			edges {
				staffRole
				node { id type title { userPreferred english romaji native } }
			}
		}
  }
}
`;

	const response = await httpCall("POST", "https://graphql.anilist.co", {
		body: JSON.stringify({ query: graphqlQuery, variables: { id: staffId } }),
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
	});

	if (!response?.success) {
		throw new Error(response?.error ?? "Anilist person details request failed");
	}

	const payload = parseJsonResponse(response.data.body);

	const graphQlErrorMessage = extractGraphQlErrorMessage(payload);
	if (graphQlErrorMessage) {
		throw new Error(`Anilist person details GraphQL error: ${graphQlErrorMessage}`);
	}

	const staffData =
		payload?.data?.Staff && typeof payload.data.Staff === "object" ? payload.data.Staff : null;

	if (!staffData) {
		throw new Error("Anilist returned no staff data");
	}

	const name = typeof staffData?.name?.full === "string" ? staffData.name.full.trim() : "";
	if (!name) {
		throw new Error("Anilist staff data is missing name");
	}

	const image =
		typeof staffData?.image?.large === "string" && staffData.image.large.trim()
			? staffData.image.large.trim()
			: null;

	const gender =
		typeof staffData.gender === "string" && staffData.gender.trim()
			? staffData.gender.trim()
			: null;

	const birthPlace =
		typeof staffData.homeTown === "string" && staffData.homeTown.trim()
			? staffData.homeTown.trim()
			: null;

	const rawDescription = typeof staffData.description === "string" ? staffData.description : null;
	const description = await cleanHtmlDescription(rawDescription);
	const relatedByKey = new Map();
	const addMedia = (media, role) => {
		const mediaId =
			typeof media?.id === "number" && Number.isFinite(media.id) ? String(Math.trunc(media.id)) : null;
		const scriptSlug =
			media?.type === "ANIME"
				? "anime.anilist"
				: media?.type === "MANGA"
					? "manga.anilist"
					: null;
		if (!mediaId || !scriptSlug) {
			return;
		}
		const mediaName =
			typeof media?.title?.userPreferred === "string" && media.title.userPreferred.trim()
				? media.title.userPreferred.trim()
				: typeof media?.title?.english === "string" && media.title.english.trim()
					? media.title.english.trim()
					: typeof media?.title?.romaji === "string" && media.title.romaji.trim()
						? media.title.romaji.trim()
						: "Loading...";
		const key = `${scriptSlug}:${mediaId}`;
		const existing = relatedByKey.get(key);
		if (existing) {
			if (!existing.relationshipProperties.roles.includes(role)) {
				existing.relationshipProperties.roles.push(role);
			}
			return;
		}
		relatedByKey.set(key, {
			scriptSlug,
			name: mediaName,
			externalId: mediaId,
			relationshipProperties: { roles: [role] },
		});
	};
	const characterEdges = Array.isArray(staffData?.characterMedia?.edges)
		? staffData.characterMedia.edges
		: [];
	for (const edge of characterEdges) {
		const characters = Array.isArray(edge?.characters) ? edge.characters : [];
		const characterNames = characters
			.map((character) =>
				typeof character?.name?.full === "string" && character.name.full.trim()
					? character.name.full.trim()
					: null,
			)
			.filter((character) => character !== null);
		for (const characterName of characterNames.length > 0 ? characterNames : [null]) {
			addMedia(edge?.node, characterName ? `Voicing (${characterName})` : "Voicing");
		}
	}
	const staffEdges = Array.isArray(staffData?.staffMedia?.edges) ? staffData.staffMedia.edges : [];
	for (const edge of staffEdges) {
		const role =
			typeof edge?.staffRole === "string" && edge.staffRole.trim()
				? edge.staffRole.trim()
				: "Production";
		addMedia(edge?.node, role);
	}
	const relatedEntities = [...relatedByKey.values()];

	return {
		name,
		relatedEntityGroups: [
			{
				direction: "outgoing",
				relationshipSchemaSlug: "person-to-anime",
				entities: relatedEntities.filter((entity) => entity.scriptSlug === "anime.anilist"),
			},
			{
				direction: "outgoing",
				relationshipSchemaSlug: "person-to-manga",
				entities: relatedEntities.filter((entity) => entity.scriptSlug === "manga.anilist"),
			},
		],
		properties: {
			gender,
			birthPlace,
			description,
			alternateNames: [],
			sourceUrl: `https://anilist.co/staff/${staffId}`,
			images: image ? [{ type: "remote", url: image }] : [],
			birthDate: formatDate(staffData.dateOfBirth, dayjs),
			deathDate: formatDate(staffData.dateOfDeath, dayjs),
		},
	};
});
