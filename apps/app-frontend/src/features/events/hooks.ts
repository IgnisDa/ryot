import { useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "#/hooks/api";
import { sortEvents } from "./model";

export function useEventsQuery(entityId: string, enabled = true) {
	const apiClient = useApiClient();
	const query = apiClient.useQuery(
		"get",
		"/events",
		{ params: { query: { entityId } } },
		{ enabled },
	);

	return {
		...query,
		events: sortEvents(
			(query.data?.data ?? []).map((event) => ({
				...event,
				createdAt: new Date(event.createdAt),
				updatedAt: new Date(event.updatedAt),
				occurredAt: new Date(event.occurredAt),
			})),
		),
	};
}

export function useEventMutations(entityId: string) {
	const apiClient = useApiClient();
	const queryClient = useQueryClient();
	const listQueryKey = apiClient.queryOptions("get", "/events", {
		params: { query: { entityId } },
	}).queryKey;

	const create = apiClient.useMutation(
		"post",
		"/events",
		{
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: listQueryKey });
			},
		},
		queryClient,
	);

	return { create };
}
