import { describe, expect, it } from "bun:test";

import {
	buildEntityRowsQueryDocument,
	createAuthenticatedClient,
	createQueryEngineEntity,
	createQueryEngineTrackerAndSchema,
	executeQueryEngine,
	literalExpr,
	propertyRef,
	type QueryEngineRowItem,
	type QueryEngineRowsResponse,
	requireQueryEngineFieldValue,
	seedEntityTranslation,
	setUserLanguage,
	systemRef,
} from "../fixtures";
import { requirePresent } from "../test-support/assertions";

type Expr = ReturnType<typeof literalExpr>;
const containsW = (left: Expr, right: Expr): Expr => ({ type: "contains", left, right });

const namesOf = (result: QueryEngineRowsResponse) =>
	result.data.items.map((item) => requireQueryEngineFieldValue(item, "name").value);

const byName = (result: QueryEngineRowsResponse, name: string): QueryEngineRowItem =>
	requirePresent(
		result.data.items.find((item) => requireQueryEngineFieldValue(item, "name").value === name),
		`Missing localized row '${name}'`,
	);

const setupLocalizedItems = async () => {
	const { client } = await createAuthenticatedClient();
	const { schemaId, slug } = await createQueryEngineTrackerAndSchema(client, {
		schemaName: "LocalizedItem",
		propertiesSchema: {
			fields: {
				rating: { type: "integer", label: "Rating", description: "Rating" },
				description: { type: "string", label: "Description", description: "Description" },
			},
		},
	});

	const zulu = await createQueryEngineEntity(client, {
		name: "Zulu",
		entitySchemaId: schemaId,
		properties: { rating: 5, description: "Canonical Zulu overview" },
	});
	const alpha = await createQueryEngineEntity(client, {
		name: "Alpha",
		entitySchemaId: schemaId,
		properties: { rating: 9, description: "Canonical Alpha overview" },
	});

	await seedEntityTranslation({
		name: "Alfa",
		language: "es",
		entityId: zulu.id,
		properties: { description: "Resumen traducido de Zulu" },
	});
	await seedEntityTranslation({
		name: "Zeta",
		language: "es",
		entityId: alpha.id,
		properties: { description: "Resumen traducido de Alpha" },
	});

	return { client, slug };
};

const buildDoc = (slug: string, overrides: { where?: Expr } = {}) =>
	buildEntityRowsQueryDocument({
		limit: 20,
		alias: "item",
		schemas: [slug],
		where: overrides.where ?? null,
		orderBy: [{ order: "asc", expr: systemRef("item", "name") }],
		fields: [
			{ key: "name", expr: systemRef("item", "name") },
			{ key: "rating", expr: propertyRef("item", slug, "rating") },
			{ key: "description", expr: propertyRef("item", slug, "description") },
		],
	});

describe("Query engine entity localization", () => {
	it("returns canonical values and canonical ordering when the user has no language preference", async () => {
		const { client, slug } = await setupLocalizedItems();
		const result = await executeQueryEngine(client, buildDoc(slug));

		// Canonical name sort: "Alpha" < "Zulu".
		expect(namesOf(result)).toEqual(["Alpha", "Zulu"]);
		expect(requireQueryEngineFieldValue(byName(result, "Alpha"), "description").value).toBe(
			"Canonical Alpha overview",
		);
		expect(requireQueryEngineFieldValue(byName(result, "Zulu"), "description").value).toBe(
			"Canonical Zulu overview",
		);
	});

	it("returns the translated name/description and preserves canonical-only properties", async () => {
		const { client, slug } = await setupLocalizedItems();
		await setUserLanguage(client, "es");
		const result = await executeQueryEngine(client, buildDoc(slug));

		const alfa = byName(result, "Alfa");
		const zeta = byName(result, "Zeta");
		expect(requireQueryEngineFieldValue(alfa, "description").value).toBe(
			"Resumen traducido de Zulu",
		);
		expect(requireQueryEngineFieldValue(zeta, "description").value).toBe(
			"Resumen traducido de Alpha",
		);
		expect(requireQueryEngineFieldValue(alfa, "rating").value).toBe(5);
		expect(requireQueryEngineFieldValue(zeta, "rating").value).toBe(9);
	});

	it("orders by the translated name, not the canonical one", async () => {
		const { client, slug } = await setupLocalizedItems();
		await setUserLanguage(client, "es");
		const result = await executeQueryEngine(client, buildDoc(slug));

		// Localized name sort: "Alfa" (canonical Zulu) < "Zeta" (canonical Alpha) — the reverse of
		// the canonical ordering, so this only passes if the sort keys off the translated name.
		expect(namesOf(result)).toEqual(["Alfa", "Zeta"]);
	});

	it("filters (contains) on the translated name", async () => {
		const { client, slug } = await setupLocalizedItems();
		await setUserLanguage(client, "es");

		const matched = await executeQueryEngine(
			client,
			buildDoc(slug, { where: containsW(systemRef("item", "name"), literalExpr("Alfa")) }),
		);
		expect(namesOf(matched)).toEqual(["Alfa"]);

		const canonicalNeedle = await executeQueryEngine(
			client,
			buildDoc(slug, { where: containsW(systemRef("item", "name"), literalExpr("Zulu")) }),
		);
		expect(namesOf(canonicalNeedle)).toEqual([]);
	});

	it("filters (contains) on a translated property (description)", async () => {
		const { client, slug } = await setupLocalizedItems();
		await setUserLanguage(client, "es");

		const result = await executeQueryEngine(
			client,
			buildDoc(slug, {
				where: containsW(
					propertyRef("item", slug, "description"),
					literalExpr("traducido de Zulu"),
				),
			}),
		);
		expect(namesOf(result)).toEqual(["Alfa"]);
	});
});
