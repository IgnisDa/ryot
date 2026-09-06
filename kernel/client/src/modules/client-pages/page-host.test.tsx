import { describe, expect, it } from "vitest";

import { decodeServerOrigin } from "#/api/origin";

import { documentGrantSrc, retainCompositionRuntime } from "./page-host";

it("resolves document grants against the selected server origin in a native client", () => {
	const src = "/api/client-pages/documents/grant-token";
	expect(
		documentGrantSrc({ userId: "user", serverUrl: decodeServerOrigin("https://app.ryot.io") }, src),
	).toBe("https://app.ryot.io/api/client-pages/documents/grant-token");
	expect(
		documentGrantSrc(
			{ userId: "user", serverUrl: decodeServerOrigin("http://192.168.1.5:3000") },
			src,
		),
	).toBe("http://192.168.1.5:3000/api/client-pages/documents/grant-token");
});

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
