import { describe, expect, it } from "vitest";

import { decodeServerOrigin } from "#/api/origin";

import { artifactGrantSrc, retainArtifactRuntime } from "./page-host";

it("resolves artifact grants against the selected server origin in a native client", () => {
	const src = "/api/client-pages/artifacts/grant-token/index.html";
	expect(
		artifactGrantSrc({ userId: "user", serverUrl: decodeServerOrigin("https://app.ryot.io") }, src),
	).toBe("https://app.ryot.io/api/client-pages/artifacts/grant-token/index.html");
	expect(
		artifactGrantSrc(
			{ userId: "user", serverUrl: decodeServerOrigin("http://192.168.1.5:3000") },
			src,
		),
	).toBe("http://192.168.1.5:3000/api/client-pages/artifacts/grant-token/index.html");
});

describe("artifact iframe retention", () => {
	it("keeps three runtimes and evicts the least recently used artifact", () => {
		let frames = new Map<string, object>();
		const a = {};
		frames = retainArtifactRuntime(frames, "a", a);
		frames = retainArtifactRuntime(frames, "b", {});
		frames = retainArtifactRuntime(frames, "c", {});
		frames = retainArtifactRuntime(frames, "a", a);
		frames = retainArtifactRuntime(frames, "d", {});
		expect([...frames.keys()]).toEqual(["c", "a", "d"]);
		expect(frames.get("a")).toBe(a);
	});
});
