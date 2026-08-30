import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { MediaSandboxError } from "../../../lib/failures";
import {
	type UnknownRecord,
	asRecord,
	decodeJsonResponse,
	numberValue,
	stringValue,
} from "../../../lib/records";
import { createRoleAccumulator } from "../../../lib/role-accumulator";
import { toTitleCase } from "../../../lib/title-case";
import {
	getKeySegment,
	loadOpenLibraryJson,
	type OpenLibraryHost,
	parseDescription,
} from "../../../lib/vendors/openlibrary";

export const manifest = defineManifest({
	kind: "provider",
	name: "OpenLibrary",
	slug: "book.openlibrary",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
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
	if (/^\d{4}$/.test(trimmed)) {
		return new Date(Date.UTC(Number(trimmed), 0, 1));
	}
	const d = new Date(trimmed);
	if (!Number.isNaN(d.getTime())) {
		return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
	}
	return null;
};

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) => {
		const params = new URLSearchParams({
			type: "work",
			q: input.query,
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
							title,
							externalId,
							...(coverId === null ? {} : { imageUrl: coverImageUrl(coverId) }),
							...(publishYear === null ? {} : { metadata: [publishYear] as const }),
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
	},
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
		Effect.orElseSucceed(() => "Loading..."),
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
	return Effect.gen(function* () {
		for (const authorEntry of Array.isArray(authors) ? authors : []) {
			const record = asRecord(authorEntry);
			if (!record) {
				continue;
			}
			const nestedAuthor = asRecord(record["author"]);
			const authorKey = authorKeyOf(record, nestedAuthor);
			const personIdentifier = getKeySegment(authorKey);
			if (!personIdentifier) {
				continue;
			}
			const inlineName = stringValue(nestedAuthor?.["name"]) ?? stringValue(record["name"]) ?? "";
			const authorName = inlineName || (yield* loadAuthorName(host, authorNameCache, authorKey));
			accumulator.add({
				name: authorName,
				externalId: personIdentifier,
				providerSlug: "person.openlibrary",
				relationshipProperties: { roles: ["Author"] },
			});
		}
		return accumulator.entities;
	});
};

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) => {
		const requestedIdentifier = getKeySegment(input.externalId);
		if (!requestedIdentifier) {
			return Effect.fail(new MediaSandboxError({ message: "externalId is required" }));
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
			).pipe(Effect.orElseSucceed(() => null));
			const workPayload = asRecord(workValue);
			const title = typeof workPayload?.["title"] === "string" ? workPayload["title"] : "";
			if (!title) {
				return yield* new MediaSandboxError({
					message: "OpenLibrary work payload is missing title",
				});
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
						purpose: "cover" as const,
						url: coverImageUrl(coverId),
					})),
				},
			};
		});
	},
});

export const resolve = defineProvider({
	manifest,
	operation: "resolve",
	run: (input, host) =>
		Effect.gen(function* () {
			if (input.identifierType !== "isbn") {
				return yield* new MediaSandboxError({
					message: "OpenLibrary resolve supports only isbn identifiers",
				});
			}
			const response = yield* host.httpCall(
				"GET",
				`https://openlibrary.org/isbn/${input.value}.json`,
			);
			const payloadValue = yield* decodeJsonResponse(response.body, "OpenLibrary");
			const payload = asRecord(payloadValue);
			const works = payload?.["works"];
			const workKey = (Array.isArray(works) ? works : [])
				.map((work) => asRecord(work)?.["key"])
				.find(Boolean);
			const fromWorks = getKeySegment(workKey);
			const key = payload?.["key"];
			const fromKey =
				typeof key === "string" && key.startsWith("/works/") ? getKeySegment(key) : "";
			return { externalId: fromWorks || fromKey || null };
		}).pipe(
			// oxlint-disable-next-line effecttsgo/catch-conditional-refail-to-catch-if -- The linter infers `unknown` for this catchIf error channel although tsc does not
			Effect.catch((error) =>
				error.message === "not found" ? Effect.succeed({ externalId: null }) : Effect.fail(error),
			),
		),
});
