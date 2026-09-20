import { describe, expect, it } from "vitest";

import { retainCompositionRuntime } from "./page-host";

describe("composition iframe retention", () => {
	it("keeps three runtimes and evicts the least recently used composition", () => {
		let frames = new Map<string, object>();
		const a = {};
		frames = retainCompositionRuntime(frames, "a", a);
		frames = retainCompositionRuntime(frames, "b", {});
		frames = retainCompositionRuntime(frames, "c", {});
		frames = retainCompositionRuntime(frames, "a", a);
		frames = retainCompositionRuntime(frames, "d", {});
		expect([...frames.keys()]).toEqual(["c", "a", "d"]);
		expect(frames.get("a")).toBe(a);
	});
});
