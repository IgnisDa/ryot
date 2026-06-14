import { definePlugin } from "@ryot-app/contract/modules/plugins/manifest";
import {
	integerField,
	managedAssetItemSchema,
	stringArrayField,
	stringField,
} from "@ryot-app/contract/schema/core";

import { manifest as greetManifest } from "./backend/greet.sandbox";
import { manifest as pokeapiDetailsManifest } from "./backend/pokeapi-details.sandbox";
import { manifest as pokeapiSearchManifest } from "./backend/pokeapi-search.sandbox";
import { fixtureSavedViews } from "./saved-views";

export const fixturePlugin = definePlugin({
	boot: [],
	crons: [],
	workflows: [],
	signalSchemas: [],
	importSources: [],
	userBootstrap: [],
	httpRateLimits: [],
	relationshipSchemas: [],
	integrationProviders: [],
	savedViews: fixtureSavedViews,
	configSchema: { fields: {}, unknownKeys: "strict" },
	client: { entry: "client/index.tsx", apiVersion: 1 },
	entitySchemas: [
		{
			slug: "pokemon",
			name: "Pokemon",
			icon: "sparkles",
			eventSchemas: [],
			propertiesSchema: {
				fields: {
					types: stringArrayField("Types", "Elemental types of this Pokémon"),
					abilities: stringArrayField("Abilities", "Abilities this Pokémon can have"),
					height: integerField("Height", "Height of this Pokémon in decimetres"),
					weight: integerField("Weight", "Weight of this Pokémon in hectograms"),
					pokedexNumber: integerField("Pokedex Number", "National Pokédex number"),
					sourceUrl: stringField("Source Url", "Link to the PokeAPI resource"),
					images: {
						type: "array",
						label: "Images",
						items: managedAssetItemSchema,
						description: "Official artwork for this Pokémon",
					},
					baseExperience: integerField(
						"Base Experience",
						"Base experience gained for defeating this Pokémon",
					),
				},
			},
		},
	],
	providers: [
		{
			name: "PokeAPI",
			slug: "pokemon.pokeapi",
			rootEntitySchemaSlug: "pokemon",
			information: { source: "pokeapi" },
			operations: { search: "pokemon.pokeapi.search", details: "pokemon.pokeapi.details" },
		},
	],
	scripts: [
		{ ...greetManifest, entry: "backend/greet.sandbox.ts" },
		{
			...pokeapiDetailsManifest,
			providerOperation: "details",
			providerSlug: "pokemon.pokeapi",
			entry: "backend/pokeapi-details.sandbox.ts",
		},
		{
			...pokeapiSearchManifest,
			providerOperation: "search",
			providerSlug: "pokemon.pokeapi",
			entry: "backend/pokeapi-search.sandbox.ts",
		},
	],
	operations: [
		{
			auth: "user",
			slug: "greet",
			scriptSlug: "operation.greet",
			description: "Return a deterministic greeting for the caller",
		},
	],
	bindings: {
		eventAutomations: [],
		entityAutomations: [],
		signalAutomations: [],
		relationshipAutomations: [],
		providerEntityImportAutomations: [],
	},
	metadata: {
		icon: "puzzle",
		slug: "fixture",
		name: "Fixture",
		version: "1.0.0",
		description: "A client plugin fixture used by the web client tracer.",
	},
});

export default fixturePlugin;
