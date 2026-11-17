import { CLIENT_API_VERSION, definePlugin } from "@ryot-app/contract/modules/plugins/manifest";
import {
	integerField,
	managedAssetItemSchema,
	stringArrayField,
	stringField,
} from "@ryot-app/contract/schema/core";
import { operationJsonSchema } from "@ryot-app/plugin-kit/operations";
import { castNumber, column, jsonPath, table } from "@ryot-app/ryotql";

import { movePresentationSource, pokemonPresentationSource } from "../shared/entity-presentations";
import { GreetInput, GreetOutput } from "../shared/greet";
import { catalogMessage } from "../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
import { allFieldControlsSchema } from "./all-field-controls";
import { fixtureCalendarSources } from "./calendar-sources";
import { fixtureSavedViews } from "./saved-views";

export const fixturePlugin = definePlugin({
	crons: [],
	hooks: [],
	workflows: [],
	signalSchemas: [],
	importSources: [],
	userBootstrap: [],
	httpRateLimits: [],
	relationshipSchemas: [],
	integrationProviders: [],
	savedViews: fixtureSavedViews,
	calendarSources: fixtureCalendarSources,
	configSchema: { fields: {}, unknownKeys: "strict" },
	metadata: {
		icon: "puzzle",
		version: "1.0.0",
		packageId: PLUGIN_PACKAGE_ID,
		name: catalogMessage("plugin.name"),
		description: catalogMessage("plugin.description"),
	},
	providers: [
		{
			slug: "pokemon.pokeapi",
			rootEntitySchemaSlug: "pokemon",
			information: { source: "pokeapi" },
			name: catalogMessage("provider.pokeapi.name"),
		},
		{
			slug: "move.pokeapi",
			rootEntitySchemaSlug: "move",
			information: { source: "pokeapi" },
			name: catalogMessage("provider.pokeapi.name"),
		},
	],
	operations: [
		{
			auth: "user",
			slug: "greet",
			title: "Greet",
			demoAccess: "allowed",
			scriptSlug: "operation.greet",
			input: operationJsonSchema(GreetInput),
			output: operationJsonSchema(GreetOutput),
			hints: { readOnly: true, idempotent: true, destructive: false },
			description:
				"Return a greeting for the supplied nonempty name without reading or changing stored data.",
		},
	],
	client: {
		homeView: null,
		apiVersion: CLIENT_API_VERSION,
		notFoundPage: "fixture-not-found",
		routes: {
			"/": "fixture-home",
			"/full-bleed": "fixture-full-bleed",
			"/details/$itemId": "fixture-details",
			"/all-field-controls/new": "all-field-controls-create",
		},
		entities: {
			"all-field-controls": { createRoute: "/all-field-controls/new" },
			move: {
				listPresentation: "move-row",
				gridPresentation: "move-card",
				presentation: {
					owner: movePresentationSource().fields,
					entity: movePresentationSource().fields,
				},
			},
			pokemon: {
				detailPage: "pokemon-detail",
				listPresentation: "pokemon-row",
				gridPresentation: "pokemon-card",
				presentation: {
					owner: pokemonPresentationSource().fields,
					entity: pokemonPresentationSource().fields,
				},
			},
		},
		exports: {
			"move-row": {
				kind: "presentation",
				entry: "client/move-row.ts",
				automaticEntityPresentations: false,
			},
			"move-card": {
				kind: "presentation",
				entry: "client/move-card.ts",
				automaticEntityPresentations: false,
			},
			"pokemon-row": {
				kind: "presentation",
				entry: "client/pokemon-row.ts",
				automaticEntityPresentations: false,
			},
			"pokemon-types": {
				kind: "component",
				entry: "client/pokemon-types.tsx",
				automaticEntityPresentations: false,
			},
			"pokemon-card": {
				kind: "presentation",
				entry: "client/pokemon-card.ts",
				automaticEntityPresentations: false,
			},
			"pokemon-picker": {
				kind: "component",
				entry: "client/pokemon-picker.tsx",
				automaticEntityPresentations: false,
			},
			"fixture-home": {
				kind: "page",
				entry: "client/home.tsx",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
			},
			"fixture-details": {
				kind: "page",
				entry: "client/details.tsx",
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
			"pokemon-detail": {
				kind: "page",
				settingsSchema: { fields: {} },
				entry: "client/pokemon-detail.tsx",
				automaticEntityPresentations: false,
			},
			"all-field-controls-create": {
				kind: "page",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
				entry: "client/all-field-controls-create.tsx",
			},
		},
	},
	entitySchemas: [
		{
			slug: "pokemon",
			icon: "sparkles",
			eventSchemas: [],
			name: catalogMessage("entity-schema.pokemon.name"),
			browse: {
				fields: [
					{
						key: "height",
						kind: "value",
						type: "number",
						label: catalogMessage("property.height"),
						expression: castNumber(
							jsonPath(column(table("entity", "subject"), "properties"), "height"),
						),
					},
				],
			},
			propertiesSchema: {
				fields: {
					types: stringArrayField(
						catalogMessage("property.types"),
						"Elemental types of this Pokémon",
					),
					sourceUrl: stringField(
						catalogMessage("property.source-url"),
						"Link to the PokeAPI resource",
					),
					height: integerField(
						catalogMessage("property.height"),
						"Height of this Pokémon in decimetres",
					),
					weight: integerField(
						catalogMessage("property.weight"),
						"Weight of this Pokémon in hectograms",
					),
					pokedexNumber: integerField(
						catalogMessage("property.pokedex-number"),
						"National Pokédex number",
					),
					abilities: stringArrayField(
						catalogMessage("property.abilities"),
						"Abilities this Pokémon can have",
					),
					baseExperience: integerField(
						catalogMessage("property.base-experience"),
						"Base experience gained for defeating this Pokémon",
					),
					images: {
						type: "array",
						items: managedAssetItemSchema,
						label: catalogMessage("property.images"),
						description: "Official artwork for this Pokémon",
					},
				},
			},
		},
		{
			icon: "zap",
			slug: "move",
			eventSchemas: [],
			name: catalogMessage("entity-schema.move.name"),
			propertiesSchema: {
				fields: {
					power: integerField(catalogMessage("property.power"), "Base power of this move"),
					target: stringField(catalogMessage("property.target"), "What this move targets"),
					pp: integerField(catalogMessage("property.pp"), "Base power points of this move"),
					type: stringField(catalogMessage("property.type"), "Elemental type of this move"),
					effect: stringField(
						catalogMessage("property.effect"),
						"Short English effect description",
					),
					sourceUrl: stringField(
						catalogMessage("property.source-url"),
						"Link to the PokeAPI resource",
					),
					accuracy: integerField(
						catalogMessage("property.accuracy"),
						"Accuracy percentage of this move",
					),
					priority: integerField(
						catalogMessage("property.priority"),
						"Turn priority bracket of this move",
					),
					generation: stringField(
						catalogMessage("property.generation"),
						"Generation this move was introduced in",
					),
					damageClass: stringField(
						catalogMessage("property.damage-class"),
						"Physical, special, or status damage class",
					),
				},
			},
		},
		allFieldControlsSchema,
	],
});

export default fixturePlugin;
