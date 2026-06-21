async function makeFetch(input, init) {
	let url,
		method = "GET",
		headers = {},
		body;
	if (input && typeof input === "object" && typeof input.url === "string") {
		url = input.url;
		method = input.method ?? "GET";
		if (input.headers && typeof input.headers.entries === "function") {
			for (const [k, v] of input.headers.entries()) {
				headers[k] = v;
			}
		}
		try {
			const t = await input.text();
			if (t) {
				body = t;
			}
		} catch {}
	} else {
		url = typeof input === "string" ? input : String(input);
	}
	if (init) {
		if (init.method) {
			method = init.method;
		}
		if (init.headers) {
			if (typeof init.headers.entries === "function") {
				for (const [k, v] of init.headers.entries()) {
					headers[k] = v;
				}
			} else if (Array.isArray(init.headers)) {
				for (const [k, v] of init.headers) {
					headers[k] = v;
				}
			} else if (typeof init.headers === "object") {
				Object.assign(headers, init.headers);
			}
		}
		if (init.body != null) {
			if (typeof init.body === "string") {
				body = init.body;
			} else if (ArrayBuffer.isView(init.body)) {
				body = new TextDecoder().decode(init.body);
			} else if (init.body instanceof ArrayBuffer) {
				body = new TextDecoder().decode(new Uint8Array(init.body));
			} else if (typeof init.body.toString === "function") {
				body = init.body.toString();
			}
		}
	}
	const result = await httpCall(method, url, {
		body,
		headers: Object.keys(headers).length ? headers : undefined,
	});
	if (!result?.success) {
		return new Response(result?.error ?? "Request failed", {
			status: result?.data?.status ?? 500,
		});
	}
	const { body: rb, status, statusText, headers: rh } = result.data;
	return new Response(rb, { status, statusText, headers: rh ?? {} });
}

function getThumbnailUrls(thumbnail) {
	let arr = [];
	if (Array.isArray(thumbnail)) {
		arr = thumbnail;
	} else if (Array.isArray(thumbnail?.contents)) {
		arr = thumbnail.contents;
	}
	return arr
		.filter((t) => t?.url)
		.sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))
		.map((t) => t.url);
}

function getBestThumbnailUrl(thumbnail) {
	return getThumbnailUrls(thumbnail)[0] ?? null;
}

function getYoutubeMusicLanguage(metadata) {
	return metadata?.providerInformation?.canonicalLanguage ?? "en";
}

async function createYoutubeMusicClient(language) {
	const { Innertube } = await import("npm:youtubei.js");
	return Innertube.create({
		fetch: makeFetch,
		generate_session_locally: true,
		...(language ? { lang: language } : {}),
	});
}

function getArtistName(artist) {
	const name = artist?.header?.title?.text ?? artist?.name ?? "";
	return typeof name === "string" ? name.trim() : String(name).trim();
}

driver("search", async function (context) {
	const { z } = await import("npm:zod");
	const { query } = z
		.object({
			query: z.string().trim().min(1, "query is required"),
		})
		.parse(context ?? {});

	const yt = await createYoutubeMusicClient();
	const results = await yt.music.search(query, { type: "artist" });

	const items = [];
	for (const shelf of results.contents ?? []) {
		for (const artist of shelf.contents ?? []) {
			const id = artist.id;
			if (!id) {
				continue;
			}

			const name = artist.name ?? artist.title ?? id;
			const thumb = getBestThumbnailUrl(artist.thumbnail);

			items.push({
				externalId: String(id),
				calloutProperty: { kind: "null", value: null },
				titleProperty: { kind: "text", value: String(name) },
				primarySubtitleProperty: { kind: "null", value: null },
				secondarySubtitleProperty: { kind: "null", value: null },
				imageProperty:
					thumb === null
						? { kind: "null", value: null }
						: { kind: "image", value: { type: "remote", url: thumb } },
			});
		}
	}

	return { items, details: { totalItems: items.length, nextPage: null } };
});

driver("details", async function (context, { metadata }) {
	const { z } = await import("npm:zod");
	const { externalId } = z
		.object({
			externalId: z.string().trim().min(1, "externalId is required"),
		})
		.parse(context ?? {});

	const language = getYoutubeMusicLanguage(metadata);
	const yt = await createYoutubeMusicClient(language);
	const artist = await yt.music.getArtist(externalId);

	const name = getArtistName(artist);
	if (!name) {
		throw new Error("YouTube Music artist is missing name");
	}

	const description = artist.header?.description?.text ?? null;

	const { groupEntities, mediaEntities } = (() => {
		const groupEntities = [];
		const mediaEntities = [];
		const sections = artist?.sections;
		if (!Array.isArray(sections)) {
			return { groupEntities, mediaEntities };
		}

		for (const section of sections) {
			const sectionTitle = String(
				section?.title?.text ?? section?.header?.title?.text ?? section?.title ?? "",
			).toLowerCase();
			const isTrackSection = /song|track|video/.test(sectionTitle);
			for (const item of section?.contents ?? []) {
				const videoId = typeof item?.video_id === "string" && item.video_id ? item.video_id : null;
				const id = videoId ?? (typeof item?.id === "string" && item.id ? item.id : null);
				let title = null;
				if (typeof item?.title === "string" && item.title) {
					title = item.title;
				} else if (typeof item?.name === "string" && item.name) {
					title = item.name;
				}
				if (id && title) {
					const target = videoId || isTrackSection ? mediaEntities : groupEntities;
					target.push({ id, title });
				}
			}
		}

		return {
			mediaEntities: mediaEntities.map((track) => ({
				name: track.title,
				externalId: track.id,
				scriptSlug: "music.youtube-music",
				relationshipProperties: { roles: ["Artist"] },
			})),
			groupEntities: groupEntities.map((album) => ({
				name: album.title,
				externalId: album.id,
			scriptSlug: "music-group.youtube-music",
			relationshipProperties: { roles: ["Artist"] },
			})),
		};
	})();

	return {
		name,
		properties: {
			description,
			alternateNames: [],
			sourceUrl: `https://music.youtube.com/channel/${externalId}`,
			images: getThumbnailUrls(artist.header?.thumbnail).map((url) => ({ type: "remote", url })),
		},
		relatedEntityGroups: [
			{
				direction: "outgoing",
				entities: mediaEntities,
				relationshipSchemaSlug: "person-to-music",
			},
			{
				direction: "outgoing",
				entities: groupEntities,
				relationshipSchemaSlug: "person-to-music-group",
			},
		],
	};
});

driver("translate", async function (context) {
	const { z } = await import("npm:zod");
	const { externalId, language } = z
		.object({
			language: z.string().trim().min(1, "language is required"),
			externalId: z.string().trim().min(1, "externalId is required"),
		})
		.parse(context ?? {});

	const yt = await createYoutubeMusicClient(language);
	const name = getArtistName(await yt.music.getArtist(externalId));
	return name ? { name } : {};
});
