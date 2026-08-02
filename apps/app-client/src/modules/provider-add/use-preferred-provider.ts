import { useAtomValue } from "@effect/atom-react";
import type { EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";

import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";

import { providerSearchAtom, rememberedProviderAtom } from "./atoms";
import { mapProviderSummaries, type ProviderSearchSummary } from "./state";

export const selectPreferredProvider = (
	providers: readonly ProviderSearchSummary[],
	remembered: SandboxProviderId | null,
) => providers.find((provider) => provider.providerId === remembered) ?? providers.at(0);

export function usePreferredProvider(entitySchemaSlug: EntitySchemaSlug) {
	const scope = useApiScope();
	const providers = mapProviderSummaries(
		useAtomValue(providerSearchAtom({ ...scope, rootEntitySchemaSlug: entitySchemaSlug })),
	);
	const remembered = useAtomValue(rememberedProviderAtom({ ...scope, entitySchemaSlug }));
	useInternalRequestFailureLogging(
		`preferred provider ${providers.status}`,
		"cause" in providers ? providers.cause : undefined,
	);
	return providers.status === "ready"
		? selectPreferredProvider(providers.providers, remembered)
		: undefined;
}
