import { describe, expect, it } from "vitest";

import { PluginArtifactsGroup } from "./contract";

describe("PluginArtifactsGroup", () => {
	it("defines the public artifact endpoint", () => {
		const endpoint = PluginArtifactsGroup.endpoints.artifact;

		expect(endpoint.method).toBe("GET");
		expect(endpoint.path).toBe("/plugins/artifacts/:artifactHash/:fileName");
		expect(endpoint.middlewares.size).toBe(0);
	});
});
