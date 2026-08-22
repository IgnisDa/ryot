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
				gridPresentation: "pokemon-grid",
				listPresentation: "pokemon-list",
			},
		});
		expect(fixturePlugin.client.exports).toMatchObject({
			"fixture-home": { kind: "page", entry: "client/home.tsx" },
			"fixture-details": { kind: "page", entry: "client/details.tsx" },
			"fixture-not-found": { kind: "page", entry: "client/not-found.tsx" },
			"fixture-full-bleed": { kind: "page", entry: "client/full-bleed.tsx" },
			"pokemon-detail": { kind: "page", entry: "client/pokemon-detail.tsx" },
			"pokemon-grid": { kind: "presentation", entry: "client/pokemon-grid-presentation.ts" },
			"pokemon-list": { kind: "presentation", entry: "client/pokemon-list-presentation.ts" },
		});
	});
});
