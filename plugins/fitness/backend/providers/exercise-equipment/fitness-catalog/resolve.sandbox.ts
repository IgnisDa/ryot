import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { exerciseEquipmentCatalog } from "../../../../shared/taxonomy";
import { resolveTaxonomyEntry } from "../../taxonomy";

export const manifest = defineManifest({
	kind: "provider",
	capabilities: [],
	name: "Exercise Equipment Fitness Catalog Resolve",
	slug: "exercise-equipment.fitness-catalog.resolve",
});

export default defineProvider({
	manifest,
	operation: "resolve",
	run: (input) => resolveTaxonomyEntry(input, exerciseEquipmentCatalog),
});
