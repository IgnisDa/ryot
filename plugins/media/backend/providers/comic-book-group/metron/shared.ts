import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";
import { asArray, asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { MediaSandboxError } from "../../../lib/failures";
import { numberValue, stringValue } from "../../../lib/records";
import { normalizeRichDescription } from "../../../lib/rich-description";
import { loadMetronJson, type MetronHost } from "../../../lib/vendors/metron";

export const manifest = defineManifest({
	name: "Metron",
	kind: "provider",
	slug: "comic-book-group.metron",
});

const METRON_BASE_URL = "https://metron.cloud/api";
const METRON_ORIGIN = "https://metron.cloud";
const ISSUE_LIST_PAGE_SIZE = 100;

type OrderedRelatedEntity = {
	name: string;
	externalId: string;
	providerSlug: string;
	relationshipProperties: { order: number };
};

const numericIdString = (value: unknown) =>
	typeof value === "number" ? String(Math.trunc(value)) : null;

const metronGet = (host: MetronHost, path: string) =>
	loadMetronJson(host, `${METRON_BASE_URL}${path}`, `Metron request failed: ${path}`);

const issueListPath = (seriesId: string) => `/series/${seriesId}/issue_list/`;

const resolveNextPage = (
	payload: null | Record<string, unknown>,
	seriesId: string,
	page: number,
	offset: number,
	resultCount: number,
): Effect.Effect<null | number, MediaSandboxError> => {
	const next = payload?.["next"];
	if (next === null || next === undefined) {
		const count = numberValue(payload?.["count"]);
		return Effect.succeed(count !== null && count > offset + resultCount ? page + 1 : null);
	}
	if (typeof next !== "string") {
		return Effect.fail(
			new MediaSandboxError({ message: "Metron issue-list next link must be a URL" }),
		);
	}
	const path = issueListPath(seriesId);
	let url: URL;
	try {
		url = new URL(next, `${METRON_BASE_URL}${path}`);
	} catch {
		return Effect.fail(
			new MediaSandboxError({ message: "Metron issue-list next link is invalid" }),
		);
	}
	const nextPageValue = url.searchParams.get("page");
	const nextPage = nextPageValue === null ? Number.NaN : Number(nextPageValue);
	if (
		url.origin !== METRON_ORIGIN ||
		url.username !== "" ||
		url.password !== "" ||
		url.pathname !== `/api${path}` ||
		!Number.isSafeInteger(nextPage) ||
		nextPage <= page
	) {
		return Effect.fail(
			new MediaSandboxError({
				message: "Metron issue-list next link is outside the canonical API path",
			}),
		);
	}
	return Effect.succeed(nextPage);
};

const readIssueListPage = (host: MetronHost, seriesId: string, page: number, offset: number) => {
	const path = issueListPath(seriesId);
	const params = new URLSearchParams({
		page: String(page),
		page_size: String(ISSUE_LIST_PAGE_SIZE),
	});
	return metronGet(host, `${path}?${params.toString()}`).pipe(
		Effect.flatMap((payloadValue) => {
			const payload = asRecord(payloadValue);
			const resultsValue = payload?.["results"];
			if (!Array.isArray(resultsValue)) {
				return Effect.fail(
					new MediaSandboxError({ message: "Metron issue-list results are malformed" }),
				);
			}
			const results: Array<{ readonly id: number; readonly record: Record<string, unknown> }> = [];
			for (const issue of resultsValue) {
				const record = asRecord(issue);
				const id = numberValue(record?.["id"]);
				if (!record || id === null || !Number.isSafeInteger(id) || id <= 0) {
					return Effect.fail(
						new MediaSandboxError({
							message: "Metron issue-list results contain an invalid issue",
						}),
					);
				}
				results.push({ id, record });
			}
			return resolveNextPage(payload, seriesId, page, offset, results.length).pipe(
				Effect.flatMap((nextPage) => {
					if (results.length === 0 && nextPage !== null) {
						return Effect.fail(
							new MediaSandboxError({
								message: "Metron issue-list page is empty before coverage is complete",
							}),
						);
					}
					const entitiesById = new Map<string, OrderedRelatedEntity>();
					for (const [index, issue] of results.entries()) {
						const memberId = String(issue.id);
						if (entitiesById.has(memberId)) {
							continue;
						}
						const memberName =
							stringValue(issue.record["issue"]) ??
							stringValue(issue.record["issue_name"]) ??
							"Loading...";
						entitiesById.set(memberId, {
							name: memberName,
							externalId: memberId,
							providerSlug: "comic-book.metron",
							relationshipProperties: { order: offset + index + 1 },
						});
					}
					return Effect.succeed({
						nextPage,
						nextOffset: offset + results.length,
						entities: [...entitiesById.values()],
					});
				}),
			);
		}),
	);
};

const decodeIssueListContinuation = (continuation: unknown) => {
	const record = asRecord(continuation);
	const page = numberValue(record?.["page"]);
	const offset = numberValue(record?.["offset"]);
	return page !== null &&
		Number.isSafeInteger(page) &&
		page >= 2 &&
		offset !== null &&
		Number.isSafeInteger(offset) &&
		offset >= 0
		? Effect.succeed({ page, offset })
		: Effect.fail(
				new MediaSandboxError({ message: "Invalid Metron series issue-list continuation" }),
			);
};

const issueListCoverage = (issueList: {
	readonly nextOffset: number;
	readonly nextPage: null | number;
}) =>
	issueList.nextPage === null
		? { status: "complete" as const }
		: {
				status: "more" as const,
				continuation: { page: issueList.nextPage, offset: issueList.nextOffset },
			};

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) => {
		const params = new URLSearchParams({
			name: input.query,
			page: String(input.page),
			page_size: String(input.pageSize),
		});
		return metronGet(host, `/series/?${params.toString()}`).pipe(
			Effect.map((dataValue) => {
				const data = asRecord(dataValue);
				const resultsValue = data?.["results"];
				const results = asArray(resultsValue);
				const countValue = data?.["count"];
				const totalItems = typeof countValue === "number" ? countValue : results.length;
				const items = results.flatMap((series) => {
					const record = asRecord(series);
					const id = numericIdString(record?.["id"]);
					const name = stringValue(record?.["name"]);
					if (!record || !id || !name) {
						return [];
					}
					const issueCount = record["issue_count"];
					const parts = typeof issueCount === "number" ? issueCount : null;
					return [
						{
							title: name,
							externalId: id,
							...(parts === null ? {} : { metadata: [parts] as const }),
						},
					];
				});
				const nextPage = data?.["next"] != null ? input.page + 1 : null;
				return { items, details: { nextPage, totalItems } };
			}),
		);
	},
});

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		Effect.gen(function* () {
			if (!/^\d+$/.test(input.externalId)) {
				return yield* new MediaSandboxError({
					message: "externalId must be a numeric Metron series ID",
				});
			}
			const seriesValue = yield* metronGet(host, `/series/${input.externalId}/`);
			const series = asRecord(seriesValue);
			const title = stringValue(series?.["name"]);
			if (!title) {
				return yield* new MediaSandboxError({ message: "Metron series is missing name" });
			}
			const description = yield* normalizeRichDescription(series?.["desc"], "https://metron.cloud");
			const issueCount = series?.["issue_count"];
			const parts = typeof issueCount === "number" ? issueCount : 0;
			const issueList = yield* readIssueListPage(host, input.externalId, 1, 0);
			return {
				name: title,
				properties: {
					parts,
					images: [],
					description,
					sourceUrl: `https://metron.cloud/series/${input.externalId}`,
				},
				relatedEntityGroups: [
					{
						entities: issueList.entities,
						direction: "outgoing" as const,
						coverage: issueListCoverage(issueList),
						synchronization: "authoritative" as const,
						relationshipSchemaSlug: "comic-book-group-to-comic-book",
					},
				],
			};
		}),
});

export const related = defineProvider({
	manifest,
	operation: "related",
	run: (input, host) =>
		Effect.gen(function* () {
			if (!/^\d+$/.test(input.externalId)) {
				return yield* new MediaSandboxError({
					message: "externalId must be a numeric Metron series ID",
				});
			}
			if (
				input.relationshipSchemaSlug !== "comic-book-group-to-comic-book" ||
				input.direction !== "outgoing"
			) {
				return yield* new MediaSandboxError({
					message: `Unsupported Metron series relationship: ${input.relationshipSchemaSlug}`,
				});
			}
			const { page, offset } = yield* decodeIssueListContinuation(input.continuation);
			const issueList = yield* readIssueListPage(host, input.externalId, page, offset);
			return { entities: issueList.entities, coverage: issueListCoverage(issueList) };
		}),
});
