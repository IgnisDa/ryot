import { AppContract } from "@ryot-app/contract/contract";
import { OpenApi } from "effect/unstable/httpapi";
import { expect, it } from "vitest";

it("keeps retry on the OAuth/API-key auth boundary without history reads", () => {
	const spec = OpenApi.fromApi(AppContract);
	const retry = spec.paths["/automations/runs/{runId}/retry"]?.post;
	expect(retry?.security).toEqual([{ oauth: [] }, { apiKey: [] }]);
	expect(retry?.responses["202"]).toBeDefined();
	expect(retry?.responses["409"]).toBeDefined();
	expect(spec.paths["/automations/runs"]?.get).toBeUndefined();
	expect(spec.paths["/automations/runs/{runId}"]?.get).toBeUndefined();
});
