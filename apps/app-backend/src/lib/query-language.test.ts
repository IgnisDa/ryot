import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { QueryEngineRequest, createLiteralExpression } from "./query-language";

const decodeQueryEngineRequest = Schema.decodeUnknownEither(QueryEngineRequest);

const baseEntityRequest = {
	fields: [],
	filter: null,
	mode: "entities",
	scope: ["books"],
	computedFields: [],
	pagination: { page: 1, limit: 20 },
	sort: { expression: createLiteralExpression(null), direction: "asc" },
} as const;

describe("QueryEngineRequest", () => {
	it("accepts a valid entities request", () => {
		expect(Either.isRight(decodeQueryEngineRequest(baseEntityRequest))).toBe(true);
	});

	it("accepts events mode when eventSchemas are provided", () => {
		expect(
			Either.isRight(
				decodeQueryEngineRequest({
					fields: [],
					filter: null,
					mode: "events",
					scope: ["books"],
					computedFields: [],
					eventSchemas: ["review"],
					pagination: { page: 1, limit: 20 },
					sort: { expression: createLiteralExpression(null), direction: "asc" },
				}),
			),
		).toBe(true);
	});

	it("rejects events mode when eventSchemas are missing", () => {
		expect(
			Either.isLeft(
				decodeQueryEngineRequest({
					fields: [],
					filter: null,
					mode: "events",
					scope: ["books"],
					computedFields: [],
					pagination: { page: 1, limit: 20 },
					sort: { expression: createLiteralExpression(null), direction: "asc" },
				}),
			),
		).toBe(true);
	});

	it("rejects timeSeries mode when eventSchemas are missing", () => {
		expect(
			Either.isLeft(
				decodeQueryEngineRequest({
					filter: null,
					bucket: "day",
					scope: ["books"],
					mode: "timeSeries",
					computedFields: [],
					metric: { type: "count" },
					dateRange: {
						endAt: "2026-01-02T00:00:00.000Z",
						startAt: "2026-01-01T00:00:00.000Z",
					},
				}),
			),
		).toBe(true);
	});

	it("rejects timeSeries mode when startAt is not before endAt", () => {
		expect(
			Either.isLeft(
				decodeQueryEngineRequest({
					filter: null,
					bucket: "day",
					scope: ["books"],
					mode: "timeSeries",
					computedFields: [],
					metric: { type: "count" },
					eventSchemas: ["review"],
					dateRange: {
						endAt: "2026-01-01T00:00:00.000Z",
						startAt: "2026-01-01T00:00:00.000Z",
					},
				}),
			),
		).toBe(true);
	});
});
