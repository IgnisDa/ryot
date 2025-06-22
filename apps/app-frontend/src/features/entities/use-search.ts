import { dayjs } from "@ryot/ts-utils";
import {
	keepPreviousData,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppEntitySchema } from "~/features/entity-schemas/model";
import { useApiClient } from "~/hooks/api";
import type { ApiPostResponseData } from "~/lib/api/types";
import { getErrorMessage } from "~/lib/errors";
import { sleep } from "~/lib/sleep";
import { createEntityRuntimeRequest } from "./model";

export type SearchResultItem = {
	identifier: string;
	badgeProperty: { kind: "null"; value: null };
	titleProperty: { kind: "text"; value: string };
	subtitleProperty: { kind: "number" | "null"; value: number | null };
	imageProperty: {
		kind: "image" | "null";
		value: { kind: "remote"; url: string } | null;
	};
};

type AddStatus = "idle" | "loading" | "done" | "error" | "partial_error";

type SubmittedSearch = {
	page: number;
	query: string;
	providerIndex: number;
};

type SearchQueryResult = {
	totalItems: number;
	nextPage: number | null;
	items: SearchResultItem[];
};

type EnsuredEntity = ApiPostResponseData<"/entities">;

type AddItemState = {
	status: AddStatus;
	error: string | null;
	entity: EnsuredEntity | null;
	collectionId?: string;
	collectionError?: string;
};

const POLL_MS = 500;
const SANDBOX_TIMEOUT_MS = 30000;
const cancelledRequestMessage = "Request was cancelled";

function throwIfAborted(signal?: AbortSignal) {
	if (signal?.aborted) {
		throw new Error(cancelledRequestMessage);
	}
}

function isSameSubmittedSearch(
	current: SubmittedSearch | null,
	next: SubmittedSearch,
) {
	return (
		current?.page === next.page &&
		current.query === next.query &&
		current.providerIndex === next.providerIndex
	);
}

export function isCancelledEntitySearchError(error: unknown) {
	return getErrorMessage(error) === cancelledRequestMessage;
}

