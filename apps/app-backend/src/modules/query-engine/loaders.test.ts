import { describe, expect, it } from "bun:test";

import { QueryEngineNotFoundError, QueryEngineValidationError } from "~/lib/views/errors";

import {
	validateEventSchemaSlugs,
	validateRelationshipSlugs,
	validateUniqueSchemaSlugs,
	validateVisibleEventJoins,
} from "./loaders";
import type { QueryEngineSchemaRow } from "./query-cte-shared";

const makeSchemaRow = (slug: string, id: string): QueryEngineSchemaRow => ({
	id,
	slug,
	propertiesSchema: { fields: {} },
});

const makeEventSchema = (
	slug: string,
	id: string,
	entitySchemaId: string,
	entitySchemaSlug: string,
) => ({
	id,
	slug,
	entitySchemaId,
	entitySchemaSlug,
	propertiesSchema: { fields: {} },
});

describe("validateUniqueSchemaSlugs", () => {
	it("passes when all slugs are found exactly once", () => {
		const schemas = [makeSchemaRow("books", "1"), makeSchemaRow("movies", "2")];
		expect(() => validateUniqueSchemaSlugs(["books", "movies"], schemas)).not.toThrow();
	});

	it("throws NOT_FOUND when a slug is missing", () => {
		const schemas = [makeSchemaRow("books", "1")];
		expect(() => validateUniqueSchemaSlugs(["books", "movies"], schemas)).toThrow(
			QueryEngineNotFoundError,
		);
	});

	it("throws VALIDATION when a slug resolves to multiple schemas", () => {
		const schemas = [makeSchemaRow("books", "1"), makeSchemaRow("books", "2")];
		expect(() => validateUniqueSchemaSlugs(["books"], schemas)).toThrow(QueryEngineValidationError);
	});

	it("passes when no slugs are requested", () => {
		expect(() => validateUniqueSchemaSlugs([], [])).not.toThrow();
	});
});

describe("validateVisibleEventJoins", () => {
	// oxlint-disable-next-line unicorn/consistent-function-scoping

	it("resolves event joins when schemas are found", () => {
		const joins = [
			{
				key: "review",
				eventSchemaSlug: "review",
				kind: "latestEvent" as const,
			},
		];
		const schemas = [makeEventSchema("review", "es1", "s1", "books")];
		const result = validateVisibleEventJoins(joins, schemas);
		expect(result).toHaveLength(1);
		expect(result[0]?.key).toBe("review");
		expect(result[0]?.eventSchemas).toHaveLength(1);
	});

	it("throws when event schema is not available", () => {
		const joins = [
			{
				key: "missing",
				eventSchemaSlug: "missing",
				kind: "latestEvent" as const,
			},
		];
		expect(() => validateVisibleEventJoins(joins, [])).toThrow(QueryEngineValidationError);
	});

	it("throws when event schema resolves to multiple slugs for the same entity schema", () => {
		const joins = [
			{
				key: "review",
				eventSchemaSlug: "review",
				kind: "latestEvent" as const,
			},
		];
		const schemas = [
			makeEventSchema("review", "es1", "s1", "books"),
			makeEventSchema("review", "es2", "s2", "books"),
		];
		expect(() => validateVisibleEventJoins(joins, schemas)).toThrow(QueryEngineValidationError);
	});
});

describe("validateEventSchemaSlugs", () => {
	it("passes when all slugs are found in rows", () => {
		expect(() =>
			validateEventSchemaSlugs(["review", "complete"], [{ slug: "review" }, { slug: "complete" }]),
		).not.toThrow();
	});

	it("throws NOT_FOUND when a slug is missing", () => {
		expect(() => validateEventSchemaSlugs(["review", "missing"], [{ slug: "review" }])).toThrow(
			QueryEngineNotFoundError,
		);
	});
});

describe("validateRelationshipSlugs", () => {
	it("passes when all slugs are found", () => {
		expect(() =>
			validateRelationshipSlugs(["owner", "editor"], new Set(["owner", "editor"])),
		).not.toThrow();
	});

	it("throws NOT_FOUND when a slug is missing", () => {
		expect(() => validateRelationshipSlugs(["owner", "editor"], new Set(["owner"]))).toThrow(
			QueryEngineNotFoundError,
		);
	});
});
