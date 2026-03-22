import { useQueries } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
type AddJob = { jobId: string; detailsScriptId: string };

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

	const [page, setPage] = useState(1);
	const [query, setQuery] = useState("");
	const [totalItems, setTotalItems] = useState(0);
	const [pendingPage, setPendingPage] = useState(1);
	const processedJobsRef = useRef(new Set<string>());
	const [nextPage, setNextPage] = useState<number | null>(null);
	const [addJobs, setAddJobs] = useState<Record<string, AddJob>>({});
	const [searchError, setSearchError] = useState<string | null>(null);
	const [searchJobId, setSearchJobId] = useState<string | null>(null);
	const [addError, setAddError] = useState<Record<string, string>>({});
	const [selectedProviderIndex, setSelectedProviderIndex] = useState(0);
	const [results, setResults] = useState<SearchResultItem[] | null>(null);
	const [addStatus, setAddStatus] = useState<Record<string, AddStatus>>({});

	const createEntity = apiClient.useMutation("post", "/entities");
	const enqueueSearch = apiClient.useMutation("post", "/sandbox/enqueue");
	const enqueueDetails = apiClient.useMutation("post", "/sandbox/enqueue");

	const enqueueSearchRef = useRef(enqueueSearch);
	enqueueSearchRef.current = enqueueSearch;
	const enqueueDetailsRef = useRef(enqueueDetails);
	enqueueDetailsRef.current = enqueueDetails;
	const createEntityRef = useRef(createEntity);
	createEntityRef.current = createEntity;
	const onEntityAddedRef = useRef(props.onEntityAdded);
	onEntityAddedRef.current = props.onEntityAdded;
	const entitySchemaRef = useRef(props.entitySchema);
	entitySchemaRef.current = props.entitySchema;

	const searchResultQuery = apiClient.useQuery(
		"get",
		"/sandbox/result/{jobId}",
		{ params: { path: { jobId: searchJobId ?? "" } } },
		{ enabled: !!searchJobId, refetchInterval: sandboxRefetchInterval },
	);

	const isSearching = enqueueSearch.isPending || !!searchJobId;

	useEffect(() => {
		const result = searchResultQuery.data?.data;
		if (!searchJobId || !result || result.status === "pending") {
			return;
		}

		setSearchJobId(null);

		if (result.status === "failed") {
			setSearchError(result.error ?? "Search script failed");
			return;
		}

		const value = result.value as {
			items: SearchResultItem[];
			details: { totalItems: number; nextPage: number | null };
		};
		setPage(pendingPage);
		setResults(value.items ?? []);
		setTotalItems(value.details?.totalItems ?? 0);
		setNextPage(value.details?.nextPage ?? null);
	}, [searchResultQuery.data?.data, searchJobId, pendingPage]);

	const addJobEntries = useMemo(() => Object.entries(addJobs), [addJobs]);

	const detailsQueries = useQueries({
		queries: addJobEntries.map(([, { jobId }]) => ({
			...apiClient.queryOptions("get", "/sandbox/result/{jobId}", {
				params: { path: { jobId } },
			}),
			refetchInterval: sandboxRefetchInterval,
		})),
	});

	useEffect(() => {
		addJobEntries.forEach(([identifier, { jobId, detailsScriptId }], idx) => {
			const result = detailsQueries[idx]?.data?.data;
			if (!result || result.status === "pending") {
				return;
			}
			if (processedJobsRef.current.has(jobId)) {
				return;
			}
			processedJobsRef.current.add(jobId);

			if (result.status === "failed") {
				setAddStatus((p) => ({ ...p, [identifier]: "error" }));
				setAddError((p) => ({
					...p,
					[identifier]: result.error ?? "Details script failed",
				}));
				return;
			}

			const schema = entitySchemaRef.current;
			const detailsValue = result.value as {
				name: string;
				externalId: string;
				properties: {
					assets?: { remoteImages?: string[] };
					[key: string]: unknown;
				};
			};

			const firstImage = detailsValue.properties?.assets?.remoteImages?.[0];
			const image = firstImage
				? { kind: "remote" as const, url: firstImage }
				: null;

			const properties: Record<string, unknown> = {};
			for (const key of Object.keys(schema.propertiesSchema)) {
				if (detailsValue.properties[key] !== undefined) {
					properties[key] = detailsValue.properties[key];
				}
			}

			createEntityRef.current.mutate(
				{
					body: {
						image,
						properties,
						name: detailsValue.name,
						entitySchemaId: schema.id,
						externalId: detailsValue.externalId,
						detailsSandboxScriptId: detailsScriptId,
					},
				},
				{
					onSuccess: () => {
						setAddStatus((p) => ({ ...p, [identifier]: "done" }));
						onEntityAddedRef.current();
					},
					onError: (err) => {
						setAddStatus((p) => ({ ...p, [identifier]: "error" }));
						setAddError((p) => ({
							...p,
							[identifier]: getErrorMessage(err),
						}));
					},
				},
			);
		});
	}, [detailsQueries, addJobEntries]);

	const runSearch = useCallback(
		async (searchPage: number) => {
			const provider =
				props.entitySchema.searchProviders[selectedProviderIndex];
			if (!provider || !query.trim()) {
				return;
			}

			setSearchError(null);
			setPendingPage(searchPage);

			try {
				const result = await enqueueSearchRef.current.mutateAsync({
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
				setSearchJobId(jobId);
			} catch (err) {
				setSearchError(getErrorMessage(err));
			}
		},
		[props.entitySchema.searchProviders, selectedProviderIndex, query],
	);

	const search = useCallback(() => void runSearch(1), [runSearch]);

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

			setAddStatus((p) => ({ ...p, [item.identifier]: "loading" }));
			setAddError((p) => {
				const next = { ...p };
				delete next[item.identifier];
				return next;
			});

			try {
				const result = await enqueueDetailsRef.current.mutateAsync({
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
				setAddJobs((p) => ({
					...p,
					[item.identifier]: {
						jobId,
						detailsScriptId: provider.detailsScriptId,
					},
				}));
			} catch (err) {
				setAddStatus((p) => ({ ...p, [item.identifier]: "error" }));
				setAddError((p) => ({
					...p,
					[item.identifier]: getErrorMessage(err),
				}));
			}
		},
		[props.entitySchema.searchProviders, selectedProviderIndex],
	);

	return {
		page,
		query,
		search,
		addItem,
		results,
		setQuery,
		addError,
		nextPage,
		goToPage,
		addStatus,
		totalItems,
		isSearching,
		searchError,
		selectedProviderIndex,
		setSelectedProviderIndex,
	};
}