export function useEntitySearch(props: { entitySchema: AppEntitySchema }) {
	const apiClient = useApiClient();
	const queryClient = useQueryClient();

	const [query, setQuery] = useState("");
	const [selectedProviderIndex, setSelectedProviderIndex] = useState(0);
	const [submittedSearch, setSubmittedSearch] =
		useState<SubmittedSearch | null>(null);

	const enqueueSearch = apiClient.useMutation("post", "/sandbox/enqueue");
	const enqueueMediaImport = apiClient.useMutation("post", "/media/import");
	const ensuredEntityQueryKey = useMemo(
		() => ["entity-search-ensured-entity", props.entitySchema.id] as const,
		[props.entitySchema.id],
	);
	const entitySearchQueryKey = useMemo(
		() => ["entity-search", props.entitySchema.id] as const,
		[props.entitySchema.id],
	);
	const entityListQueryKey = apiClient.queryOptions(
		"post",
		"/query-engine/execute",
		{ body: createEntityRuntimeRequest(props.entitySchema.slug) },
	).queryKey;

	useEffect(() => {
		return () => {
			void queryClient.cancelQueries({ queryKey: entitySearchQueryKey });
			void queryClient.cancelQueries({ queryKey: ensuredEntityQueryKey });
		};
	}, [ensuredEntityQueryKey, entitySearchQueryKey, queryClient]);

	const pollSandboxResultQuery = useCallback(
		async (jobId: string, signal: AbortSignal) => {
			const startedAt = dayjs();

			while (true) {
				throwIfAborted(signal);
				const result = await queryClient.fetchQuery({
					...apiClient.queryOptions("get", "/sandbox/result/{jobId}", {
						params: { path: { jobId } },
					}),
					staleTime: 0,
				});

				throwIfAborted(signal);
				const data = result.data;
				if (data?.status === "pending") {
					if (dayjs().diff(startedAt) >= SANDBOX_TIMEOUT_MS) {
						throw new Error("Timed out waiting for sandbox result");
					}
					await sleep(POLL_MS, signal);
					continue;
				}

				return data;
			}
		},
		[apiClient, queryClient],
	);

	const getEnsuredEntityQueryOptions = useCallback(
		(
			item: SearchResultItem,
			provider: AppEntitySchema["providers"][number],
		) => ({
			retry: false,
			staleTime: Number.POSITIVE_INFINITY,
			queryKey: [...ensuredEntityQueryKey, provider.scriptId, item.identifier],
			queryFn: async ({ signal }: { signal: AbortSignal }) => {
				throwIfAborted(signal);
				const enqueueResult = await enqueueMediaImport.mutateAsync({
					body: {
						scriptId: provider.scriptId,
						identifier: item.identifier,
						entitySchemaId: props.entitySchema.id,
					},
				});
				throwIfAborted(signal);

				const jobId = enqueueResult.data?.jobId;
				if (!jobId) {
					throw new Error("Failed to enqueue media import job");
				}

				const startedAt = dayjs();
				while (true) {
					throwIfAborted(signal);
					const result = await queryClient.fetchQuery({
						...apiClient.queryOptions("get", "/media/import/{jobId}", {
							params: { path: { jobId } },
						}),
						staleTime: 0,
					});
					throwIfAborted(signal);

					const data = result.data;
					if (data?.status === "pending") {
						if (dayjs().diff(startedAt) >= SANDBOX_TIMEOUT_MS) {
							throw new Error("Timed out waiting for media import");
						}
						await sleep(POLL_MS, signal);
						continue;
					}

					if (!data || data.status === "failed") {
						throw new Error(
							data?.status === "failed"
								? data.error
								: "Media import did not finish",
						);
					}

					return data.data;
				}
			},
		}),
		[
			apiClient,
			queryClient,
			enqueueMediaImport,
			ensuredEntityQueryKey,
			props.entitySchema.id,
		],
	);

	const ensureItemEntity = useCallback(
		async (item: SearchResultItem) => {
			const provider = props.entitySchema.providers[selectedProviderIndex];
			if (!provider) {
				throw new Error("Search provider is unavailable");
			}

			const queryOptions = getEnsuredEntityQueryOptions(item, provider);
			const entity = await queryClient.fetchQuery(queryOptions);
			void queryClient.invalidateQueries({ queryKey: entityListQueryKey });

			return entity;
		},
		[
			queryClient,
			entityListQueryKey,
			props.entitySchema,
			selectedProviderIndex,
			getEnsuredEntityQueryOptions,
		],
	);

	const searchQuery = useQuery({
		retry: false,
		enabled: submittedSearch !== null,
		placeholderData: keepPreviousData,
		queryKey: [...entitySearchQueryKey, submittedSearch],
		queryFn: async ({ signal }) => {
			const currentSearch = submittedSearch;
			if (!currentSearch) {
				throw new Error("Search request is unavailable");
			}

			const provider =
				props.entitySchema.providers[currentSearch.providerIndex];
			if (!provider) {
				throw new Error("Search provider is unavailable");
			}

			if (!provider.searchDriverName) {
				throw new Error("Search provider does not have a search driver");
			}

			throwIfAborted(signal);
			const enqueueResult = await enqueueSearch.mutateAsync({
				body: {
					kind: "script",
					scriptId: provider.scriptId,
					driverName: provider.searchDriverName,
					context: {
						pageSize: 10,
						page: currentSearch.page,
						query: currentSearch.query,
					},
				},
			});
			throwIfAborted(signal);

			const jobId = enqueueResult.data?.jobId;
			if (!jobId) {
				throw new Error("Failed to enqueue search script");
			}

			const result = await pollSandboxResultQuery(jobId, signal);
			if (!result) {
				throw new Error("Search script did not finish");
			}
			if (result.status === "failed") {
				throw new Error(result.error ?? "Search script failed");
			}

			const value = result.value as {
				items: SearchResultItem[];
				details: { totalItems: number; nextPage: number | null };
			};

			return {
				items: value.items ?? [],
				nextPage: value.details?.nextPage ?? null,
				totalItems: value.details?.totalItems ?? 0,
			} satisfies SearchQueryResult;
		},
	});

	const search = useCallback(() => {
		const nextQuery = query.trim();
		if (!nextQuery) {
			return;
		}

		const nextSearch = {
			page: 1,
			query: nextQuery,
			providerIndex: selectedProviderIndex,
		} satisfies SubmittedSearch;

		if (isSameSubmittedSearch(submittedSearch, nextSearch)) {
			void searchQuery.refetch();
			return;
		}

		setSubmittedSearch(nextSearch);
	}, [query, searchQuery, selectedProviderIndex, submittedSearch]);

	const clearSearch = useCallback(() => {
		void queryClient.cancelQueries({ queryKey: entitySearchQueryKey });
		void queryClient.cancelQueries({ queryKey: ensuredEntityQueryKey });
		queryClient.removeQueries({ queryKey: ensuredEntityQueryKey });
		setSubmittedSearch(null);
	}, [ensuredEntityQueryKey, entitySearchQueryKey, queryClient]);

	const goToPage = useCallback((newPage: number) => {
		setSubmittedSearch((current) =>
			current ? { ...current, page: newPage } : current,
		);
	}, []);

	const currentResults = searchQuery.data?.items ?? [];
	const currentResultProvider = submittedSearch
		? props.entitySchema.providers[submittedSearch.providerIndex]
		: undefined;
	const ensuredEntityQueries = useQueries({
		queries:
			currentResultProvider && currentResults.length > 0
				? currentResults.map((item) => ({
						...getEnsuredEntityQueryOptions(item, currentResultProvider),
						enabled: false,
					}))
				: [],
	});

	const addItem = useCallback(
		async (item: SearchResultItem) => {
			return await ensureItemEntity(item);
		},
		[ensureItemEntity],
	);

	const addStateById = useMemo(() => {
		return Object.fromEntries(
			currentResults.map((item, index) => {
				const queryState = ensuredEntityQueries[index];
				const error =
					queryState?.error && !isCancelledEntitySearchError(queryState.error)
						? getErrorMessage(queryState.error)
						: null;
				const state: AddItemState = {
					entity: queryState?.data ?? null,
					error,
					status:
						queryState?.fetchStatus === "fetching"
							? "loading"
							: error
								? "error"
								: queryState?.data
									? "done"
									: "idle",
				};

				return [item.identifier, state];
			}),
		) as Record<string, AddItemState>;
	}, [currentResults, ensuredEntityQueries]);

	const addError = useMemo(
		() =>
			Object.fromEntries(
				Object.entries(addStateById)
					.filter(([, item]) => item.error)
					.map(([identifier, item]) => [identifier, item.error ?? undefined]),
			),
		[addStateById],
	);

	const addStatus = useMemo(
		() =>
			Object.fromEntries(
				Object.entries(addStateById).map(([identifier, item]) => [
					identifier,
					item.status,
				]),
			),
		[addStateById],
	);

	const searchError = useMemo(() => {
		if (!searchQuery.error || isCancelledEntitySearchError(searchQuery.error)) {
			return null;
		}

		return getErrorMessage(searchQuery.error);
	}, [searchQuery.error]);

	const results = useMemo(() => {
		if (!submittedSearch || searchQuery.isError) {
			return null;
		}

		return searchQuery.data?.items ?? [];
	}, [searchQuery.data?.items, searchQuery.isError, submittedSearch]);

	return {
		query,
		search,
		addItem,
		results,
		setQuery,
		addError,
		goToPage,
		addStatus,
		clearSearch,
		searchError,
		ensureItemEntity,
		selectedProviderIndex,
		setSelectedProviderIndex,
		page: submittedSearch?.page ?? 1,
		isSearching: searchQuery.isFetching,
		nextPage: searchQuery.data?.nextPage ?? null,
		totalItems: searchQuery.data?.totalItems ?? 0,
	};
}
