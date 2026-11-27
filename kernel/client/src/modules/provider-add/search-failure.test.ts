import { expect } from "bun:test";

import { ProviderEntityBadRequest } from "@ryot-app/contract/modules/entity-providers/schemas";
import { testFormatters, testKernelText } from "@ryot-app/kernel-messages/testing";
import { it } from "@voila.dev/effect-bun-test";

import { describeSearchFailure, transportFailure } from "#/modules/provider-add/search-failure";
import { ProviderAddLoadError } from "#/modules/provider-add/service";

const searchFailed = (
	cause: Extract<ProviderEntityBadRequest["reason"], { readonly code: "search-failed" }>["cause"],
) =>
	new ProviderAddLoadError({
		stage: "search",
		cause: new ProviderEntityBadRequest({ reason: { cause, code: "search-failed" } }),
	});

const describe = (error: unknown, providerName: string) =>
	describeSearchFailure(testKernelText, testFormatters, error, providerName);

it("names the missing configuration when the provider is not configured", () => {
	expect(
		describe(
			searchFailed({ code: "missing-config", configNames: ["Listen Notes API key"] }),
			"Listen Notes",
		),
	).toEqual({
		retryable: false,
		title: "Listen Notes isn't configured on this server",
		detail:
			"A server administrator needs to add Listen Notes API key to this plugin's configuration.",
	});
});

it("reports a provider error without claiming the server was unreachable", () => {
	expect(describe(searchFailed({ code: "provider-error" }), "GiantBomb")).toEqual({
		retryable: true,
		title: "GiantBomb couldn't complete the search",
		detail: "The provider returned an error. Try again later.",
	});
});

it("keeps the transport copy for failures that are not declared search refusals", () => {
	const transport = transportFailure(testKernelText);
	expect(
		describe(new ProviderAddLoadError({ stage: "search", cause: "Unavailable" }), "GiantBomb"),
	).toEqual(transport);
	expect(describe(new Error("offline"), "GiantBomb")).toEqual(transport);
});
