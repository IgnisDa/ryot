import { describe, expect, it } from "vitest";

import { fixturePlugin } from "./plugin";

describe("fixture client registration", () => {
	it("registers existing demonstrations and the Pokemon entity page as public pages", () => {
		expect(fixturePlugin.client.routes).toEqual({
			"/": "fixture-home",
			"/full-bleed": "fixture-full-bleed",
			"/details/$itemId": "fixture-details",
		});
		expect(fixturePlugin.client.notFoundPage).toBe("fixture-not-found");
		expect(fixturePlugin.client.entities).toEqual({
			pokemon: {
				detailPage: "pokemon-detail",
				listPresentation: "pokemon-row",
				gridPresentation: "pokemon-card",
			},
		});
		expect(fixturePlugin.client.exports).toMatchObject({
			"fixture-home": { kind: "page", entry: "client/home.tsx" },
			"fixture-details": { kind: "page", entry: "client/details.tsx" },
			"fixture-not-found": { kind: "page", entry: "client/not-found.tsx" },
			"fixture-full-bleed": { kind: "page", entry: "client/full-bleed.tsx" },
			"pokemon-detail": { kind: "page", entry: "client/pokemon-detail.tsx" },
			"pokemon-row": { kind: "presentation", entry: "client/pokemon-row.ts" },
			"pokemon-card": { kind: "presentation", entry: "client/pokemon-card.ts" },
			"pokemon-picker": { kind: "component", entry: "client/pokemon-picker.tsx" },
		});
		expect(fixturePlugin.client.exports).not.toHaveProperty("pokemon-grid");
		expect(fixturePlugin.client.exports).not.toHaveProperty("pokemon-list");
	});
});
