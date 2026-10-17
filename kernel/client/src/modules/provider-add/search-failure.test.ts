import { expect, it } from "@effect/vitest";
import { ProviderEntityBadRequest } from "@ryot-app/contract/modules/entity-providers/schemas";

import { describeSearchFailure, TRANSPORT_FAILURE } from "#/modules/provider-add/search-failure";
import { ProviderAddLoadError } from "#/modules/provider-add/service";

const searchFailed = (
	cause: Extract<ProviderEntityBadRequest["reason"], { readonly code: "search-failed" }>["cause"],
) =>
	new ProviderAddLoadError({
		stage: "search",
		cause: new ProviderEntityBadRequest({ reason: { cause, code: "search-failed" } }),
	});

it("names the missing configuration when the provider is not configured", () => {
	expect(
		describeSearchFailure(
			searchFailed({ code: "missing-config", configNames: ["Listen Notes API key"] }),
			"Listen Notes",
		),
	).toEqual({
		title: "Listen Notes isn't configured on this server",
		detail: "Add Listen Notes API key to this plugin's configuration, then try again.",
	});
});

it("reports a provider error without claiming the server was unreachable", () => {
	expect(describeSearchFailure(searchFailed({ code: "provider-error" }), "GiantBomb")).toEqual({
		title: "GiantBomb couldn't complete the search",
		detail: "The provider returned an error. Try again later.",
	});
});

it("keeps the transport copy for failures that are not declared search refusals", () => {
	expect(
		describeSearchFailure(
			new ProviderAddLoadError({ stage: "search", cause: "Unavailable" }),
			"GiantBomb",
		),
	).toBe(TRANSPORT_FAILURE);
	expect(describeSearchFailure(new Error("offline"), "GiantBomb")).toBe(TRANSPORT_FAILURE);
});
