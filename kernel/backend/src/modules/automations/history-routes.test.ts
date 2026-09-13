import { AppContract } from "@ryot-app/contract/contract";
import { OpenApi } from "effect/unstable/httpapi";
import { expect, it } from "vitest";

it("keeps user history on the OAuth/API-key auth boundary", () => {
	const spec = OpenApi.fromApi(AppContract);
	for (const [suffix, method] of [
		["", "get"],
		["/{runId}", "get"],
		["/{runId}/retry", "post"],
	] as const) {
		expect(spec.paths[`/automations/runs${suffix}`]?.[method]?.security).toEqual([
			{ oauth: [] },
			{ apiKey: [] },
		]);
	}
	expect(spec.paths["/automations/runs/{runId}/retry"]?.post?.responses["202"]).toBeDefined();
	expect(spec.paths["/automations/runs/{runId}/retry"]?.post?.responses["409"]).toBeDefined();
	expect(spec.paths["/automations/runs/{runId}"]?.get?.responses["404"]).toBeDefined();
});
