import { useQueries } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppEntitySchema } from "#/features/entity-schemas/model";
import { useApiClient } from "#/hooks/api";
import { getErrorMessage } from "#/lib/errors";

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

type AddStatus = "idle" | "loading" | "done" | "error";

type SearchState = {
	page: number;
	totalItems: number;
	error: string | null;
	nextPage: number | null;
	results: SearchResultItem[] | null;
	request: { jobId: string; page: number } | null;
};

type AddItemState = {
	status: AddStatus;
	error: string | null;
	jobId: string | null;
	detailsScriptId: string | null;
};

type AddState = Record<string, AddItemState>;

const initialSearchState: SearchState = {
	page: 1,
	error: null,
	request: null,
	results: null,
	totalItems: 0,
	nextPage: null,
};

const initialAddItemState = (): AddItemState => ({
	error: null,
	jobId: null,
	status: "idle",
	detailsScriptId: null,
});

const POLL_MS = 500;

const sandboxRefetchInterval = (query: unknown) => {
	const status = (query as { state: { data?: { data?: { status?: string } } } })
		.state.data?.data?.status;
	return status === "pending" ? POLL_MS : (false as const);
};

export function useEntitySearch(props: {
	onEntityAdded: () => void;
	entitySchema: AppEntitySchema;
}) {
	const apiClient = useApiClient();

	const [query, setQuery] = useState("");
	const [addState, setAddState] = useState<AddState>({});
	const [searchState, setSearchState] = useState(initialSearchState);
	const [selectedProviderIndex, setSelectedProviderIndex] = useState(0);

	const createEntity = apiClient.useMutation("post", "/entities");
	const enqueueSearch = apiClient.useMutation("post", "/sandbox/enqueue");
	const enqueueDetails = apiClient.useMutation("post", "/sandbox/enqueue");

	const searchResultQuery = apiClient.useQuery(
		"get",
		"/sandbox/result/{jobId}",
		{ params: { path: { jobId: searchState.request?.jobId ?? "" } } },
		{
			enabled: !!searchState.request?.jobId,
			refetchInterval: sandboxRefetchInterval,
		},
	);

	const isSearching = enqueueSearch.isPending || !!searchState.request;

	useEffect(() => {
		const result = searchResultQuery.data?.data;
		if (!searchState.request || !result || result.status === "pending") {
			return;
		}

		if (result.status === "failed") {
			setSearchState((prev) => ({
				...prev,
				request: null,
				error: result.error ?? "Search script failed",
			}));
			return;
		}

		const value = result.value as {
			items: SearchResultItem[];
			details: { totalItems: number; nextPage: number | null };
		};
		setSearchState((prev) => ({
			...prev,
			request: null,
			results: value.items ?? [],
			page: prev.request?.page ?? prev.page,
			nextPage: value.details?.nextPage ?? null,
			totalItems: value.details?.totalItems ?? 0,
		}));
	}, [searchResultQuery.data?.data, searchState.request]);

	const addJobEntries = useMemo(
		() =>
			Object.entries(addState).filter(
				([, item]) => item.jobId && item.detailsScriptId,
			),
		[addState],
	);

	const detailsQueries = useQueries({
		queries: addJobEntries.map(([, item]) => ({
			enabled: !!item.jobId,
			refetchInterval: sandboxRefetchInterval,
			...apiClient.queryOptions("get", "/sandbox/result/{jobId}", {
				params: { path: { jobId: item.jobId ?? "" } },
			}),
		})),
	});

	useEffect(() => {
		addJobEntries.forEach(([identifier, item], idx) => {
			const result = detailsQueries[idx]?.data?.data;
			if (
				!result ||
				!item.jobId ||
				!item.detailsScriptId ||
				result.status === "pending"
			) {
				return;
			}

			if (result.status === "failed") {
				setAddState((prev) => ({
					...prev,
					[identifier]: {
						...item,
						jobId: null,
						status: "error",
						error: result.error ?? "Details script failed",
					},
				}));
				return;
			}

			const schema = props.entitySchema;
			const detailsValue = result.value as {
				name: string;
				externalId: string;
				properties: {
					[key: string]: unknown;
					assets?: { remoteImages?: string[] };
				};
			};

			const firstImage = detailsValue.properties?.assets?.remoteImages?.[0];
			const image = firstImage
				? { kind: "remote" as const, url: firstImage }
				: null;

			const properties: Record<string, unknown> = {};
			for (const key of Object.keys(schema.propertiesSchema.fields)) {
				if (detailsValue.properties[key] !== undefined) {
					properties[key] = detailsValue.properties[key];
				}
			}

			setAddState((prev) => ({
				...prev,
				[identifier]: { ...item, jobId: null, error: null },
			}));

			createEntity.mutate(
				{
					body: {
						image,
						properties,
						name: detailsValue.name,
						entitySchemaId: schema.id,
						externalId: detailsValue.externalId,
						detailsSandboxScriptId: item.detailsScriptId,
					},
				},
				{
					onSuccess: () => {
						setAddState((prev) => ({
							...prev,
							[identifier]: {
								error: null,
								jobId: null,
								status: "done",
								detailsScriptId: null,
								...prev[identifier],
							},
						}));
						props.onEntityAdded();
					},
					onError: (err) => {
						setAddState((prev) => ({
							...prev,
							[identifier]: {
								...initialAddItemState(),
								...prev[identifier],
								status: "error",
								error: getErrorMessage(err),
							},
						}));
					},
				},
			);
		});
	}, [
		createEntity,
		detailsQueries,
		addJobEntries,
		props.entitySchema,
		props.onEntityAdded,
	]);

	const runSearch = useCallback(
		async (searchPage: number) => {
			const provider =
				props.entitySchema.searchProviders[selectedProviderIndex];
			if (!provider || !query.trim()) {
				return;
			}

			setSearchState((prev) => ({ ...prev, error: null, request: null }));

			try {
				const result = await enqueueSearch.mutateAsync({
					body: {
						kind: "script",
						scriptId: provider.searchScriptId,
						context: { page: searchPage, query, pageSize: 10 },
					},
				});
				const jobId = result.data?.jobId;
				if (!jobId) {
					throw new Error("Failed to enqueue search script");
				}
				setSearchState((prev) => ({
					...prev,
					request: { jobId, page: searchPage },
				}));
			} catch (err) {
				setSearchState((prev) => ({
					...prev,
					request: null,
					error: getErrorMessage(err),
				}));
			}
		},
		[
			query,
			enqueueSearch,
			selectedProviderIndex,
			props.entitySchema.searchProviders,
		],
	);

	const search = useCallback(() => void runSearch(1), [runSearch]);

	const clearSearch = useCallback(() => setSearchState(initialSearchState), []);

	const goToPage = useCallback(
		(newPage: number) => void runSearch(newPage),
		[runSearch],
	);

	const addItem = useCallback(
		async (item: SearchResultItem) => {
			const provider =
				props.entitySchema.searchProviders[selectedProviderIndex];
			if (!provider) {
				return;
			}

			setAddState((prev) => ({
				...prev,
				[item.identifier]: {
					error: null,
					jobId: null,
					status: "loading",
					detailsScriptId: provider.detailsScriptId,
				},
			}));

			try {
				const result = await enqueueDetails.mutateAsync({
					body: {
						kind: "script",
						scriptId: provider.detailsScriptId,
						context: { identifier: item.identifier },
					},
				});
				const jobId = result.data?.jobId;
				if (!jobId) {
					throw new Error("Failed to enqueue details script");
				}
				setAddState((prev) => ({
					...prev,
					[item.identifier]: {
						...initialAddItemState(),
						...prev[item.identifier],
						jobId,
						error: null,
						status: "loading",
					},
				}));
			} catch (err) {
				setAddState((prev) => ({
					...prev,
					[item.identifier]: {
						...initialAddItemState(),
						...prev[item.identifier],
						status: "error",
						error: getErrorMessage(err),
					},
				}));
			}
		},
		[enqueueDetails, props.entitySchema.searchProviders, selectedProviderIndex],
	);

	const addError = useMemo(
		() =>
			Object.fromEntries(
				Object.entries(addState)
					.filter(([, item]) => item.error)
					.map(([identifier, item]) => [identifier, item.error ?? undefined]),
			),
		[addState],
	);

	const addStatus = useMemo(
		() =>
			Object.fromEntries(
				Object.entries(addState).map(([identifier, item]) => [
					identifier,
					item.status,
				]),
			),
		[addState],
	);

	return {
		query,
		search,
		addItem,
		setQuery,
		addError,
		goToPage,
		addStatus,
		isSearching,
		clearSearch,
		selectedProviderIndex,
		page: searchState.page,
		setSelectedProviderIndex,
		results: searchState.results,
		nextPage: searchState.nextPage,
		searchError: searchState.error,
		totalItems: searchState.totalItems,
	};
}
