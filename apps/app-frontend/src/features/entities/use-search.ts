import {
	createEntityColumnExpression,
	dayjs,
	getQueryEngineField,
} from "@ryot/ts-utils";
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
import {
	createEntityRuntimeRequest,
	queryEngineEntityFieldKeys,
	type SearchResultItem,
} from "./model";

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

	const enqueueSearch = apiClient.useMutation("post", "/entity-schemas/search");
	const ensuredEntityQueryKey = useMemo(
		() => ["entity-search-ensured-entity", props.entitySchema.id],
		[props.entitySchema.id],
	);
	const enqueueEntityImport = apiClient.useMutation(
		"post",
		"/entity-schemas/import",
	);
	const entitySearchQueryKey = useMemo(
		() => ["entity-search", props.entitySchema.id],
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

	const pollEntitySearchResultQuery = useCallback(
		async (jobId: string, signal: AbortSignal) => {
			const startedAt = dayjs();

			while (true) {
				throwIfAborted(signal);
				const result = await queryClient.fetchQuery({
					staleTime: 0,
					...apiClient.queryOptions("get", "/entity-schemas/search/{jobId}", {
						params: { path: { jobId } },
					}),
				});

				throwIfAborted(signal);
				const data = result.data;
				if (data?.status === "pending") {
					if (dayjs().diff(startedAt) >= SANDBOX_TIMEOUT_MS) {
						throw new Error("Timed out waiting for entity search result");
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
			queryKey: [...ensuredEntityQueryKey, provider.scriptId, item.externalId],
			queryFn: async ({ signal }: { signal: AbortSignal }) => {
				throwIfAborted(signal);
				const enqueueResult = await enqueueEntityImport.mutateAsync({
					body: {
						scriptId: provider.scriptId,
						externalId: item.externalId,
						entitySchemaId: props.entitySchema.id,
					},
				});
				throwIfAborted(signal);

				const jobId = enqueueResult.data?.jobId;
				if (!jobId) {
					throw new Error("Failed to enqueue entity import job");
				}

				const startedAt = dayjs();
				while (true) {
					throwIfAborted(signal);
					const result = await queryClient.fetchQuery({
						...apiClient.queryOptions("get", "/entity-schemas/import/{jobId}", {
							params: { path: { jobId } },
						}),
						staleTime: 0,
					});
					throwIfAborted(signal);

					const data = result.data;
					if (data?.status === "pending") {
						if (dayjs().diff(startedAt) >= SANDBOX_TIMEOUT_MS) {
							throw new Error("Timed out waiting for entity import");
						}
						await sleep(POLL_MS, signal);
						continue;
					}

					if (!data || data.status === "failed") {
						throw new Error(
							data?.status === "failed"
								? data.error
								: "Entity import did not finish",
						);
					}

					return data.data;
				}
			},
		}),
		[
			apiClient,
			queryClient,
			enqueueEntityImport,
			ensuredEntityQueryKey,
			props.entitySchema.id,
		],
	);

	const searchQuery = useQuery({
		retry: false,
		refetchOnWindowFocus: false,
		enabled: submittedSearch !== null,
		placeholderData: keepPreviousData,
		queryKey: [...entitySearchQueryKey, submittedSearch],
		queryFn: async ({ signal }) => {
			if (!submittedSearch) {
				throw new Error("Search request is unavailable");
			}

			const provider =
				props.entitySchema.providers[submittedSearch.providerIndex];
			if (!provider) {
				throw new Error("Search provider is unavailable");
			}

			throwIfAborted(signal);
			const enqueueResult = await enqueueSearch.mutateAsync({
				body: {
					scriptId: provider.scriptId,
					context: {
						pageSize: 10,
						page: submittedSearch.page,
						query: submittedSearch.query,
					},
				},
			});
			throwIfAborted(signal);

			const jobId = enqueueResult.data?.jobId;
			if (!jobId) {
				throw new Error("Failed to enqueue search script");
			}

			const result = await pollEntitySearchResultQuery(jobId, signal);
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

	const trackedEntitiesBody = useMemo(() => {
		if (!currentResultProvider || currentResults.length === 0) {
			return null;
		}
		const schemaSlug = props.entitySchema.slug;
		const base = createEntityRuntimeRequest(schemaSlug);
		return {
			fields: base.fields,
			eventJoins: [],
			computedFields: [],
			entitySchemaSlugs: [schemaSlug],
			pagination: { page: 1, limit: Math.max(currentResults.length, 1) },
			sort: {
				direction: "asc" as const,
				expression: createEntityColumnExpression(schemaSlug, "name"),
			},
			filter: {
				type: "and" as const,
				predicates: [
					{
						type: "in" as const,
						expression: createEntityColumnExpression(schemaSlug, "externalId"),
						values: currentResults.map((item) => ({
							value: item.externalId,
							type: "literal" as const,
						})),
					},
					{
						operator: "eq" as const,
						type: "comparison" as const,
						left: createEntityColumnExpression(schemaSlug, "sandboxScriptId"),
						right: {
							type: "literal" as const,
							value: currentResultProvider.scriptId,
						},
					},
				],
			},
		};
	}, [currentResults, currentResultProvider, props.entitySchema.slug]);

	const trackedEntitiesQueryKey = apiClient.queryOptions(
		"post",
		"/query-engine/execute",
		{
			body:
				trackedEntitiesBody ??
				createEntityRuntimeRequest(props.entitySchema.slug),
		},
	).queryKey;

	const trackedEntitiesQuery = apiClient.useQuery(
		"post",
		"/query-engine/execute",
		{
			body:
				trackedEntitiesBody ??
				createEntityRuntimeRequest(props.entitySchema.slug),
		},
		{ enabled: trackedEntitiesBody !== null },
	);

	const trackedExternalIds = useMemo(() => {
		const items = trackedEntitiesQuery.data?.data.items ?? [];
		return new Set(
			items
				.map(
					(item) =>
						getQueryEngineField(item, queryEngineEntityFieldKeys.externalId)
							?.value,
				)
				.filter((id): id is string => id !== null),
		);
	}, [trackedEntitiesQuery.data]);

	const ensuredEntityQueries = useQueries({
		queries:
			currentResultProvider && currentResults.length > 0
				? currentResults.map((item) => ({
						...getEnsuredEntityQueryOptions(item, currentResultProvider),
						enabled: false,
					}))
				: [],
	});

	const ensureItemEntity = useCallback(
		async (item: SearchResultItem) => {
			const provider = props.entitySchema.providers[selectedProviderIndex];
			if (!provider) {
				throw new Error("Search provider is unavailable");
			}

			const queryOptions = getEnsuredEntityQueryOptions(item, provider);
			const entity = await queryClient.fetchQuery(queryOptions);
			void queryClient.invalidateQueries({ queryKey: entityListQueryKey });
			void queryClient.invalidateQueries({ queryKey: trackedEntitiesQueryKey });

			return entity;
		},
		[
			queryClient,
			entityListQueryKey,
			props.entitySchema,
			selectedProviderIndex,
			trackedEntitiesQueryKey,
			getEnsuredEntityQueryOptions,
		],
	);

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

				return [item.externalId, state];
			}),
		) as Record<string, AddItemState>;
	}, [currentResults, ensuredEntityQueries]);

	const addError = useMemo(
		() =>
			Object.fromEntries(
				Object.entries(addStateById)
					.filter(([, item]) => item.error)
					.map(([externalId, item]) => [externalId, item.error ?? undefined]),
			),
		[addStateById],
	);

	const addStatus = useMemo(
		() =>
			Object.fromEntries(
				Object.entries(addStateById).map(([externalId, item]) => [
					externalId,
					item.status,
				]),
			),
		[addStateById],
	);

	const ensuredEntityByExternalId = useMemo(
		() =>
			Object.fromEntries(
				Object.entries(addStateById)
					.filter(([, item]) => item.entity)
					.map(([externalId, item]) => [externalId, item.entity]),
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
		ensuredEntityByExternalId,
		trackedExternalIds,
		selectedProviderIndex,
		setSelectedProviderIndex,
		page: submittedSearch?.page ?? 1,
		isSearching: searchQuery.isFetching,
		nextPage: searchQuery.data?.nextPage ?? null,
		totalItems: searchQuery.data?.totalItems ?? 0,
	};
}
