import { useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "#/hooks/api";
import { applyTrackerIsDisabledPatch, applyTrackerReorderPatch } from "./cache";
import type { AppTracker } from "./model";
import {
	findEnabledTrackerBySlug,
	selectEnabledTrackers,
	sortTrackersByOrder,
} from "./model";

interface TrackersQueryOptions {
	includeDisabled?: boolean;
}

function extractTrackerIsDisabledFromInput(
	input: unknown,
): { trackerId: string; isDisabled: boolean } | undefined {
	const parsed = input as {
		body?: { isDisabled?: boolean };
		params?: { path?: { trackerId: string } };
	};
	const isDisabled = parsed.body?.isDisabled;
	const trackerId = parsed.params?.path?.trackerId;

	if (!trackerId || isDisabled === undefined) {
		return;
	}

	return { isDisabled, trackerId };
}

function extractTrackerIdsFromInput(input: unknown): string[] | undefined {
	return (input as { body?: { trackerIds?: string[] } }).body?.trackerIds;
}

function isQueryDataWithTrackers(
	data: unknown,
): data is { data: AppTracker[] } {
	if (data === null || typeof data !== "object") {
		return false;
	}
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
				if (inputValue) {
					queryClient.setQueryData(listQueryKey, {
						data: applyPatch(previousData.data, inputValue),
					});
				}
			}

			return { previousData };
		},
		onError: (_err: unknown, _variables: unknown, context: unknown) => {
			const ctx = context as { previousData?: unknown } | undefined;
			if (ctx?.previousData) {
				queryClient.setQueryData(listQueryKey, ctx.previousData);
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: listQueryKey });
		},
	};
}

export function useTrackersQuery(options: TrackersQueryOptions = {}) {
	const apiClient = useApiClient();
	const includeDisabled = options.includeDisabled ? "true" : undefined;
	const query = apiClient.useQuery("get", "/trackers", {
		params: { query: { includeDisabled } },
	});

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
				applyTrackerIsDisabledPatch(data, value.trackerId, value.isDisabled),
			extractTrackerIsDisabledFromInput,
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
