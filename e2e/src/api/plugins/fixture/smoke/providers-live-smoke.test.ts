import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { providerSearchRecipe } from "@ryot-app/ryotql-recipes/provider-search";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	enqueueProviderEntityImport,
	executeRyotQLRecipe,
	listEntitySchemas,
	listSavedViews,
	fixtureClientPluginPackage,
	installPrivatePluginPackage,
	pollProviderEntityImportResult,
	searchProviderEntities,
	settledPrivateInstallation,
	releasePrivatePlugin,
} from "~/fixtures/kernel";
import {
	assertCompleted,
	assertCondition,
	assertPresent,
	requirePresent,
} from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const RUN_LIVE =
	process.env.RUN_LIVE_PROVIDER_TESTS === "1" || process.env.RUN_LIVE_PROVIDER_TESTS === "true";

const PROVIDER_SLUG = "pokemon.pokeapi";
const SAVED_VIEW_SLUG = "all-pokemon";
const MOVE_PROVIDER_SLUG = "move.pokeapi";
const MOVE_SAVED_VIEW_SLUG = "all-moves";

const installFixture = (label: string) =>
	Effect.gen(function* () {
		const { client } = yield* createAuthenticatedClient();
		const pluginSlug = PluginSlug.make(`fixture-${label}-${crypto.randomUUID()}`);
		const pluginPackage = yield* fixtureClientPluginPackage("A", "", pluginSlug);
		const installation = yield* Effect.acquireRelease(
			installPrivatePluginPackage({ client, config: {}, pluginPackage }).pipe(
				Effect.andThen(settledPrivateInstallation(client, pluginSlug)),
			),
			() => releasePrivatePlugin(client, pluginSlug),
		);
		expect(installation.health).toBe("ready");
		return { client, pluginSlug };
	});

