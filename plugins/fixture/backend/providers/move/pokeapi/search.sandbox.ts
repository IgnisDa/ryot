import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { search } from "./shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "PokeAPI Move Search",
	slug: "move.pokeapi.search",
	searchOptionsSchema: {
		unknownKeys: "strict",
		fields: {
			damageClass: {
				type: "enum",
				label: { key: "property.damage-class" },
				hint: { key: "property.damage-class-hint" },
				description: "Only include moves of this damage class",
				choices: {
					kind: "static",
					values: [
						{ value: "physical", label: { key: "choice.physical" } },
						{ value: "special", label: { key: "choice.special" } },
						{ value: "status", label: { key: "choice.status" } },
					],
				},
			},
			generation: {
				type: "enum",
				label: { key: "property.generation" },
				hint: { key: "property.generation-hint" },
				description: "Only include moves introduced in this generation",
				choices: {
					kind: "static",
					values: [
						{ value: "generation-i", label: { key: "choice.generation-i" } },
						{ value: "generation-ii", label: { key: "choice.generation-ii" } },
						{ value: "generation-iii", label: { key: "choice.generation-iii" } },
						{ value: "generation-iv", label: { key: "choice.generation-iv" } },
						{ value: "generation-v", label: { key: "choice.generation-v" } },
						{ value: "generation-vi", label: { key: "choice.generation-vi" } },
						{ value: "generation-vii", label: { key: "choice.generation-vii" } },
						{ value: "generation-viii", label: { key: "choice.generation-viii" } },
						{ value: "generation-ix", label: { key: "choice.generation-ix" } },
					],
				},
			},
			typeNames: {
				type: "enum-array",
				label: { key: "property.types" },
				hint: { key: "property.move-types-hint" },
				description: "Only include moves of any selected type",
				choices: {
					kind: "static",
					values: [
						{ value: "bug", label: { key: "choice.bug" } },
						{ value: "dark", label: { key: "choice.dark" } },
						{ value: "dragon", label: { key: "choice.dragon" } },
						{ value: "electric", label: { key: "choice.electric" } },
						{ value: "fairy", label: { key: "choice.fairy" } },
						{ value: "fighting", label: { key: "choice.fighting" } },
						{ value: "fire", label: { key: "choice.fire" } },
						{ value: "flying", label: { key: "choice.flying" } },
						{ value: "ghost", label: { key: "choice.ghost" } },
						{ value: "grass", label: { key: "choice.grass" } },
						{ value: "ground", label: { key: "choice.ground" } },
						{ value: "ice", label: { key: "choice.ice" } },
						{ value: "normal", label: { key: "choice.normal" } },
						{ value: "poison", label: { key: "choice.poison" } },
						{ value: "psychic", label: { key: "choice.psychic" } },
						{ value: "rock", label: { key: "choice.rock" } },
						{ value: "steel", label: { key: "choice.steel" } },
						{ value: "water", label: { key: "choice.water" } },
					],
				},
			},
		},
	},
});

export default defineProvider({ manifest, run: search.run, operation: "search" });
