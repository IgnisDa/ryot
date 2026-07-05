import { Effect } from "effect";

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
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

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

const readStatus = (client: Client, entityId: string) =>
	Effect.gen(function* () {
		const response = yield* executeQueryEngine(client, statusDoc(entityId, true));
		const item = response.data.items[0];
		assertPresent(item, `Expected a row for entity '${entityId}'`);
		return requireQueryEngineTextField(item, "translationStatus");
	});

describe("query engine — translationStatus computed field", () => {
	it.live("returns the right value for every case and is absent when not selected", () =>
		Effect.gen(function* () {
			const base = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(base.client, "movie");
			const providerId = schema.providers.find((provider) => provider.name === "TMDB")?.providerId;
			assertPresent(providerId, "TMDB movie provider not found");

			const seedPopulated = (properties: Record<string, unknown> = {}) =>
				seedPopulatedProviderEntity({
					properties,
					providerId,
					entitySchemaSlug: schema.id,
					name: `Movie ${crypto.randomUUID()}`,
					externalId: `tstatus-${crypto.randomUUID()}`,
				});

			const readyMovie = yield* seedPopulated();
			const negativeMovie = yield* seedPopulated();
			const pendingMovie = yield* seedPopulated();

			yield* seedEntityTranslation({
				language: "es",
				entityId: readyMovie.id,
				name: "Película Traducida",
				properties: { description: "Descripción en español" },
			});
			yield* seedEntityTranslation({
				name: null,
				language: "es",
				properties: null,
				entityId: negativeMovie.id,
			});

			const unpopulatedMovie = yield* seedMediaEntity({
				userId: null,
				properties: {},
				providerId,
				name: "Unpopulated Movie",
				entitySchemaSlug: schema.id,
				externalId: `tstatus-${crypto.randomUUID()}`,
			});

			const providerlessMovie = yield* seedMediaEntity({
				userId: null,
				properties: {},
				providerId: null,
				name: "Providerless Movie",
				entitySchemaSlug: schema.id,
				externalId: `tstatus-${crypto.randomUUID()}`,
			});

			const { client: viewerEs } = yield* createAuthenticatedClient();
			yield* setUserLanguage(viewerEs, "es");
			const { client: viewerCanonical } = yield* createAuthenticatedClient();
			yield* setUserLanguage(viewerCanonical, MOVIE_CANONICAL_LANGUAGE);
			const { client: viewerNoLanguage } = yield* createAuthenticatedClient();

			expect(yield* readStatus(viewerEs, readyMovie.id)).toBe("ready");
			expect(yield* readStatus(viewerEs, negativeMovie.id)).toBe("none");
			expect(yield* readStatus(viewerEs, pendingMovie.id)).toBe("pending");
			expect(yield* readStatus(viewerEs, unpopulatedMovie.id)).toBe("none");
			expect(yield* readStatus(viewerEs, providerlessMovie.id)).toBe("none");

			expect(yield* readStatus(viewerCanonical, pendingMovie.id)).toBe("none");
			expect(yield* readStatus(viewerNoLanguage, pendingMovie.id)).toBe("none");

			const withoutStatus = yield* executeQueryEngine(viewerEs, statusDoc(pendingMovie.id, false));
			const item = withoutStatus.data.items[0];
			assertPresent(item, "Expected a row for the pending movie");
			expect(getQueryEngineFieldValue(item, "translationStatus")).toBeUndefined();
			expect(requireQueryEngineTextField(item, "id")).toBe(pendingMovie.id);
		}),
	);
});
