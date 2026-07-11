import { definePlugin } from "@ryot-app/contract/modules/plugins/manifest";
import {
	integerField,
	managedAssetItemSchema,
	stringArrayField,
	stringField,
} from "@ryot-app/contract/schema/core";

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
	client: {
		apiVersion: 1,
		entry: "client/index.tsx",
		notFoundPage: "fixture-not-found",
		entities: {
			pokemon: {
				detailPage: "pokemon-detail",
				gridPresentation: "pokemon-card",
				listPresentation: "pokemon-row",
			},
		},
		routes: {
			"/": "fixture-home",
			"/full-bleed": "fixture-full-bleed",
			"/details/$itemId": "fixture-details",
		},
		exports: {
			"fixture-home": {
				kind: "page",
				entry: "client/home.tsx",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
			},
			"fixture-not-found": {
				kind: "page",
				entry: "client/not-found.tsx",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
			},
			"fixture-full-bleed": {
				kind: "page",
				entry: "client/full-bleed.tsx",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
			},
			"fixture-details": {
				kind: "page",
				entry: "client/details.tsx",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
			},
			"pokemon-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				entry: "client/pokemon-detail.tsx",
				automaticEntityPresentations: false,
			},
			"pokemon-types": {
				kind: "component",
				entry: "client/pokemon-types.tsx",
				automaticEntityPresentations: false,
			},
			"pokemon-picker": {
				kind: "component",
				entry: "client/pokemon-picker.tsx",
				automaticEntityPresentations: false,
			},
			"pokemon-card": {
				kind: "presentation",
				entry: "client/pokemon-card.ts",
				automaticEntityPresentations: false,
			},
			"pokemon-row": {
				kind: "presentation",
				entry: "client/pokemon-row.ts",
				automaticEntityPresentations: false,
			},
		},
	},
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
					baseExperience: integerField(
						"Base Experience",
						"Base experience gained for defeating this Pokémon",
					),
					images: {
						type: "array",
						label: "Images",
						items: managedAssetItemSchema,
						description: "Official artwork for this Pokémon",
					},
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
					power: integerField("Power", "Base power of this move"),
					target: stringField("Target", "What this move targets"),
					pp: integerField("PP", "Base power points of this move"),
					type: stringField("Type", "Elemental type of this move"),
					effect: stringField("Effect", "Short English effect description"),
					sourceUrl: stringField("Source Url", "Link to the PokeAPI resource"),
					accuracy: integerField("Accuracy", "Accuracy percentage of this move"),
					priority: integerField("Priority", "Turn priority bracket of this move"),
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
