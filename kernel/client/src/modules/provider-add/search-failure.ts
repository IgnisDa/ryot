import { ProviderEntityBadRequest } from "@ryot-app/contract/modules/entity-providers/schemas";
import { formatDisplayText } from "@ryot-app/i18n/format";
import type { Formatters } from "@ryot-app/i18n/formatters";
import type { Message } from "@ryot-app/i18n/message";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Schema } from "effect";

import { ProviderAddLoadError } from "#/modules/provider-add/service";

type SearchFailureCopy = {
	readonly title: string;
	readonly detail: string;
	readonly retryable: boolean;
};

const isSearchRefusal = Schema.is(ProviderEntityBadRequest);

export const transportFailure = (t: (message: Message) => Text): SearchFailureCopy => ({
	retryable: true,
	title: t(kernelMessage("client.provider-add.failure.transport-title")),
	detail: t(kernelMessage("client.provider-add.failure.transport-detail")),
});

export const describeSearchFailure = (
	t: (message: Message) => Text,
	formatters: Formatters,
	error: unknown,
	providerName: string,
): SearchFailureCopy => {
	if (
		!(error instanceof ProviderAddLoadError) ||
		error.stage !== "search" ||
		!isSearchRefusal(error.cause) ||
		error.cause.reason.code !== "search-failed"
	) {
		return transportFailure(t);
	}
	const { cause } = error.cause.reason;
	if (cause.code === "missing-config") {
		return {
			retryable: false,
			title: t(
				kernelMessage("client.provider-add.failure.not-configured", { provider: providerName }),
			),
			detail: t(
				cause.configNames.length === 0
					? kernelMessage("client.provider-add.failure.missing-setting")
					: kernelMessage("client.provider-add.failure.admin-add", {
							names: formatters
								.list()
								.format(cause.configNames.map((name) => formatDisplayText(t, name))),
						}),
			),
		};
	}
	return {
		retryable: true,
		detail: t(kernelMessage("client.provider-add.failure.provider-error")),
		title: t(
			kernelMessage("client.provider-add.failure.search-failed", { provider: providerName }),
		),
	};
};
