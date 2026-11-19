import type {
	IntegrationRecord,
	ListIntegrationsOptions,
	ScriptHost,
} from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { type EntityReadResult, executeRyotqlRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";
import { asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { providerSlugRecipe } from "../../shared/provider-recipes";

export type IntegrationPushHost = Pick<
	ScriptHost,
	"log" | "httpCall" | "executeRyotql" | "listIntegrations" | "getUserPreferences"
>;

export const normalizeBaseUrl = (value: unknown) =>
	typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";

export const parseJsonBody = (
	result: Effect.Success<ReturnType<IntegrationPushHost["httpCall"]>>,
): unknown => {
	const body = result.body;
	if (typeof body !== "string" || !body.trim()) {
		return null;
	}
	try {
		return JSON.parse(body) as unknown;
	} catch {
		return null;
	}
};

export const integrationsDisabledForUser = (host: IntegrationPushHost) =>
	host.getUserPreferences().pipe(Effect.map((preferences) => preferences.disableIntegrations));

export const logPushFailure = (
	host: IntegrationPushHost,
	integration: string,
	error: { readonly message: string },
) =>
	host
		.log([
			{
				level: "warning",
				attributes: { error: error.message },
				message: `${integration} push failed`,
			},
		])
		.pipe(
			Effect.orElseSucceed(() => null),
			Effect.asVoid,
		);

export const listActiveIntegrations = Effect.fnUntraced(function* (
	host: IntegrationPushHost,
	provider: NonNullable<ListIntegrationsOptions["provider"]>,
) {
	const integrations: Array<IntegrationRecord> = [];
	let cursor: string | undefined;
	do {
		const page = yield* host.listIntegrations({
			provider,
			isDisabled: false,
			...(cursor === undefined ? {} : { cursor }),
		});
		integrations.push(...page.items);
		cursor = page.nextCursor ?? undefined;
	} while (cursor !== undefined);
	return integrations;
});

export const resolveEntityProviderSlug = (
	host: IntegrationPushHost,
	entity: EntityReadResult["items"][number],
) =>
	entity.providerId
		? executeRyotqlRecipe(host.executeRyotql, providerSlugRecipe, { providerId: entity.providerId })
		: Effect.succeed(null);

export const collectionSyncMatches = (integration: IntegrationRecord, collectionId: string) => {
	const specifics = asRecord(integration.providerSpecifics);
	const ids =
		specifics && Array.isArray(specifics["syncCollectionIds"])
			? specifics["syncCollectionIds"]
			: [];
	return ids.includes(collectionId);
};
