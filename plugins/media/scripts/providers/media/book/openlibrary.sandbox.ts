import dayjs from "@ryot/sandbox-sdk/dayjs";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import {
	type UnknownRecord,
	asRecord,
	numberValue,
	stringValue,
} from "../../../script-helpers/records";
import { createRoleAccumulator } from "../../../script-helpers/role-accumulator";
import { toTitleCase } from "../../../script-helpers/title-case";
import {
	getKeySegment,
	loadOpenLibraryJson,
	type OpenLibraryHost,
	parseDescription,
} from "../../openlibrary-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "OpenLibrary",
	slug: "book.openlibrary",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall"],
	providerInformation: { source: "openlibrary" },
});

const coverImageUrl = (coverId: number) =>
	`https://covers.openlibrary.org/b/id/${coverId}-M.jpg?default=false`;

const parseFlexibleDate = (value: unknown) => {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	for (const format of ["MMM D, YYYY", "YYYY"]) {
		const parsed = dayjs(trimmed, format, true);
		if (parsed.isValid()) {
			return new Date(Date.UTC(parsed.year(), parsed.month(), parsed.date()));
		}
	}
	return null;
};

export const search = defineProviderDriver(manifest, "search", (input, host) => {
	const params = new URLSearchParams({
		q: input.query,
		type: "work",
		limit: String(input.pageSize),
		offset: String((input.page - 1) * input.pageSize),
		fields: "key,title,author_name,cover_i,first_publish_year",
	});
	return loadOpenLibraryJson(
		host,
		`https://openlibrary.org/search.json?${params.toString()}`,
		"OpenLibrary search",
	).pipe(
		Effect.map((payloadValue) => {
			const payload = asRecord(payloadValue);
			const totalItems = numberValue(payload?.["num_found"]) ?? 0;
			const docs = payload?.["docs"];
			const items = (Array.isArray(docs) ? docs : []).flatMap((doc) => {
				const record = asRecord(doc);
				const externalId = getKeySegment(record?.["key"]);
				const title = stringValue(record?.["title"]);
				if (!externalId || !title) {
					return [];
				}
				const publishYearValue = numberValue(record?.["first_publish_year"]);
				const publishYear = publishYearValue === null ? null : Math.trunc(publishYearValue);
				const coverId = numberValue(record?.["cover_i"]);
				return [
					{
						externalId,
						calloutProperty: { kind: "null" as const, value: null },
						titleProperty: { kind: "text" as const, value: title },
						secondarySubtitleProperty: { kind: "null" as const, value: null },
						primarySubtitleProperty:
							publishYear === null
								? { kind: "null" as const, value: null }
								: { kind: "number" as const, value: publishYear },
						imageProperty:
							coverId === null
								? { kind: "null" as const, value: null }
								: {
										kind: "image" as const,
										value: { type: "remote" as const, url: coverImageUrl(coverId) },
									},
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
});

const loadAuthorName = (host: OpenLibraryHost, cache: Map<string, string>, authorKey: unknown) => {
	const authorIdentifier = getKeySegment(authorKey);
	if (!authorIdentifier) {
		return Effect.succeed("Loading...");
	}
	const cached = cache.get(authorIdentifier);
	if (cached !== undefined) {
		return Effect.succeed(cached);
	}
	return loadOpenLibraryJson(
		host,
		`https://openlibrary.org/authors/${authorIdentifier}.json`,
		"OpenLibrary author",
	).pipe(
		Effect.map((payload) => stringValue(asRecord(payload)?.["name"]) ?? "Loading..."),
		Effect.catchAll(() => Effect.succeed("Loading...")),
		Effect.map((name) => {
			cache.set(authorIdentifier, name);
			return name;
		}),
	);
};

const authorKeyOf = (record: UnknownRecord, nestedAuthor: UnknownRecord | null) => {
	if (typeof record["key"] === "string") {
		return record["key"];
	}
	if (typeof nestedAuthor?.["key"] === "string") {
		return nestedAuthor["key"];
	}
	return "";
};

const collectAuthors = (host: OpenLibraryHost, workPayload: UnknownRecord | null) => {
	const accumulator = createRoleAccumulator();
	const authorNameCache = new Map<string, string>();
	const authors = workPayload?.["authors"];
	return (Array.isArray(authors) ? authors : [])
		.reduce<Effect.Effect<unknown, unknown>>((chain, authorEntry) => {
			const record = asRecord(authorEntry);
			if (!record) {
				return chain;
			}
			const nestedAuthor = asRecord(record["author"]);
			const authorKey = authorKeyOf(record, nestedAuthor);
			const personIdentifier = getKeySegment(authorKey);
			if (!personIdentifier) {
				return chain;
			}
			const inlineName = stringValue(nestedAuthor?.["name"]) ?? stringValue(record["name"]) ?? "";
			return chain.pipe(
				Effect.flatMap(() =>
					inlineName
						? Effect.succeed(inlineName)
						: loadAuthorName(host, authorNameCache, authorKey),
				),
				Effect.map((authorName) => {
					accumulator.add({
						name: authorName,
						externalId: personIdentifier,
						scriptSlug: "person.openlibrary",
						relationshipProperties: { roles: ["Author"] },
					});
					return authorName;
				}),
			);
		}, Effect.void)
		.pipe(Effect.map(() => accumulator.entities));
};

export const details = defineProviderDriver(manifest, "details", (input, host) => {
	const requestedIdentifier = getKeySegment(input.externalId);
	if (!requestedIdentifier) {
		return Effect.fail(new Error("externalId is required"));
	}
	return Effect.gen(function* () {
		const workValue = yield* loadOpenLibraryJson(
			host,
			`https://openlibrary.org/works/${requestedIdentifier}.json`,
			"OpenLibrary work",
		);
		const editionsValue = yield* loadOpenLibraryJson(
			host,
			`https://openlibrary.org/works/${requestedIdentifier}/editions.json`,
			"OpenLibrary editions",
		).pipe(Effect.catchAll(() => Effect.succeed(null)));
		const workPayload = asRecord(workValue);
		const title = typeof workPayload?.["title"] === "string" ? workPayload["title"] : "";
		if (!title) {
			return yield* Effect.fail(new Error("OpenLibrary work payload is missing title"));
		}
		const externalId = getKeySegment(workPayload?.["key"]) || requestedIdentifier;

		const entries = asRecord(editionsValue)?.["entries"];
		const editions = Array.isArray(entries) ? entries : [];

		let pages: number | null = null;
		let earliestDate: Date | null = null;
		const coverIdSet = new Set<number>();
		const addCoverId = (value: unknown) => {
			const numeric = numberValue(value);
			if (numeric === null) {
				return;
			}
			const integer = Math.trunc(numeric);
			if (integer > 0) {
				coverIdSet.add(integer);
			}
		};

		if (Array.isArray(workPayload?.["covers"])) {
			for (const coverId of workPayload["covers"]) {
				addCoverId(coverId);
			}
		}

		for (const entry of editions) {
			const record = asRecord(entry);
			const numberOfPages = numberValue(record?.["number_of_pages"]);
			if (numberOfPages !== null) {
				const truncated = Math.trunc(numberOfPages);
				if (truncated >= 0 && (pages === null || truncated > pages)) {
					pages = truncated;
				}
			}
			const parsedDate = parseFlexibleDate(record?.["publish_date"]);
			if (parsedDate && (earliestDate === null || parsedDate < earliestDate)) {
				earliestDate = parsedDate;
			}
			if (Array.isArray(record?.["covers"])) {
				for (const coverId of record["covers"]) {
					addCoverId(coverId);
				}
			}
		}

		const publishYear = earliestDate ? earliestDate.getUTCFullYear() : null;

		const genreSet = new Set<string>();
		const subjects = workPayload?.["subjects"];
		for (const subject of Array.isArray(subjects) ? subjects : []) {
			if (typeof subject !== "string") {
				continue;
			}
			for (const token of subject.split(", ")) {
				const titleToken = toTitleCase(token.trim());
				if (titleToken) {
					genreSet.add(titleToken);
				}
			}
		}

		const entities = yield* collectAuthors(host, workPayload);
		return {
			name: title,
			relatedEntityGroups: [
				{
					entities,
					direction: "incoming" as const,
					relationshipSchemaSlug: "person-to-book",
					synchronization: "authoritative" as const,
				},
			],
			properties: {
				pages,
				publishYear,
				genres: [...genreSet],
				description: parseDescription(workPayload?.["description"]),
				sourceUrl: `https://openlibrary.org/works/${externalId}/${title}`,
				images: [...coverIdSet].map((coverId) => ({
					type: "remote" as const,
					url: coverImageUrl(coverId),
				})),
			},
		};
	});
});

export const resolve = defineProviderDriver(manifest, "resolve", (input, host) => {
	if (input.identifierType !== "isbn") {
		return Effect.fail(new Error("OpenLibrary resolve supports only isbn identifiers"));
	}
	return Effect.gen(function* () {
		const response = yield* host.httpCall(
			"GET",
			`https://openlibrary.org/isbn/${input.value}.json`,
		);
		const payloadValue = yield* Effect.try({
			try: () => JSON.parse(response.body),
			catch: () => new Error("OpenLibrary returned invalid JSON"),
		});
		const payload = asRecord(payloadValue);
		const works = payload?.["works"];
		const workKey = (Array.isArray(works) ? works : [])
			.map((work) => asRecord(work)?.["key"])
			.find(Boolean);
		const fromWorks = getKeySegment(workKey);
		const key = payload?.["key"];
		const fromKey = typeof key === "string" && key.startsWith("/works/") ? getKeySegment(key) : "";
		return { externalId: fromWorks || fromKey || null };
	}).pipe(
		Effect.catchIf(
			(error) => error.message === "not found",
			() => Effect.succeed({ externalId: null }),
		),
	);
});

export default defineProvider({ manifest, drivers: { search, details, resolve } });
