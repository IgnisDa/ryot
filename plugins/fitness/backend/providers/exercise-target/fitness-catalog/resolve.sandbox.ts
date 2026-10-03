import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { exerciseTargetCatalog } from "../../../../shared/taxonomy";
import { resolveTaxonomyEntry } from "../../taxonomy";

export const manifest = defineManifest({
	kind: "provider",
	capabilities: [],
	requiredPluginConfigKeys: [],
	name: "Exercise Target Fitness Catalog Resolve",
	slug: "exercise-target.fitness-catalog.resolve",
});

export default defineProvider({
	manifest,
	operation: "resolve",
	run: (input) => resolveTaxonomyEntry(input, exerciseTargetCatalog),
});
