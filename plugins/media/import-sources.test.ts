import { assert, expect, it } from "vitest";

import { mediaPlugin } from "./manifest";

const sources = new Map(mediaPlugin.importSources.map((source) => [source.slug, source]));
type MediaImportSource = (typeof mediaPlugin.importSources)[number];

function assertSourceSlug<Slug extends MediaImportSource["slug"]>(
	source: MediaImportSource,
	slug: Slug,
): asserts source is Extract<MediaImportSource, { readonly slug: Slug }> {
	assert(source.slug === slug);
}

const sourceBySlug = <Slug extends MediaImportSource["slug"]>(slug: Slug) => {
	const source = sources.get(slug);
	assert(source);
	assertSourceSlug(source, slug);
	return source;
};

it("declares strict, positioned input schemas and export documentation for every source", () => {
	const docsPages = {
		imdb: "imdb",
		igdb: "igdb",
		plex: "plex",
		trakt: "trakt",
		movary: "movary",
		netflix: "netflix",
		anilist: "anilist",
		grouvee: "grouvee",
		jellyfin: "jellyfin",
		watcharr: "watcharr",
		hardcover: "hardcover",
		goodreads: "goodreads",
		storygraph: "storygraph",
		myanimelist: "myanimelist",
		media_tracker: "mediatracker",
		audiobookshelf: "audiobookshelf",
	} as const;

	expect([...sources.keys()].sort()).toEqual(Object.keys(docsPages).sort());
	for (const source of mediaPlugin.importSources) {
		const docsPage = docsPages[source.slug];
		expect(source.inputSchema.unknownKeys).toBe("strict");
		expect(source.exportHelp).toEqual({
			docsUrl: `https://docs.ryot.io/importing/${docsPage}.html`,
		});
		expect(Object.values(source.inputSchema.fields).every(({ position }) => position != null)).toBe(
			true,
		);
		expect(source).not.toHaveProperty("input");
		expect(source).not.toHaveProperty("lot");
		expect(source).not.toHaveProperty("artifacts");
		expect(source).not.toHaveProperty("allowedFileExtensions");
	}
});

it("declares every upload field with its extensions and required state", () => {
	const uploads = Object.fromEntries(
		mediaPlugin.importSources.flatMap((source) =>
			Object.entries(source.inputSchema.fields).flatMap(([field, property]) =>
				property.type === "string" && property.format?.kind === "upload"
					? [
							[
								`${source.slug}.${field}`,
								{
									minLength: property.validation?.minLength,
									required: property.validation?.required === true,
									extensions: property.format.allowedFileExtensions,
								},
							],
						]
					: [],
			),
		),
	);

	expect(uploads).toEqual({
		"imdb.uploadToken": { minLength: 1, required: true, extensions: ["csv"] },
		"igdb.uploadToken": { minLength: 1, required: true, extensions: ["csv"] },
		"trakt.exportUploadToken": { minLength: 1, required: true, extensions: ["zip"] },
		"movary.historyUploadToken": { minLength: 1, required: true, extensions: ["csv"] },
		"movary.ratingsUploadToken": { minLength: 1, required: true, extensions: ["csv"] },
		"movary.watchlistUploadToken": { minLength: 1, required: true, extensions: ["csv"] },
		"anilist.uploadToken": { minLength: 1, required: true, extensions: ["json"] },
		"grouvee.uploadToken": { minLength: 1, required: true, extensions: ["csv"] },
		"netflix.uploadToken": { minLength: 1, required: true, extensions: ["zip"] },
		"watcharr.uploadToken": { minLength: 1, required: true, extensions: ["json"] },
		"hardcover.uploadToken": { minLength: 1, required: true, extensions: ["csv"] },
		"goodreads.uploadToken": { minLength: 1, required: true, extensions: ["csv"] },
		"storygraph.uploadToken": { minLength: 1, required: true, extensions: ["csv"] },
		"myanimelist.animeUploadToken": { minLength: 1, required: false, extensions: ["gz", "xml"] },
		"myanimelist.mangaUploadToken": { minLength: 1, required: false, extensions: ["gz", "xml"] },
	});
});

it("declares mirrored MyAnimeList upload requirements", () => {
	expect(sourceBySlug("myanimelist").inputSchema.rules).toEqual([
		{
			path: ["animeUploadToken"],
			kind: "validation",
			validation: { required: true },
			when: { path: ["mangaUploadToken"], operator: "not_exists" },
		},
		{
			path: ["mangaUploadToken"],
			kind: "validation",
			validation: { required: true },
			when: { path: ["animeUploadToken"], operator: "not_exists" },
		},
	]);
});

it("declares Trakt modes and hides only fields outside the selected mode", () => {
	const schema = sourceBySlug("trakt").inputSchema;
	expect(schema.fields.mode).toMatchObject({
		type: "enum",
		validation: { required: true },
		choices: {
			kind: "static",
			values: [
				{ value: "export", label: "Export file" },
				{ value: "user", label: "Username" },
				{ value: "list", label: "List" },
			],
		},
	});
	for (const field of ["exportUploadToken", "username", "url", "collection"] as const) {
		expect(schema.fields[field].validation).toMatchObject({ required: true });
	}
	expect(schema.fields.url).toMatchObject({ format: { kind: "url" } });
	expect(schema.rules).toEqual(
		[
			["exportUploadToken", "export"],
			["username", "user"],
			["url", "list"],
			["collection", "list"],
		].map(([field, mode]) => ({
			path: [field],
			kind: "visibility",
			visibility: { hidden: true },
			when: { path: ["mode"], value: mode, operator: "neq" },
		})),
	);
});

it("declares URL and secret metadata for connection sources", () => {
	for (const slug of ["plex", "audiobookshelf", "media_tracker"] as const) {
		const fields = sourceBySlug(slug).inputSchema.fields;
		expect(fields.apiUrl).toMatchObject({
			format: { kind: "url" },
			validation: { required: true },
		});
		expect(fields.apiKey).toMatchObject({ secret: true, validation: { required: true } });
		expect(fields.allowInsecureConnections).toMatchObject({ type: "boolean" });
	}
	const jellyfin = sourceBySlug("jellyfin").inputSchema.fields;
	expect(jellyfin.apiUrl).toMatchObject({
		format: { kind: "url" },
		validation: { required: true },
	});
	expect(jellyfin.username).toMatchObject({ validation: { required: true } });
	expect(jellyfin.password).toMatchObject({ secret: true, validation: { minLength: 1 } });
});
