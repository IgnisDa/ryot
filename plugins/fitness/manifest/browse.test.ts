import {
	browseConsistencyIssue,
	browseIssue,
} from "@ryot-app/kernel-backend/modules/definitions/browse-validation";
import { revisionDefinitions } from "@ryot-app/kernel-backend/modules/definitions/source";
import { describe, expect, it } from "vitest";

import { fitnessPlugin } from "./plugin";

const entitySchemas = revisionDefinitions("fitness-plugin", {
	...fitnessPlugin,
	scripts: [],
}).entitySchemas;

const browse = (slug: string) =>
	entitySchemas.find((candidate) => candidate.slug === slug)?.browse?.fields ?? [];

describe("fitness browse declarations", () => {
	it("passes install validation for every entity schema", () => {
		expect(browseConsistencyIssue(entitySchemas)).toBeUndefined();
		for (const schema of entitySchemas) {
			expect(schema.browse && browseIssue(schema.browse), schema.slug).toBeUndefined();
		}
	});

	it("declares exercise and workout template fields", () => {
		expect(browse("exercise").map(({ key }) => key)).toEqual([
			"kind",
			"level",
			"force",
			"mechanic",
			"muscles",
			"equipment",
			"lastPerformed",
			"timesPerformed",
		]);
		expect(browse("exercise")[1]).toMatchObject({
			type: "enum",
			label: "Level",
			choices: expect.arrayContaining([{ value: "beginner", label: "beginner" }]),
		});
		expect(browse("exercise")[4]).toMatchObject({
			kind: "relationship",
			relationship: { slug: "exercise-targets" },
		});
		expect(browse("workout-template").map(({ key }) => key)).toEqual(["created"]);
		expect(browse("workout")).toEqual([]);
	});
});
