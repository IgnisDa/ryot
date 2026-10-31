import type {
	SearchProviderEntitiesBody,
	SearchProviderEntitiesResponse,
} from "@ryot-app/contract/modules/entity-providers/schemas";
import type { SandboxProviderId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";

const PROVIDER_SEARCH_PAGE_SIZE = 20;

export type ProviderSearchResultItem = SearchProviderEntitiesResponse["items"][number];

export const buildSearchPayload = (input: {
	readonly page: number;
	readonly query: string;
	readonly providerId: SandboxProviderId;
	readonly options?: undefined | Readonly<Record<string, JsonValue>>;
}): SearchProviderEntitiesBody => {
	const payload = {
		page: input.page,
		query: input.query,
		providerId: input.providerId,
		pageSize: PROVIDER_SEARCH_PAGE_SIZE,
	};
	return input.options === undefined || Object.keys(input.options).length === 0
		? payload
		: { ...payload, options: { ...input.options } };
};
