import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { exerciseEquipmentCatalog } from "../../../../shared/taxonomy";
import { getTaxonomyDetails } from "../../taxonomy";

export const manifest = defineManifest({
	kind: "provider",
	name: "Exercise Equipment Fitness Catalog Details",
	slug: "exercise-equipment.fitness-catalog.details",
});

export default defineProvider({
	manifest,
	operation: "details",
	run: (input) => getTaxonomyDetails(input, exerciseEquipmentCatalog),
});
