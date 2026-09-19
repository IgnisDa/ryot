import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { exerciseTargetCatalog } from "../../../../shared/taxonomy";
import { searchTaxonomyCatalog } from "../../taxonomy";

export const manifest = defineManifest({
	kind: "provider",
	capabilities: [],
	name: "Exercise Target Fitness Catalog Search",
	slug: "exercise-target.fitness-catalog.search",
});

export default defineProvider({
	manifest,
	operation: "search",
	run: (input) => searchTaxonomyCatalog(input, exerciseTargetCatalog),
});
