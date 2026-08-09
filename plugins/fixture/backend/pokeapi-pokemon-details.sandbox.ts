import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { details } from "./pokeapi-pokemon";

export const manifest = defineManifest({
	kind: "provider",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "PokeAPI Pokémon Details",
	slug: "pokemon.pokeapi.details",
});

export default defineProvider({ manifest, operation: "details", run: details.run });
