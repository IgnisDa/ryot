import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineProvider } from "@ryot-app/plugin-backend-sdk/provider";

import { exerciseEquipmentCatalog } from "../../../../shared/taxonomy";
import { searchTaxonomyCatalog } from "../../taxonomy";

export const manifest = defineManifest({
	kind: "provider",
	name: "Exercise Equipment Fitness Catalog Search",
	slug: "exercise-equipment.fitness-catalog.search",
});

export default defineProvider({
	manifest,
	operation: "search",
	run: (input) => searchTaxonomyCatalog(input, exerciseEquipmentCatalog),
});
