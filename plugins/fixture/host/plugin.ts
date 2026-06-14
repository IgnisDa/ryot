import { definePlugin } from "@ryot-app/contract/modules/plugins/manifest";
import {
	integerField,
	managedAssetItemSchema,
	stringArrayField,
	stringField,
} from "@ryot-app/contract/schema/core";

import { manifest as greetManifest } from "../backend/operations/greet.sandbox";
import { manifest as moveDetailsManifest } from "../backend/providers/move/pokeapi/details.sandbox";
import { manifest as moveSearchManifest } from "../backend/providers/move/pokeapi/search.sandbox";
import { manifest as pokemonDetailsManifest } from "../backend/providers/pokemon/pokeapi/details.sandbox";
import { manifest as pokemonSearchManifest } from "../backend/providers/pokemon/pokeapi/search.sandbox";
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
		{
			icon: "zap",
			slug: "move",
			name: "Move",
			eventSchemas: [],
			propertiesSchema: {
				fields: {
					pp: integerField("PP", "Base power points of this move"),
					type: stringField("Type", "Elemental type of this move"),
					power: integerField("Power", "Base power of this move"),
					target: stringField("Target", "What this move targets"),
					effect: stringField("Effect", "Short English effect description"),
					accuracy: integerField("Accuracy", "Accuracy percentage of this move"),
					priority: integerField("Priority", "Turn priority bracket of this move"),
					sourceUrl: stringField("Source Url", "Link to the PokeAPI resource"),
					generation: stringField("Generation", "Generation this move was introduced in"),
					damageClass: stringField("Damage Class", "Physical, special, or status damage class"),
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
		{
			name: "PokeAPI",
			slug: "move.pokeapi",
			rootEntitySchemaSlug: "move",
			information: { source: "pokeapi" },
			operations: { search: "move.pokeapi.search", details: "move.pokeapi.details" },
		},
	],
	scripts: [
		{ ...greetManifest, entry: "backend/operations/greet.sandbox.ts" },
		{
			...pokemonDetailsManifest,
			providerOperation: "details",
			providerSlug: "pokemon.pokeapi",
			entry: "backend/providers/pokemon/pokeapi/details.sandbox.ts",
		},
		{
			...pokemonSearchManifest,
			providerOperation: "search",
			providerSlug: "pokemon.pokeapi",
			entry: "backend/providers/pokemon/pokeapi/search.sandbox.ts",
		},
		{
			...moveDetailsManifest,
			providerOperation: "details",
			providerSlug: "move.pokeapi",
			entry: "backend/providers/move/pokeapi/details.sandbox.ts",
		},
		{
			...moveSearchManifest,
			providerOperation: "search",
			providerSlug: "move.pokeapi",
			entry: "backend/providers/move/pokeapi/search.sandbox.ts",
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
