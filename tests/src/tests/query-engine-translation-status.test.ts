import { describe, expect, it } from "bun:test";

import {
	buildEntityRowsQueryDocument,
	createAuthenticatedClient,
	executeQueryEngine,
	findBuiltinSchemaBySlug,
	getQueryEngineFieldValue,
	literalExpr,
	requireQueryEngineTextField,
	seedEntityTranslation,
	seedMediaEntity,
	seedPopulatedProviderEntity,
	setUserLanguage,
	systemRef,
	type Client,
	type QueryEngineRowsOutput,
} from "../fixtures";
import { assertPresent } from "../test-support/assertions";

type Expr = QueryEngineRowsOutput["orderBy"][number]["expr"];

const MOVIE_CANONICAL_LANGUAGE = "en";

const translationStatusRef = (alias: string): Expr => ({
	type: "ref",
	sourceAlias: alias,
	field: { type: "systemComputed", name: "translationStatus" },
});

const idEq = (entityId: string): Expr => ({
	operator: "eq",
	type: "comparison",
	right: literalExpr(entityId),
	left: systemRef("e", "id"),
});

const statusDoc = (entityId: string, includeStatus: boolean) =>
	buildEntityRowsQueryDocument({
		limit: 1,
		alias: "e",
		schemas: ["movie"],
		where: idEq(entityId),
		orderBy: [{ order: "asc", expr: systemRef("e", "id") }],
		fields: includeStatus
			? [
					{ key: "id", expr: systemRef("e", "id") },
					{ key: "translationStatus", expr: translationStatusRef("e") },
				]
			: [{ key: "id", expr: systemRef("e", "id") }],
	});

async function readStatus(client: Client, entityId: string) {
	const response = await executeQueryEngine(client, statusDoc(entityId, true));
	const item = response.data.items[0];
	assertPresent(item, `Expected a row for entity '${entityId}'`);
	return requireQueryEngineTextField(item, "translationStatus");
}

describe("query engine — translationStatus computed field", () => {
	it("returns the right value for every case and is absent when not selected", async () => {
		const base = await createAuthenticatedClient();
		const { schema } = await findBuiltinSchemaBySlug(base.client, "movie");
		const sandboxScriptId = schema.providers.find((provider) => provider.name === "TMDB")?.scriptId;
		assertPresent(sandboxScriptId, "TMDB movie provider script not found");

		const seedPopulated = (properties: Record<string, unknown> = {}) =>
			seedPopulatedProviderEntity({
				properties,
				sandboxScriptId,
				entitySchemaId: schema.id,
				name: `Movie ${crypto.randomUUID()}`,
				externalId: `tstatus-${crypto.randomUUID()}`,
			});

		const readyMovie = await seedPopulated();
		const negativeMovie = await seedPopulated();
		const pendingMovie = await seedPopulated();

		// A content-bearing overlay → ready; an all-null overlay (negative cache) → none.
		await seedEntityTranslation({
			language: "es",
			entityId: readyMovie.id,
			name: "Película Traducida",
			properties: { description: "Descripción en español" },
		});
		await seedEntityTranslation({
			name: null,
			language: "es",
			properties: null,
			entityId: negativeMovie.id,
		});

		// populatedAt null but with a canonical script → none (populate-before-translate gate).
		const unpopulatedMovie = await seedMediaEntity({
			userId: null,
			properties: {},
			sandboxScriptId,
			name: "Unpopulated Movie",
			entitySchemaId: schema.id,
			externalId: `tstatus-${crypto.randomUUID()}`,
		});

		// No sandbox script → none (first CASE arm), regardless of language/population.
		const scriptLessMovie = await seedMediaEntity({
			userId: null,
			properties: {},
			sandboxScriptId: null,
			name: "Scriptless Movie",
			entitySchemaId: schema.id,
			externalId: `tstatus-${crypto.randomUUID()}`,
		});

		const { client: viewerEs } = await createAuthenticatedClient();
		await setUserLanguage(viewerEs, "es");
		const { client: viewerCanonical } = await createAuthenticatedClient();
		await setUserLanguage(viewerCanonical, MOVIE_CANONICAL_LANGUAGE);
		const { client: viewerNoLanguage } = await createAuthenticatedClient();

		// Non-canonical viewer sees the localization state per overlay row.
		expect(await readStatus(viewerEs, readyMovie.id)).toBe("ready");
		expect(await readStatus(viewerEs, negativeMovie.id)).toBe("none");
		expect(await readStatus(viewerEs, pendingMovie.id)).toBe("pending");
		expect(await readStatus(viewerEs, unpopulatedMovie.id)).toBe("none");
		expect(await readStatus(viewerEs, scriptLessMovie.id)).toBe("none");

		// Viewer already on the canonical language, and a viewer with no language, always get none.
		expect(await readStatus(viewerCanonical, pendingMovie.id)).toBe("none");
		expect(await readStatus(viewerNoLanguage, pendingMovie.id)).toBe("none");

		// The field is absent from rows that do not select it.
		const withoutStatus = await executeQueryEngine(viewerEs, statusDoc(pendingMovie.id, false));
		const item = withoutStatus.data.items[0];
		assertPresent(item, "Expected a row for the pending movie");
		expect(getQueryEngineFieldValue(item, "translationStatus")).toBeUndefined();
		expect(requireQueryEngineTextField(item, "id")).toBe(pendingMovie.id);
	}, 60_000);
});
