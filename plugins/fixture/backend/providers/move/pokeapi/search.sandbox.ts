import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	capabilities: ["httpCall"],
	name: "PokeAPI Move Search",
	slug: "move.pokeapi.search",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	searchOptionsSchema: {
		unknownKeys: "strict",
		fields: {
			damageClass: {
				type: "enum",
				label: "Damage class",
				description: "Only include moves of this damage class",
				choices: {
					kind: "static",
					values: [
						{ value: "physical", label: "Physical" },
						{ value: "special", label: "Special" },
						{ value: "status", label: "Status" },
					],
				},
			},
			generation: {
				type: "enum",
				label: "Generation",
				description: "Only include moves introduced in this generation",
				choices: {
					kind: "static",
					values: [
						{ value: "generation-i", label: "Generation I" },
						{ value: "generation-ii", label: "Generation II" },
						{ value: "generation-iii", label: "Generation III" },
						{ value: "generation-iv", label: "Generation IV" },
						{ value: "generation-v", label: "Generation V" },
						{ value: "generation-vi", label: "Generation VI" },
						{ value: "generation-vii", label: "Generation VII" },
						{ value: "generation-viii", label: "Generation VIII" },
						{ value: "generation-ix", label: "Generation IX" },
					],
				},
			},
			typeNames: {
				label: "Types",
				type: "enum-array",
				description: "Only include moves of any selected type",
				choices: {
					kind: "static",
					values: [
						{ value: "bug", label: "Bug" },
						{ value: "dark", label: "Dark" },
						{ value: "dragon", label: "Dragon" },
						{ value: "electric", label: "Electric" },
						{ value: "fairy", label: "Fairy" },
						{ value: "fighting", label: "Fighting" },
						{ value: "fire", label: "Fire" },
						{ value: "flying", label: "Flying" },
						{ value: "ghost", label: "Ghost" },
						{ value: "grass", label: "Grass" },
						{ value: "ground", label: "Ground" },
						{ value: "ice", label: "Ice" },
						{ value: "normal", label: "Normal" },
						{ value: "poison", label: "Poison" },
						{ value: "psychic", label: "Psychic" },
						{ value: "rock", label: "Rock" },
						{ value: "steel", label: "Steel" },
						{ value: "water", label: "Water" },
					],
				},
			},
		},
	},
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
