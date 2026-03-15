import { useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "#/hooks/api";
import { applyTrackerEnabledPatch, applyTrackerReorderPatch } from "./cache";
import type { AppTracker } from "./model";
import {
	findEnabledTrackerBySlug,
	selectEnabledTrackers,
	sortTrackersByOrder,
} from "./model";

function extractTrackerEnabledFromInput(
	input: unknown,
): { trackerId: string; enabled: boolean } | undefined {
	const parsed = input as {
		body?: { enabled?: boolean };
		params?: { path?: { trackerId: string } };
	};
	const trackerId = parsed.params?.path?.trackerId;
	const enabled = parsed.body?.enabled;

	if (!trackerId || enabled === undefined) return;

	return { enabled, trackerId };
}

function extractTrackerIdsFromInput(input: unknown): string[] | undefined {
	return (input as { body?: { trackerIds?: string[] } }).body?.trackerIds;
}

function isQueryDataWithTrackers(
	data: unknown,
): data is { data: AppTracker[] } {
	if (data === null || typeof data !== "object") return false;
	return "data" in data;
}

function createMutationHandler<T>(
	queryClient: ReturnType<typeof useQueryClient>,
	listQueryKey: readonly unknown[],
	applyPatch: (data: AppTracker[], id: T) => AppTracker[],
	extractInput: (input: unknown) => T | undefined,
) {
	return {
		onMutate: async (input: unknown) => {
			await queryClient.cancelQueries({ queryKey: listQueryKey as unknown[] });
			const previousData = queryClient.getQueryData(listQueryKey as unknown[]);

			if (isQueryDataWithTrackers(previousData)) {
				const inputValue = extractInput(input);
				if (inputValue)
					queryClient.setQueryData(listQueryKey, {
						data: applyPatch(previousData.data, inputValue),
					});
			}

			return { previousData };
		},
		onError: (_err: unknown, _variables: unknown, context: unknown) => {
			const ctx = context as { previousData?: unknown } | undefined;
			if (ctx?.previousData)
				queryClient.setQueryData(listQueryKey, ctx.previousData);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: listQueryKey });
		},
	};
}

export function useTrackersQuery() {
	const apiClient = useApiClient();
	const query = apiClient.useQuery("get", "/trackers");

	const rawTrackers = query.data?.data ?? [];
	const trackers = sortTrackersByOrder(rawTrackers);
	const enabledTrackers = selectEnabledTrackers(trackers);

	return {
		...query,
		trackers,
		enabledTrackers,
		trackerBySlug: (slug: string) => findEnabledTrackerBySlug(trackers, slug),
	};
}

export function useTrackerMutations() {
	const apiClient = useApiClient();
	const queryClient = useQueryClient();
	const listQueryKey = apiClient.queryOptions("get", "/trackers").queryKey;

	const create = apiClient.useMutation(
		"post",
		"/trackers",
		{
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: listQueryKey });
			},
		},
		queryClient,
	);

	const update = apiClient.useMutation(
		"patch",
		"/trackers/{trackerId}",
		{
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: listQueryKey });
			},
		},
		queryClient,
	);

	const toggle = apiClient.useMutation(
		"patch",
		"/trackers/{trackerId}",
		createMutationHandler(
			queryClient,
			listQueryKey,
			(data, value) =>
				applyTrackerEnabledPatch(data, value.trackerId, value.enabled),
			extractTrackerEnabledFromInput,
		),
		queryClient,
	);

	const reorder = apiClient.useMutation(
		"post",
		"/trackers/reorder",
		createMutationHandler(
			queryClient,
			listQueryKey,
			(data, ids) => applyTrackerReorderPatch(data, ids),
			extractTrackerIdsFromInput,
		),
		queryClient,
	);

	return { create, update, toggle, reorder };
}
