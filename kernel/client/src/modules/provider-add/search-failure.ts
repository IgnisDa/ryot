import { ProviderEntityBadRequest } from "@ryot-app/contract/modules/entity-providers/schemas";
import { Schema } from "effect";

import { ProviderAddLoadError } from "#/modules/provider-add/service";

type SearchFailureCopy = { readonly title: string; readonly detail: string };

const isSearchRefusal = Schema.is(ProviderEntityBadRequest);

export const TRANSPORT_FAILURE = {
	title: "Unable to reach the server",
	detail: "The server could not be reached. Check your connection and try again.",
} as const satisfies SearchFailureCopy;

export const describeSearchFailure = (error: unknown, providerName: string): SearchFailureCopy => {
	if (
		!(error instanceof ProviderAddLoadError) ||
		error.stage !== "search" ||
		!isSearchRefusal(error.cause) ||
		error.cause.reason.code !== "search-failed"
	) {
		return TRANSPORT_FAILURE;
	}
	const { cause } = error.cause.reason;
	if (cause.code === "missing-config") {
		return {
			title: `${providerName} isn't configured on this server`,
			detail:
				cause.configNames.length === 0
					? "A required setting is missing from this plugin's configuration."
					: `Add ${cause.configNames.join(", ")} to this plugin's configuration, then try again.`,
		};
	}
	return {
		title: `${providerName} couldn't complete the search`,
		detail: "The provider returned an error. Try again later.",
	};
};
