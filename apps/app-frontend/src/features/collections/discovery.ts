import { createEntityPropertyExpression } from "@ryot/ts-utils";
import { createEntityRuntimeRequest } from "~/features/entities/model";
import { useApiClient } from "~/hooks/api";
import {
	type AppCollection,
	type CollectionDiscoveryState,
	getCollectionDiscoveryState,
	toAppCollection,
} from "./model";

const COLLECTION_ENTITY_SCHEMA_SLUG = "collection";

export function useCollectionsQuery(enabled = true) {
	const apiClient = useApiClient();
	const query = apiClient.useQuery(
		"post",
		"/query-engine/execute",
		{
			body: {
				...createEntityRuntimeRequest(COLLECTION_ENTITY_SCHEMA_SLUG),
				fields: [
					{
						key: "membershipPropertiesSchema",
						expression: createEntityPropertyExpression(
							COLLECTION_ENTITY_SCHEMA_SLUG,
							"membershipPropertiesSchema",
						),
					},
				],
			},
		},
		{ enabled },
	);

	const collections: AppCollection[] =
		query.data?.data.items.map(toAppCollection) ?? [];

	return {
		...query,
		collections,
	};
}

export function useCollectionDiscovery(enabled = true): {
	state: CollectionDiscoveryState;
	refetch: () => void;
} {
	const { collections, isError, isLoading, refetch } =
		useCollectionsQuery(enabled);

	const state = getCollectionDiscoveryState(isLoading, isError, collections);

	return { state, refetch };
}
