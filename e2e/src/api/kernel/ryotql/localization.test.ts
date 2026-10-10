import {
	and,
	ascending,
	castText,
	column,
	contains,
	document,
	eq,
	field,
	jsonPath,
	literal,
	rows,
	table,
} from "@ryot-app/ryotql";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	createEntityFixture,
	createPluginEntitySchema,
	executeRyotQL,
	fakeProviderDetailsResult,
	installTestProviders,
	seedEntity,
	seedPopulatedEntity,
	testProviderEntitySchema,
	uninstallTestProvider,
	requireRyotQLValue,
	requireRows,
	seedEntityTranslation,
	setUserLanguage,
} from "~/fixtures/kernel";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const localizedDocument = (schemaSlug: string) => {
	const entity = table("entity", "entity");
	const properties = column(entity, "properties");
	const schemaPredicate = eq(column(entity, "entitySchemaSlug"), literal(schemaSlug));
	return document({
		filtered: rows(entity, {
			fields: [field("name", column(entity, "name"))],
			where: and(
				schemaPredicate,
				contains(castText(jsonPath(properties, "description")), literal("traducido de Zulu")),
			),
		}),
		entities: rows(entity, {
			where: schemaPredicate,
			orderBy: [ascending(column(entity, "name"))],
			fields: [
				field("name", column(entity, "name")),
				field("rating", jsonPath(properties, "rating")),
				field("description", jsonPath(properties, "description")),
			],
		}),
	});
};

const statusDocument = (entityId: string) => {
	const entity = table("entity", "entity");
	return document({
		entity: rows(entity, {
			limit: 1,
			where: eq(column(entity, "id"), literal(entityId)),
			fields: [field("translationStatus", column(entity, "translationStatus"))],
		}),
	});
};

const readStatus = (client: Parameters<typeof executeRyotQL>[0], entityId: string) =>
	Effect.gen(function* () {
		const response = yield* executeRyotQL(client, statusDocument(entityId));
		const item = requireRows(response.data["entity"], "entity").items[0];
		assertPresent(item, `Expected entity '${entityId}'`);
		return requireRyotQLValue(item, "translationStatus");
	});

describe("RyotQL entity localization", () => {
	it.live("localizes selection, JSON paths, predicates, and ordering with canonical fallback", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { slug, reference } = yield* createPluginEntitySchema(client, {
				schemaName: "RyotQLLocalizedItem",
				propertiesSchema: {
					fields: {
						rating: { type: "integer", label: "Rating", description: "Rating" },
						description: { type: "string", label: "Description", description: "Description" },
					},
				},
			});
			const zulu = yield* createEntityFixture(client, {
				name: "Zulu",
				entitySchema: reference,
				properties: { rating: 5, description: "Canonical Zulu overview" },
			});
			const alpha = yield* createEntityFixture(client, {
				name: "Alpha",
				entitySchema: reference,
				properties: { rating: 9, description: "Canonical Alpha overview" },
			});
			yield* seedEntityTranslation({
				name: "Alfa",
				language: "es",
				entityId: zulu.id,
				properties: { description: "Resumen traducido de Zulu" },
			});
			yield* seedEntityTranslation({
				name: "Zeta",
				language: "es",
				entityId: alpha.id,
				properties: { description: "Resumen traducido de Alpha" },
			});

			const canonical = yield* executeRyotQL(client, localizedDocument(slug));
			expect(
				requireRows(canonical.data["entities"], "entities").items.map((item) => [
					requireRyotQLValue(item, "name"),
					requireRyotQLValue(item, "description"),
				]),
			).toEqual([
				["Alpha", "Canonical Alpha overview"],
				["Zulu", "Canonical Zulu overview"],
			]);

			yield* setUserLanguage(client, "es");
			const localized = yield* executeRyotQL(client, localizedDocument(slug));
			expect(
				requireRows(localized.data["entities"], "entities").items.map((item) => [
					requireRyotQLValue(item, "name"),
					requireRyotQLValue(item, "rating"),
					requireRyotQLValue(item, "description"),
				]),
			).toEqual([
				["Alfa", 5, "Resumen traducido de Zulu"],
				["Zeta", 9, "Resumen traducido de Alpha"],
			]);
			expect(
				requireRows(localized.data["filtered"], "filtered").items.map((item) =>
					requireRyotQLValue(item, "name"),
				),
			).toEqual(["Alfa"]);
		}),
	);

	it.live("preserves translation status semantics", () =>
		Effect.gen(function* () {
			const base = yield* createAuthenticatedClient();
			const providers = yield* Effect.acquireRelease(
				installTestProviders({
					scope: "system",
					client: base.client,
					providers: {
						withoutLanguage: {
							rootEntitySchemaSlug: "movie",
							details: fakeProviderDetailsResult({ name: "Provider without canonical language" }),
						},
						canonical: {
							rootEntitySchemaSlug: "movie",
							information: { source: "e2e", canonicalLanguage: "en" },
							details: fakeProviderDetailsResult({ name: "Provider with canonical language" }),
						},
					},
				}),
				({ canonical }) => uninstallTestProvider(canonical),
			);
			const entitySchema = testProviderEntitySchema(providers.canonical);
			const seed = (providerId: string | null, populated: boolean) =>
				(populated ? seedPopulatedEntity : seedEntity)({
					providerId,
					entitySchema,
					properties: {},
					name: `Movie ${crypto.randomUUID()}`,
					externalId: `ryotql-status-${crypto.randomUUID()}`,
				});
			const providerId = providers.canonical.providerId;
			const ready = yield* seed(providerId, true);
			const pending = yield* seed(providerId, true);
			const negative = yield* seed(providerId, true);
			yield* seedEntityTranslation({
				language: "es",
				entityId: ready.id,
				name: "Película Traducida",
				properties: { description: "Descripción" },
			});
			yield* seedEntityTranslation({
				name: null,
				language: "es",
				properties: null,
				entityId: negative.id,
			});
			const unpopulated = yield* seed(providerId, false);
			const providerless = yield* seed(null, false);
			const missingCanonicalLanguage = yield* seed(providers.withoutLanguage.providerId, true);

			const { client: spanish } = yield* createAuthenticatedClient();
			yield* setUserLanguage(spanish, "es");
			expect(yield* readStatus(spanish, ready.id)).toBe("ready");
			expect(yield* readStatus(spanish, pending.id)).toBe("pending");
			expect(yield* readStatus(spanish, negative.id)).toBe("none");
			expect(yield* readStatus(spanish, unpopulated.id)).toBe("none");
			expect(yield* readStatus(spanish, providerless.id)).toBe("none");
			expect(yield* readStatus(spanish, missingCanonicalLanguage.id)).toBe("none");

			const { client: canonical } = yield* createAuthenticatedClient();
			yield* setUserLanguage(canonical, "en");
			expect(yield* readStatus(canonical, pending.id)).toBe("none");
			const { client: noPreference } = yield* createAuthenticatedClient();
			expect(yield* readStatus(noPreference, pending.id)).toBe("none");
		}),
	);
});
