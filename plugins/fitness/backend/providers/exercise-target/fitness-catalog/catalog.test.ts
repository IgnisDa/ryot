import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { describe, expect, it } from "vitest";

import { exerciseEquipmentCatalog, exerciseTargetCatalog } from "../../../../shared/taxonomy";
import { getTaxonomyDetails, resolveTaxonomyEntry, searchTaxonomyCatalog } from "../../taxonomy";

describe("fitness taxonomy catalogs", () => {
	it("searches labels and IDs with pagination", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const targets = yield* searchTaxonomyCatalog(
					{ page: 2, query: "", pageSize: 5 },
					exerciseTargetCatalog,
				);
				expect(targets).toEqual({
					details: { nextPage: 3, totalItems: 17 },
					items: [
						{ title: "Calves", externalId: "calves" },
						{ title: "Glutes", externalId: "glutes" },
						{ title: "Triceps", externalId: "triceps" },
						{ title: "Forearms", externalId: "forearms" },
						{ title: "Abductors", externalId: "abductors" },
					],
				});

				const equipment = yield* searchTaxonomyCatalog(
					{ page: 1, pageSize: 10, query: "BALL" },
					exerciseEquipmentCatalog,
				);
				expect(equipment).toEqual({
					details: { totalItems: 2, nextPage: null },
					items: [
						{ title: "Exercise Ball", externalId: "exercise_ball" },
						{ title: "Medicine Ball", externalId: "medicine_ball" },
					],
				});
			}),
		));

	it("returns canonical details and reports missing identities", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const target = yield* getTaxonomyDetails(
					{ externalId: "lower_back" },
					exerciseTargetCatalog,
				);
				expect(target).toEqual({ name: "Lower Back", properties: { kind: "muscle_region" } });

				const equipment = yield* getTaxonomyDetails(
					{ externalId: "ez_curl_bar" },
					exerciseEquipmentCatalog,
				);
				expect(equipment).toEqual({ properties: {}, name: "EZ Curl Bar" });

				const missing = yield* Effect.flip(
					getTaxonomyDetails({ externalId: "Lower Back" }, exerciseTargetCatalog),
				);
				expect(missing).toMatchObject({
					_tag: "FitnessTaxonomyError",
					message: "Taxonomy entry not found: Lower Back",
				});
			}),
		));

	it("resolves only exact normalized names and canonical IDs", () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const targetName = yield* resolveTaxonomyEntry(
					{ value: " LOWER BACK ", identifierType: "name" },
					exerciseTargetCatalog,
				);
				expect(targetName).toEqual({ externalId: "lower_back" });

				const targetId = yield* resolveTaxonomyEntry(
					{ value: "LOWER BACK", identifierType: "external-id" },
					exerciseTargetCatalog,
				);
				expect(targetId).toEqual({ externalId: "lower_back" });

				const equipmentName = yield* resolveTaxonomyEntry(
					{ value: "ez curl bar", identifierType: "name" },
					exerciseEquipmentCatalog,
				);
				expect(equipmentName).toEqual({ externalId: "ez_curl_bar" });

				const partial = yield* resolveTaxonomyEntry(
					{ value: "lower", identifierType: "name" },
					exerciseTargetCatalog,
				);
				expect(partial).toEqual({ externalId: null });
			}),
		));
});
