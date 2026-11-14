import { describe, expect, it } from "bun:test";

import { mediaAspectOf } from "./schema-aspects";

describe("mediaAspectOf", () => {
	it("reads a known schema's aspect", () => {
		expect(mediaAspectOf("music")).toBe("square");
	});

	it("falls back to a poster for an unknown schema", () => {
		expect(mediaAspectOf("board-game")).toBe("poster");
		expect(mediaAspectOf("toString")).toBe("poster");
	});
});
