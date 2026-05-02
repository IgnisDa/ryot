import {
	createEntityPropertyExpression,
	createEntitySchemaExpression,
} from "@ryot/ts-utils";
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
	const base = createEntityRuntimeRequest(COLLECTION_ENTITY_SCHEMA_SLUG);
	const query = apiClient.useQuery(
		"post",
		"/query-engine/execute",
		{
			body: {
				...base,
				fields: [
					...(base.fields ?? []),
					{
						key: "membershipPropertiesSchema",
						expression: createEntityPropertyExpression(
							COLLECTION_ENTITY_SCHEMA_SLUG,
							"membershipPropertiesSchema",
						),
					},
					{
						key: "entitySchemaSlug",
						expression: createEntitySchemaExpression("slug"),
					},
				],
			},
		},
		{ enabled },
	);

	const payload = query.data?.data;
	const collections: AppCollection[] =
		payload?.mode === "entities" ? payload.data.items.map(toAppCollection) : [];

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
