import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { exerciseTargetCatalog } from "../../../../shared/taxonomy";
import { getTaxonomyDetails } from "../../taxonomy";

export const manifest = defineManifest({
	kind: "provider",
	name: "Exercise Target Fitness Catalog Details",
	slug: "exercise-target.fitness-catalog.details",
});

export default defineProvider({
	manifest,
	operation: "details",
	run: (input) => getTaxonomyDetails(input, exerciseTargetCatalog),
});
