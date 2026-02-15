function parseJsonResponse(responseBody) {
	try {
		return JSON.parse(responseBody);
	} catch {
		throw new Error("TMDB returned invalid JSON");
	}
}

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/original";

async function getTmdbAccessToken() {
	const resp = await getAppConfigValue("providers.tmdbAccessToken");
	if (!resp?.success) {
		throw new Error(resp?.error ?? "Failed to retrieve TMDB access token");
	}

	const token = typeof resp.data === "string" ? resp.data.trim() : null;
	if (!token) {
		throw new Error(
			"TMDB access token is not configured. Set MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN in your environment.",
		);
	}

	return token;
}

function getImageUrl(path) {
	if (typeof path !== "string" || !path.trim()) {
		return null;
	}
	return `${TMDB_IMAGE_BASE}${path.trim()}`;
}

async function tmdbGet(path, params, token) {
	const query = new URLSearchParams(params);
	const url = `${TMDB_BASE_URL}${path}?${query.toString()}`;
	const response = await httpCall("GET", url, {
		headers: { Authorization: `Bearer ${token}` },
	});

	if (!response?.success) {
		throw new Error(response?.error ?? `TMDB request failed: ${path}`);
	}

	const payload = parseJsonResponse(response.data.body);

	if (typeof payload?.status_code === "number" && payload.status_code !== 1) {
		throw new Error(payload.status_message ?? `TMDB API error (status ${payload.status_code})`);
	}

	return payload;
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

	const token = await getTmdbAccessToken();
	const data = await tmdbGet(
		"/search/company",
		{
			query,
			page: String(currentPage),
		},
		token,
	);

	const results = Array.isArray(data?.results) ? data.results : [];
	const totalItems =
		typeof data?.total_results === "number" && Number.isFinite(data.total_results)
			? data.total_results
			: results.length;
	const totalPages =
		typeof data?.total_pages === "number" && Number.isFinite(data.total_pages)
			? data.total_pages
			: 1;

	const items = results
		.map((company) => {
			const id =
				typeof company?.id === "number" && Number.isFinite(company.id)
					? String(Math.trunc(company.id))
					: null;
			if (!id) {
				return null;
			}

			const name =
				typeof company?.name === "string" && company.name.trim() ? company.name.trim() : null;
			if (!name) {
				return null;
			}

			const image = getImageUrl(company?.logo_path);

			return {
				externalId: id,
				calloutProperty: { kind: "null", value: null },
				titleProperty: { kind: "text", value: name },
				primarySubtitleProperty: { kind: "null", value: null },
				secondarySubtitleProperty: { kind: "null", value: null },
				imageProperty:
					image === null
						? { kind: "null", value: null }
						: { kind: "image", value: { type: "remote", url: image } },
			};
		})
		.filter((item) => item !== null)
		.slice(0, pageSize);

	return {
		items,
		details: {
			totalItems,
			nextPage: currentPage < totalPages ? currentPage + 1 : null,
		},
	};
});

driver("details", async function (context) {
	const { z } = await import("npm:zod");

	const { externalId } = z
		.object({
			externalId: z.string().trim().min(1, "externalId is required"),
		})
		.parse(context ?? {});

	if (!/^\d+$/.test(externalId)) {
		throw new Error("externalId must be a numeric TMDB company ID");
	}

	const token = await getTmdbAccessToken();

	const [companyData, movieData, showData] = await Promise.all([
		tmdbGet(`/company/${externalId}`, { language: "en-US" }, token),
		tmdbGet(`/company/${externalId}/movies`, { language: "en-US" }, token),
		tmdbGet(`/company/${externalId}/tv`, { language: "en-US" }, token),
	]);

	const name =
		typeof companyData?.name === "string" && companyData.name.trim()
			? companyData.name.trim()
			: null;
	if (!name) {
		throw new Error("TMDB returned no name for this company");
	}

	const images = [];
	const logo = getImageUrl(companyData?.logo_path);
	if (logo) {
		images.push({ type: "remote", url: logo });
	}

	let headquarters = null;
	if (typeof companyData?.headquarters === "string" && companyData.headquarters.trim()) {
		headquarters = companyData.headquarters.trim();
	} else if (typeof companyData?.origin_country === "string" && companyData.origin_country.trim()) {
		headquarters = companyData.origin_country.trim();
	}
	const movieEntities = (Array.isArray(movieData?.results) ? movieData.results : [])
		.map((movie) => {
			const movieId =
				typeof movie?.id === "number" && Number.isFinite(movie.id)
					? String(Math.trunc(movie.id))
					: null;
			const movieName =
				typeof movie?.title === "string" && movie.title.trim() ? movie.title.trim() : null;
			return {
				externalId: movieId,
				scriptSlug: "movie.tmdb",
				name: movieName ?? "Loading...",
				relationshipProperties: { roles: ["Production Company"] },
			};
		})
		.filter((entity) => entity.externalId !== null);
	const showEntities = (Array.isArray(showData?.results) ? showData.results : [])
		.map((show) => {
			const showId =
				typeof show?.id === "number" && Number.isFinite(show.id)
					? String(Math.trunc(show.id))
					: null;
			const showName = typeof show?.name === "string" && show.name.trim() ? show.name.trim() : null;
			return {
				externalId: showId,
				scriptSlug: "show.tmdb",
				name: showName ?? "Loading...",
				relationshipProperties: { roles: ["Production Company"] },
			};
		})
		.filter((entity) => entity.externalId !== null);

	return {
		name,
		relatedEntityGroups: [
			{
				direction: "outgoing",
				entities: movieEntities,
				relationshipSchemaSlug: "company-to-movie",
			},
			{
				direction: "outgoing",
				entities: showEntities,
				relationshipSchemaSlug: "company-to-show",
			},
		],
		properties: {
			images,
			headquarters,
			alternateNames: [],
			sourceUrl: `https://www.themoviedb.org/company/${externalId}`,
			website:
				typeof companyData?.homepage === "string" && companyData.homepage.trim()
					? companyData.homepage.trim()
					: null,
			description:
				typeof companyData?.description === "string" && companyData.description.trim()
					? companyData.description.trim()
					: null,
		},
	};
});
