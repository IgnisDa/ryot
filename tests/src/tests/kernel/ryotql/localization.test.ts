import type { RowsResult } from "@ryot/contract/modules/ryotql/language";
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
} from "@ryot/ryotql";
import { Effect } from "effect";

import {
	adminHeaders,
	createAuthenticatedClient,
	createQueryEngineEntity,
	createQueryEnginePluginSchema,
	executeRyotQL,
	fakeProviderDetailsResult,
	findBuiltinSchemaBySlug,
	getBackendClient,
	installTestProvider,
	seedEntityTranslation,
	seedMediaEntity,
	seedPopulatedProviderEntity,
	setUserLanguage,
	uninstallTestPluginStrict,
} from "~/fixtures";
import { assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const requireRows = (result: RowsResult | undefined, name: string) => {
	if (!result) {
		throw new Error(`Expected '${name}' rows`);
	}
	return result;
};

const localizedDocument = (schemaSlug: string) => {
	const entity = table("entity", "entity");
	const properties = column(entity, "properties");
	const schemaPredicate = eq(column(entity, "entitySchemaSlug"), literal(schemaSlug));
	return document({
		entities: rows(entity, {
			where: schemaPredicate,
			orderBy: [ascending(column(entity, "name"))],
			fields: [
				field("name", column(entity, "name")),
				field("rating", jsonPath(properties, "rating")),
				field("description", jsonPath(properties, "description")),
			],
		}),
		filtered: rows(entity, {
			fields: [field("name", column(entity, "name"))],
			where: and(
				schemaPredicate,
				contains(castText(jsonPath(properties, "description")), literal("traducido de Zulu")),
			),
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
		return item["translationStatus"]?.value;
	});

describe("RyotQL entity localization", () => {
	it.live("localizes selection, JSON paths, predicates, and ordering with canonical fallback", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const { schemaId, slug } = yield* createQueryEnginePluginSchema(client, {
				schemaName: "RyotQLLocalizedItem",
				propertiesSchema: {
					fields: {
						rating: { type: "integer", label: "Rating", description: "Rating" },
						description: { type: "string", label: "Description", description: "Description" },
					},
				},
			});
			const zulu = yield* createQueryEngineEntity(client, {
				name: "Zulu",
				entitySchemaSlug: schemaId,
				properties: { rating: 5, description: "Canonical Zulu overview" },
			});
			const alpha = yield* createQueryEngineEntity(client, {
				name: "Alpha",
				entitySchemaSlug: schemaId,
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
					item["name"]?.value,
					item["description"]?.value,
				]),
			).toEqual([
				["Alpha", "Canonical Alpha overview"],
				["Zulu", "Canonical Zulu overview"],
			]);

			yield* setUserLanguage(client, "es");
			const localized = yield* executeRyotQL(client, localizedDocument(slug));
			expect(
				requireRows(localized.data["entities"], "entities").items.map((item) => [
					item["name"]?.value,
					item["rating"]?.value,
					item["description"]?.value,
				]),
			).toEqual([
				["Alfa", 5, "Resumen traducido de Zulu"],
				["Zeta", 9, "Resumen traducido de Alpha"],
			]);
			expect(
				requireRows(localized.data["filtered"], "filtered").items.map(
					(item) => item["name"]?.value,
				),
			).toEqual(["Alfa"]);
		}),
	);

	it.live("preserves translation status semantics", () =>
		Effect.gen(function* () {
			const base = yield* createAuthenticatedClient();
			const { schema } = yield* findBuiltinSchemaBySlug(base.client, "movie");
			const providerId = schema.providers.find((provider) => provider.name === "TMDB")?.providerId;
			assertPresent(providerId, "TMDB movie provider not found");
			const seedPopulated = () =>
				seedPopulatedProviderEntity({
					providerId,
					properties: {},
					entitySchemaSlug: schema.id,
					name: `Movie ${crypto.randomUUID()}`,
					externalId: `ryotql-status-${crypto.randomUUID()}`,
				});
			const ready = yield* seedPopulated();
			const pending = yield* seedPopulated();
			const negative = yield* seedPopulated();
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
			const unpopulated = yield* seedMediaEntity({
				providerId,
				userId: null,
				properties: {},
				name: "Unpopulated Movie",
				entitySchemaSlug: schema.id,
				externalId: `ryotql-status-${crypto.randomUUID()}`,
			});
			const providerless = yield* seedMediaEntity({
				userId: null,
				properties: {},
				providerId: null,
				name: "Providerless Movie",
				entitySchemaSlug: schema.id,
				externalId: `ryotql-status-${crypto.randomUUID()}`,
			});
			const providerWithoutCanonicalLanguage = yield* Effect.acquireRelease(
				installTestProvider({
					client: base.client,
					details: fakeProviderDetailsResult({ name: "Provider without canonical language" }),
				}),
				(provider) => uninstallTestPluginStrict(provider).pipe(Effect.orDie),
			);
			const missingCanonicalLanguage = yield* Effect.acquireRelease(
				seedPopulatedProviderEntity({
					properties: {},
					entitySchemaSlug: schema.id,
					name: "Missing Canonical Language Movie",
					externalId: `ryotql-status-${crypto.randomUUID()}`,
					providerId: providerWithoutCanonicalLanguage.providerId,
				}),
				(entity) =>
					getBackendClient()
						.call(
							(c) => c.testSupport.deleteGlobalEntities({ payload: { ids: [entity.id] } }),
							adminHeaders,
						)
						.pipe(Effect.orDie, Effect.asVoid),
			);

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
