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
import { assertCompleted, assertCondition, assertPresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const RUN_LIVE =
	process.env.RUN_LIVE_PROVIDER_TESTS === "1" || process.env.RUN_LIVE_PROVIDER_TESTS === "true";

const PROVIDER_SLUG = "pokemon.pokeapi";
const SAVED_VIEW_SLUG = "all-pokemon";

describe.skipIf(!RUN_LIVE)("live fixture provider smoke (real external APIs)", () => {
	it.live(
		"searches PokeAPI with advanced options and imports a real Pokemon",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const pluginSlug = PluginSlug.make(`fixture-pokeapi-${crypto.randomUUID()}`);
				const pluginPackage = yield* fixtureClientPluginPackage("A", "", pluginSlug);
				const installation = yield* Effect.acquireRelease(
					installPrivatePluginPackage({ client, config: {}, pluginPackage }).pipe(
						Effect.andThen(settledPrivateInstallation(client, pluginSlug)),
					),
					() => releasePrivatePlugin(client, pluginSlug),
				);
				expect(installation.health).toBe("ready");

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
				expect(view.name).toBe("All Pokemon");
				expect(view.entitySchemaSlug).toBe(schema.id);
				expect(view.layouts.grid.titleField).toBe("title");
				expect(view.layouts.grid.imageField).toBe("image");
				expect(view.layouts.table.columns.map(({ label }) => label)).toEqual([
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
});
