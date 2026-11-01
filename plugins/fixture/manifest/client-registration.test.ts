import { describe, expect, it } from "vitest";

import { fixturePlugin } from "./plugin";

describe("fixture client registration", () => {
	it("registers existing demonstrations and the Pokemon entity page as public pages", () => {
		expect(fixturePlugin.client.routes).toEqual({
			"/": "fixture-home",
			"/full-bleed": "fixture-full-bleed",
			"/details/$itemId": "fixture-details",
			"/all-field-controls/new": "all-field-controls-create",
		});
		expect(fixturePlugin.client.notFoundPage).toBe("fixture-not-found");
		expect(fixturePlugin.client.entities).toEqual({
			"all-field-controls": { createRoute: "/all-field-controls/new" },
			move: { listPresentation: "move-row", gridPresentation: "move-card" },
			pokemon: {
				detailPage: "pokemon-detail",
				listPresentation: "pokemon-row",
				gridPresentation: "pokemon-card",
			},
		});
		expect(fixturePlugin.client.exports).toMatchObject({
			"fixture-home": { kind: "page", entry: "client/home.tsx" },
			"fixture-details": { kind: "page", entry: "client/details.tsx" },
			"move-row": { kind: "presentation", entry: "client/move-row.ts" },
			"move-card": { kind: "presentation", entry: "client/move-card.ts" },
			"fixture-not-found": { kind: "page", entry: "client/not-found.tsx" },
			"fixture-full-bleed": { kind: "page", entry: "client/full-bleed.tsx" },
			"pokemon-detail": { kind: "page", entry: "client/pokemon-detail.tsx" },
			"pokemon-row": { kind: "presentation", entry: "client/pokemon-row.ts" },
			"pokemon-card": { kind: "presentation", entry: "client/pokemon-card.ts" },
			"pokemon-picker": { kind: "component", entry: "client/pokemon-picker.tsx" },
			"all-field-controls-create": { kind: "page", entry: "client/all-field-controls-create.tsx" },
		});
		expect(fixturePlugin.client.exports).not.toHaveProperty("pokemon-grid");
		expect(fixturePlugin.client.exports).not.toHaveProperty("pokemon-list");
	});
});