describe.skipIf(!RUN_LIVE)("live fixture provider smoke (real external APIs)", () => {
	it.live(
		"searches PokeAPI with advanced options and imports a real Pokemon",
		() =>
			Effect.gen(function* () {
				const { client, pluginSlug } = yield* installFixture("pokeapi");

				const schemas = yield* listEntitySchemas(client, { pluginSlug, slugs: ["pokemon"] });
				const schema = schemas[0];
				assertPresent(schema, "Expected the fixture-owned 'pokemon' entity schema");
				expect(schema.id).toBe("pokemon");
				expect(schema.pluginSlug).toBe(pluginSlug);
				const searchable = yield* executeRyotQLRecipe(
					client,
					providerSearchRecipe({ rootEntitySchemaSlug: schema.id }),
				);
				const provider = searchable.items.find((row) => row.providerSlug === PROVIDER_SLUG);
				assertPresent(provider, "Expected the fixture PokeAPI provider on the pokemon schema");
				expect(provider.providerName).toBe("PokeAPI");
				expect(provider.rootEntitySchemaSlug).toBe(schema.id);

				assertPresent(provider.searchOptionsSchema, "Expected a PokeAPI search options schema");
				const typeNames = provider.searchOptionsSchema.fields["typeNames"];
				assertPresent(typeNames, "Expected a 'typeNames' search option");
				assertCondition(
					typeNames.type === "enum-array",
					"Expected 'typeNames' to be an enum-array",
				);
				assertCondition(typeNames.choices.kind === "static", "Expected static 'typeNames' choices");
				expect(typeNames.choices.values.map(({ value }) => value)).toContain("electric");
				expect(provider.searchOptionsSchema.fields["includeAlternateForms"]?.type).toBe("boolean");

				const filtered = yield* searchProviderEntities(client, {
					page: 1,
					pageSize: 5,
					query: "pikachu",
					providerId: provider.providerId,
					options: { typeNames: ["electric"], includeAlternateForms: false },
				});
				expect(filtered.rootEntitySchemaSlug).toBe(schema.id);
				const pikachu = filtered.items[0];
				assertPresent(pikachu, "Expected 'pikachu' in the type-filtered PokeAPI results");
				expect(pikachu.title).toBe("Pikachu");
				expect(pikachu.externalId).toBe("25");
				expect(pikachu.imageUrl).toContain("official-artwork/25.png");
				expect(pikachu.metadata).toEqual(["#25", "Electric"]);

				const unfiltered = yield* searchProviderEntities(client, {
					page: 1,
					pageSize: 5,
					query: "bulbasaur",
					providerId: provider.providerId,
				});
				assertCondition(
					unfiltered.items.some((item) => item.externalId === "1"),
					"Expected 'bulbasaur' in the unfiltered PokeAPI results",
				);

				const { jobId } = yield* enqueueProviderEntityImport(client, {
					externalId: pikachu.externalId,
					providerId: provider.providerId,
				});
				const imported = yield* pollProviderEntityImportResult(client, jobId);
				assertCompleted(imported, "PokeAPI import");
				expect(imported.data.name).toBe("Pikachu");
				expect(imported.data.entitySchemaSlug).toBe(schema.id);
				expect(imported.data.properties).toEqual({
					height: 4,
					weight: 60,
					pokedexNumber: 25,
					types: ["Electric"],
					baseExperience: 112,
					abilities: ["Static", "Lightning Rod"],
					sourceUrl: "https://pokeapi.co/api/v2/pokemon/pikachu",
					images: [{ type: "remote", url: expect.stringContaining("official-artwork/25.png") }],
				});

				const views = yield* listSavedViews(client, { pluginSlug });
				const view = views.find(({ slug }) => slug === SAVED_VIEW_SLUG);
				assertPresent(view, "Expected the fixture-owned 'all-pokemon' saved view");
				const viewLayouts = requirePresent(
					view.layouts,
					"Fixture-owned 'all-pokemon' saved view has no layouts",
				);
				expect(view.name).toBe("All Pokemon");
				expect(view.entitySchemaSlug).toBe(schema.id);
				expect(viewLayouts.grid.titleField).toBe("title");
				expect(viewLayouts.grid.imageField).toBe("image");
				expect(viewLayouts.table.columns.map(({ label }) => label)).toEqual([
					"Name",
					"Pokedex Number",
					"Types",
					"Abilities",
					"Height (dm)",
					"Weight (hg)",
					"Base Experience",
				]);
			}),
		180_000,
	);

	it.live(
		"searches PokeAPI moves with enum options and imports a real move",
		() =>
			Effect.gen(function* () {
				const { client, pluginSlug } = yield* installFixture("pokeapi-move");

				const schemas = yield* listEntitySchemas(client, { pluginSlug, slugs: ["move"] });
				const schema = schemas[0];
				assertPresent(schema, "Expected the fixture-owned 'move' entity schema");
				expect(schema.id).toBe("move");
				expect(schema.pluginSlug).toBe(pluginSlug);
				const searchable = yield* executeRyotQLRecipe(
					client,
					providerSearchRecipe({ rootEntitySchemaSlug: schema.id }),
				);
				const provider = searchable.items.find((row) => row.providerSlug === MOVE_PROVIDER_SLUG);
				assertPresent(provider, "Expected the fixture PokeAPI provider on the move schema");
				expect(provider.providerName).toBe("PokeAPI");
				expect(provider.rootEntitySchemaSlug).toBe(schema.id);

				assertPresent(provider.searchOptionsSchema, "Expected a move search options schema");
				const damageClass = provider.searchOptionsSchema.fields["damageClass"];
				assertPresent(damageClass, "Expected a 'damageClass' search option");
				assertCondition(damageClass.type === "enum", "Expected 'damageClass' to be an enum");
				assertCondition(
					damageClass.choices.kind === "static",
					"Expected static 'damageClass' choices",
				);
				expect(damageClass.choices.values.map(({ value }) => value)).toEqual([
					"physical",
					"special",
					"status",
				]);
				const generation = provider.searchOptionsSchema.fields["generation"];
				assertPresent(generation, "Expected a 'generation' search option");
				assertCondition(generation.type === "enum", "Expected 'generation' to be an enum");
				expect(provider.searchOptionsSchema.fields["typeNames"]?.type).toBe("enum-array");

				const filtered = yield* searchProviderEntities(client, {
					page: 1,
					pageSize: 5,
					query: "thunderbolt",
					providerId: provider.providerId,
					options: { typeNames: ["electric"], damageClass: "special" },
				});
				expect(filtered.rootEntitySchemaSlug).toBe(schema.id);
				const thunderbolt = filtered.items[0];
				assertPresent(thunderbolt, "Expected 'thunderbolt' in the filtered move results");
				expect(thunderbolt.title).toBe("Thunderbolt");
				expect(thunderbolt.externalId).toBe("85");
				expect(thunderbolt.imageUrl).toBeUndefined();
				expect(thunderbolt.metadata).toEqual(["#85", "Electric, Special, Power 90"]);

				const unioned = yield* searchProviderEntities(client, {
					page: 1,
					pageSize: 20,
					query: "punch",
					providerId: provider.providerId,
					options: { typeNames: ["electric", "fire"] },
				});
				expect(unioned.items.map(({ title }) => title)).toEqual(["Fire Punch", "Thunder Punch"]);

				const { jobId } = yield* enqueueProviderEntityImport(client, {
					externalId: thunderbolt.externalId,
					providerId: provider.providerId,
				});
				const imported = yield* pollProviderEntityImportResult(client, jobId);
				assertCompleted(imported, "PokeAPI move import");
				expect(imported.data.name).toBe("Thunderbolt");
				expect(imported.data.entitySchemaSlug).toBe(schema.id);
				expect(imported.data.properties).toEqual({
					pp: 15,
					power: 90,
					priority: 0,
					accuracy: 100,
					type: "Electric",
					damageClass: "Special",
					generation: "Generation I",
					target: "Selected Pokemon",
					effect: "Has a chance to paralyze the target.",
					sourceUrl: "https://pokeapi.co/api/v2/move/thunderbolt",
				});

				const status = yield* enqueueProviderEntityImport(client, {
					externalId: "14",
					providerId: provider.providerId,
				});
				const swordsDance = yield* pollProviderEntityImportResult(client, status.jobId);
				assertCompleted(swordsDance, "PokeAPI status move import");
				expect(swordsDance.data.name).toBe("Swords Dance");
				expect(swordsDance.data.properties).toEqual({
					pp: 20,
					power: null,
					priority: 0,
					accuracy: null,
					type: "Normal",
					target: "User",
					damageClass: "Status",
					generation: "Generation I",
					effect: "Raises the user’s Attack by two stages.",
					sourceUrl: "https://pokeapi.co/api/v2/move/swords-dance",
				});

				const views = yield* listSavedViews(client, { pluginSlug });
				const view = views.find(({ slug }) => slug === MOVE_SAVED_VIEW_SLUG);
				assertPresent(view, "Expected the fixture-owned 'all-moves' saved view");
				const viewLayouts = requirePresent(
					view.layouts,
					"Fixture-owned 'all-moves' saved view has no layouts",
				);
				expect(view.name).toBe("All Moves");
				expect(view.entitySchemaSlug).toBe(schema.id);
				expect(viewLayouts.grid.titleField).toBe("title");
				expect(viewLayouts.grid.imageField).toBeNull();
				expect(viewLayouts.table.imageField).toBeNull();
				expect(viewLayouts.table.columns.map(({ label }) => label)).toEqual([
					"Name",
					"Type",
					"Damage Class",
					"Power",
					"Accuracy",
					"PP",
					"Priority",
					"Generation",
				]);
			}),
		180_000,
	);
});
