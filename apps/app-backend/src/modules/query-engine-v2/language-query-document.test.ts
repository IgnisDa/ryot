import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { QueryDocumentV2 } from "./language";

const decodeSync = Schema.decodeUnknownSync;

describe("QueryDocumentV2", () => {
	const minimal = {
		version: 2,
		source: { type: "entities", alias: "e", schemas: ["books"], where: null },
		output: {
			fields: [],
			type: "rows",
			pagination: { page: 1, limit: 10 },
			orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
		},
	};

	it("decodes a minimal valid document", () => {
		const result = decodeSync(QueryDocumentV2)(minimal);
		expect(result.version).toBe(2);
		expect(result.source.alias).toBe("e");
	});

	it("decodes a root event source document", () => {
		const result = decodeSync(QueryDocumentV2)({
			...minimal,
			source: {
				where: null,
				type: "events",
				alias: "completion",
				schemas: ["complete"],
				entity: { alias: "lesson", schemas: ["lesson"] },
			},
			output: {
				...minimal.output,
				orderBy: [
					{
						order: "desc",
						expr: {
							type: "ref",
							sourceAlias: "completion",
							field: { type: "system", name: "occurredAt" },
						},
					},
				],
			},
		});

		expect(result.source.type).toBe("events");
	});

	it("decodes a root relationship source document", () => {
		const result = decodeSync(QueryDocumentV2)({
			...minimal,
			source: {
				where: null,
				alias: "membership",
				type: "relationships",
				schemas: ["member-of"],
				sourceEntity: { alias: "memberEntity", schemas: ["books", "movies"] },
				targetEntity: { alias: "collectionEntity", schemas: ["collections"] },
			},
			output: {
				...minimal.output,
				orderBy: [
					{
						order: "desc",
						expr: {
							type: "ref",
							sourceAlias: "membership",
							field: { type: "system", name: "createdAt" },
						},
					},
				],
			},
		});

		expect(result.source.type).toBe("relationships");
	});

	it("decodes a time-series output document", () => {
		const result = decodeSync(QueryDocumentV2)({
			...minimal,
			output: {
				type: "timeSeries",
				measure: { aggregation: { function: "count" } },
				time: {
					bucket: "day",
					range: { endAt: "2026-01-03T00:00:00.000Z", startAt: "2026-01-01T00:00:00.000Z" },
					expr: {
						type: "ref",
						sourceAlias: "e",
						field: { type: "system", name: "createdAt" },
					},
				},
			},
		});

		expect(result.output.type).toBe("timeSeries");
	});

	it("throws when a relationship source is missing sourceEntity", () => {
		expect(() =>
			decodeSync(QueryDocumentV2)({
				...minimal,
				source: {
					where: null,
					alias: "membership",
					type: "relationships",
					schemas: ["member-of"],
					targetEntity: { alias: "collectionEntity", schemas: ["collections"] },
				},
			}),
		).toThrow();
	});

	it("throws when a relationship source is missing targetEntity", () => {
		expect(() =>
			decodeSync(QueryDocumentV2)({
				...minimal,
				source: {
					where: null,
					alias: "membership",
					type: "relationships",
					schemas: ["member-of"],
					sourceEntity: { alias: "memberEntity", schemas: ["books"] },
				},
			}),
		).toThrow();
	});

	it("throws when a relationship source schemas list is empty", () => {
		expect(() =>
			decodeSync(QueryDocumentV2)({
				...minimal,
				source: {
					where: null,
					schemas: [],
					alias: "membership",
					type: "relationships",
					sourceEntity: { alias: "memberEntity", schemas: ["books"] },
					targetEntity: { alias: "collectionEntity", schemas: ["collections"] },
				},
			}),
		).toThrow();
	});

	it("decodes a document with a non-null where clause", () => {
		const result = decodeSync(QueryDocumentV2)({
			...minimal,
			source: {
				...minimal.source,
				where: {
					type: "isNull",
					expr: { type: "ref", sourceAlias: "e", field: { type: "system", name: "image" } },
				},
			},
		});
		expect(result.source.where).not.toBeNull();
	});

	it("throws when version is not 2", () => {
		expect(() => decodeSync(QueryDocumentV2)({ ...minimal, version: 1 })).toThrow();
	});

	it("throws when source schemas list is empty", () => {
		expect(() =>
			decodeSync(QueryDocumentV2)({
				...minimal,
				source: { ...minimal.source, schemas: [] },
			}),
		).toThrow();
	});

	it("throws when a source has an unsupported filter key", () => {
		expect(() =>
			decodeSync(QueryDocumentV2)({
				...minimal,
				source: { ...minimal.source, filter: { type: "literal", value: true } },
			}),
		).toThrow();
	});
});
