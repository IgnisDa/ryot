import { assert, expect, layer } from "@effect/vitest";
import { EnrichmentState } from "@ryot-app/contract/modules/entities/schemas";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type { SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { emptySandboxExecutionMetadata } from "@ryot-app/contract/testing";
import {
	column,
	defineRecipe,
	inArray,
	literal,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer, Result, Schema } from "effect";

import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { DatabaseSession } from "#platform/db/session";
import { entityEnrichmentRequest } from "#schema/tables/enrichment";
import { entity } from "#schema/tables/entities";
import { entityTranslation } from "#schema/tables/translations";

import { RyotQLService } from "./service";

const owner = UserId.make("owner");
const recipient = UserId.make("recipient");
const generation = "test-account-generation";
const populatedAt = new Date("2026-10-26T00:00:00.000Z");
const canonicalProperties = { kind: "one", name: "Canonical property" };

const enrichmentEntityRecipe = defineRecipe((id: EntityId) => {
	const source = table("entity", "entity");
	return {
		map: ({ entities }) => Result.succeed(entities.items),
		queries: {
			entities: selectedRows(source, {
				limit: 1,
				where: inArray(column(source, "id"), [literal(id)]),
				selection: {
					id: selectedField(column(source, "id"), EntityId),
					name: selectedField(column(source, "name"), Schema.String),
					populationStatus: selectedField(column(source, "populationStatus"), EnrichmentState),
					translationStatus: selectedField(column(source, "translationStatus"), EnrichmentState),
					properties: selectedField(
						column(source, "properties"),
						Schema.Record(Schema.String, JsonValue),
					),
					relatedPopulationStatus: selectedField(
						column(source, "relatedPopulationStatus"),
						EnrichmentState,
					),
				},
			}),
		},
	};
});

class EnrichmentCatalogFixture extends Context.Service<
	EnrichmentCatalogFixture,
	{ readonly pluginId: string; readonly providerId: SandboxProviderId }
>()("test/EnrichmentCatalogFixture") {}

const catalogLayer = Layer.unwrap(
	Effect.gen(function* () {
		const base = revisionPackage("enrichment-catalog", "one", "record");
		const translationScript = {
			...emptySandboxExecutionMetadata,
			kind: "provider",
			name: "Translate",
			providerOperation: "translate",
			slug: "enrichment-catalog.translate",
			entry: "backend/translate.sandbox.ts",
			translationInputs: { record: ["name"] },
			providerSlug: "enrichment-catalog-provider",
		} satisfies PluginManifest["scripts"][number];
		const { entry, ...metadata } = translationScript;
		const [providerDefinition] = base.manifest.providers;
		assert(providerDefinition);
		const installed = yield* installRevisionPackage({
			...base,
			scripts: [
				...base.scripts,
				{
					entry,
					metadata,
					compiledFormat: 1,
					slug: metadata.slug,
					name: metadata.name,
					contentHash: "translation",
					compiledCode: "translation",
				},
			],
			manifest: {
				...base.manifest,
				scripts: [...base.manifest.scripts, translationScript],
				providers: [
					{
						...providerDefinition,
						information: { ...providerDefinition.information, canonicalLanguage: "en" },
					},
				],
			},
		});
		const provider = yield* (yield* PluginRuntimeResolver).findProviderAvailableToUserByReference(
			owner,
			{ slug: "enrichment-catalog-provider", owner: definitionOwner(installed.pluginId) },
		);
		assert(provider);
		return RyotQLService.layer.pipe(
			Layer.merge(
				Layer.succeed(EnrichmentCatalogFixture, {
					providerId: provider.id,
					pluginId: installed.pluginId,
				}),
			),
		);
	}),
).pipe(Layer.provideMerge(revisionDatabaseLayer));

const seedEntity = Effect.fnUntraced(function* (id: string, contentGeneration = 1) {
	const fixture = yield* EnrichmentCatalogFixture;
	yield* (yield* DatabaseSession).run((db) =>
		db
			.insert(entity)
			.values({
				id,
				populatedAt,
				externalId: id,
				contentGeneration,
				name: "Canonical name",
				entitySchemaSlug: "record",
				providerId: fixture.providerId,
				properties: canonicalProperties,
				entitySchemaPluginId: fixture.pluginId,
			}),
	);
	return EntityId.make(id);
});

const appendRequest = Effect.fnUntraced(function* (
	entityId: EntityId,
	id: string,
	patch: Partial<typeof entityEnrichmentRequest.$inferInsert> = {},
) {
	const fixture = yield* EnrichmentCatalogFixture;
	yield* (yield* DatabaseSession).run((db) =>
		db
			.insert(entityEnrichmentRequest)
			.values({
				id,
				entityId,
				payload: {},
				level: "full",
				language: null,
				scopeUserId: null,
				state: "succeeded",
				externalId: entityId,
				requesterUserId: owner,
				operation: "population",
				pluginId: fixture.pluginId,
				entitySchemaSlug: "record",
				providerId: fixture.providerId,
				requesterGeneration: generation,
				workflowName: "TestEnrichmentWorkflow",
				...patch,
			}),
	);
});

const readEntity = Effect.fnUntraced(function* (
	userId: UserId,
	entityId: EntityId,
	language: string | null = null,
) {
	const recipe = enrichmentEntityRecipe(entityId);
	const response = yield* (yield* RyotQLService).executeForUser(
		userId,
		language,
		"kernel",
		recipe.document,
	);
	const [row] = Result.getOrThrow(recipe.decode(response));
	assert(row);
	return row;
});

layer(catalogLayer)((test) => {
	test.effect(
		"selects only the current actor's account work and never lets newer system failures override it",
		() =>
			Effect.gen(function* () {
				for (const state of ["succeeded", "failed"] as const) {
					const entityId = yield* seedEntity(`actor-${state}`);
					yield* appendRequest(entityId, `${state}-owner`, { state });
					yield* appendRequest(entityId, `${state}-system`, {
						state: "failed",
						requesterUserId: null,
						requesterGeneration: null,
					});
					yield* appendRequest(entityId, `${state}-retired-owner`, {
						state: "cancelled",
						requesterGeneration: "retired-generation",
					});
					const own = yield* readEntity(owner, entityId);
					expect(own.populationStatus).toEqual({ state, availability: "complete" });
					expect(own.relatedPopulationStatus).toEqual({ state, availability: "missing" });
					const uninvolved = yield* readEntity(recipient, entityId);
					expect(uninvolved.populationStatus).toEqual({ state: "idle", availability: "complete" });
					expect(uninvolved.relatedPopulationStatus).toEqual({
						state: "idle",
						availability: "missing",
					});
					yield* appendRequest(entityId, `${state}-recipient`, {
						state: "running",
						requesterUserId: recipient,
					});
					yield* appendRequest(entityId, `${state}-retired-recipient`, {
						state: "failed",
						requesterUserId: recipient,
						requesterGeneration: "retired-generation",
					});
					expect((yield* readEntity(recipient, entityId)).populationStatus).toEqual({
						state: "running",
						availability: "complete",
					});
					expect((yield* readEntity(owner, entityId)).populationStatus).toEqual({
						state,
						availability: "complete",
					});
				}
			}),
	);

	test.effect(
		"hides stale translation content and work until the current generation is translated, including negative caches",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const entityId = yield* seedEntity("localized", 2);
				yield* session.run((db) =>
					db
						.insert(entityTranslation)
						.values({
							entityId,
							populatedAt,
							language: "es",
							name: "Stale name",
							sourceContentGeneration: 1,
							properties: { name: "Stale property" },
						}),
				);
				yield* appendRequest(entityId, "stale-translation", {
					level: null,
					language: "es",
					state: "failed",
					operation: "translation",
					sourceContentGeneration: 1,
				});
				const stale = yield* readEntity(owner, entityId, "es");
				expect(stale.name).toBe("Canonical name");
				expect(stale.properties).toEqual(canonicalProperties);
				expect(stale.translationStatus).toEqual({ state: "idle", availability: "missing" });
				yield* session.run((db) =>
					db
						.update(entityTranslation)
						.set({
							name: "Current name",
							sourceContentGeneration: 2,
							properties: { name: "Current property" },
						})
						.where(eq(entityTranslation.entityId, entityId)),
				);
				yield* appendRequest(entityId, "current-translation", {
					level: null,
					language: "es",
					operation: "translation",
					sourceContentGeneration: 2,
				});
				yield* appendRequest(entityId, "system-translation-failed", {
					level: null,
					language: "es",
					state: "failed",
					requesterUserId: null,
					operation: "translation",
					requesterGeneration: null,
					sourceContentGeneration: 2,
				});
				const current = yield* readEntity(owner, entityId, "es");
				expect(current.name).toBe("Current name");
				expect(current.properties).toEqual({ kind: "one", name: "Current property" });
				expect(current.translationStatus).toEqual({ state: "succeeded", availability: "complete" });
				expect((yield* readEntity(recipient, entityId, "es")).translationStatus).toEqual({
					state: "idle",
					availability: "complete",
				});
				yield* session.run((db) =>
					db.update(entity).set({ contentGeneration: 3 }).where(eq(entity.id, entityId)),
				);
				const changed = yield* readEntity(owner, entityId, "es");
				expect(changed.name).toBe("Canonical name");
				expect(changed.properties).toEqual(canonicalProperties);
				expect(changed.translationStatus).toEqual({ state: "idle", availability: "missing" });
				yield* session.run((db) =>
					db
						.update(entityTranslation)
						.set({ name: null, properties: null, sourceContentGeneration: 3 })
						.where(eq(entityTranslation.entityId, entityId)),
				);
				yield* appendRequest(entityId, "negative-translation", {
					level: null,
					language: "es",
					operation: "translation",
					sourceContentGeneration: 3,
				});
				const negative = yield* readEntity(owner, entityId, "es");
				expect(negative.name).toBe("Canonical name");
				expect(negative.properties).toEqual(canonicalProperties);
				expect(negative.translationStatus).toEqual({ state: "succeeded", availability: "none" });
			}),
	);
});
