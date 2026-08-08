import { expect, it } from "vitest";

import { normalizeEntityIds } from "./entity-ids";

it("normalizes entity IDs as a deterministic set", () => {
	const entityIds = ["entity-2", "entity-1", "entity-2"];

	expect(normalizeEntityIds(entityIds)).toEqual(["entity-1", "entity-2"]);
	expect(entityIds).toEqual(["entity-2", "entity-1", "entity-2"]);
});

it("normalizes equal sets identically regardless of input order", () => {
	expect(normalizeEntityIds(["entity-2", "entity-1"])).toEqual(
		normalizeEntityIds(["entity-1", "entity-2"]),
	);
});
