import type { AppSchema } from "@ryot/ts-utils";

import { useApiClient } from "~/hooks/api";

export function useCollectionMutations() {
	const apiClient = useApiClient();

	const create = apiClient.useMutation("post", "/collections");

	const createCollection = async (name: string, membershipPropertiesSchema?: AppSchema) => {
		return await create.mutateAsync({
			body: {
				name,
				...(membershipPropertiesSchema ? { membershipPropertiesSchema } : {}),
			},
		});
	};

	return { create, createCollection };
}
