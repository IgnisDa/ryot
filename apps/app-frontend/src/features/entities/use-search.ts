import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppEntitySchema } from "#/features/entity-schemas/model";
import { useApiClient } from "#/hooks/api";
import type { ApiPostResponseData } from "#/lib/api/types";
import { getErrorMessage } from "#/lib/errors";
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

type AddStatus = "idle" | "loading" | "done" | "error";

type SearchState = {
	page: number;
	totalItems: number;
	error: string | null;
	nextPage: number | null;
	results: SearchResultItem[] | null;
};

type SearchResultDetails = {
	name: string;
	externalId: string;
	properties: {
		[key: string]: unknown;
		assets?: { remoteImages?: string[] };
	};
};

type EnsuredEntity = ApiPostResponseData<"/entities">;

type AddItemState = {
	status: AddStatus;
	error: string | null;
	entity: EnsuredEntity | null;
};

type AddState = Record<string, AddItemState>;

const initialSearchState: SearchState = {
	page: 1,
	error: null,
	results: null,
	totalItems: 0,
	nextPage: null,
};

const initialAddItemState = (): AddItemState => ({
	error: null,
	entity: null,
	status: "idle",
});

const POLL_MS = 500;
const SANDBOX_TIMEOUT_MS = 30000;
const cancelledRequestMessage = "Request was cancelled";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function isCancelledEntitySearchError(error: unknown) {
	return getErrorMessage(error) === cancelledRequestMessage;
}

export function useEntitySearch(props: { entitySchema: AppEntitySchema }) {
	const apiClient = useApiClient();
	const queryClient = useQueryClient();

	const inFlightEntityLoadsRef = useRef(
		new Map<string, Promise<EnsuredEntity>>(),
	);
	const isMountedRef = useRef(true);
	const sessionVersionRef = useRef(0);

	const [query, setQuery] = useState("");
	const [addState, setAddState] = useState<AddState>({});
	const [searchState, setSearchState] = useState(initialSearchState);
	const [selectedProviderIndex, setSelectedProviderIndex] = useState(0);
	const [isSearching, setIsSearching] = useState(false);

	const createEntity = apiClient.useMutation("post", "/entities");
	const enqueueSearch = apiClient.useMutation("post", "/sandbox/enqueue");
	const enqueueDetails = apiClient.useMutation("post", "/sandbox/enqueue");
	const entityListQueryKey = apiClient.queryOptions(
		"post",
		"/view-runtime/execute",
		{ body: createEntityRuntimeRequest(props.entitySchema.slug) },
	).queryKey;

	useEffect(() => {
		return () => {
			isMountedRef.current = false;
			sessionVersionRef.current += 1;
		};
	}, []);

	const isActiveSession = useCallback((sessionVersion: number) => {
		return isMountedRef.current && sessionVersion === sessionVersionRef.current;
	}, []);

	const assertActiveSession = useCallback(
		(sessionVersion: number) => {
			if (!isActiveSession(sessionVersion)) {
				throw new Error(cancelledRequestMessage);
			}
		},
		[isActiveSession],
	);

	const pollSandboxResult = useCallback(
		async (jobId: string, sessionVersion: number) => {
			const startedAt = Date.now();

			while (true) {
				assertActiveSession(sessionVersion);
				const result = await queryClient.fetchQuery({
					...apiClient.queryOptions("get", "/sandbox/result/{jobId}", {
						params: { path: { jobId } },
					}),
					staleTime: 0,
				});

				assertActiveSession(sessionVersion);
				const data = result.data;
				if (data?.status === "pending") {
					if (Date.now() - startedAt >= SANDBOX_TIMEOUT_MS) {
						throw new Error("Timed out waiting for sandbox result");
					}
					await sleep(POLL_MS);
					continue;
				}

				return data;
			}
		},
		[apiClient, assertActiveSession, queryClient],
	);

	const ensureItemEntity = useCallback(
		async (item: SearchResultItem) => {
			const existingEntity = addState[item.identifier]?.entity;
			if (existingEntity) {
				return existingEntity;
			}

			const inFlight = inFlightEntityLoadsRef.current.get(item.identifier);
			if (inFlight) {
				return inFlight;
			}

			const provider =
				props.entitySchema.searchProviders[selectedProviderIndex];
			if (!provider) {
				throw new Error("Search provider is unavailable");
			}
			const sessionVersion = sessionVersionRef.current;

			const entityPromise = (async () => {
				if (isActiveSession(sessionVersion)) {
					setAddState((prev) => ({
						...prev,
						[item.identifier]: {
							...initialAddItemState(),
							...prev[item.identifier],
							status: "loading",
							error: null,
						},
					}));
				}

				try {
					assertActiveSession(sessionVersion);
					const enqueueResult = await enqueueDetails.mutateAsync({
						body: {
							kind: "script",
							scriptId: provider.detailsScriptId,
							context: { identifier: item.identifier },
						},
					});
					const jobId = enqueueResult.data?.jobId;
					if (!jobId) {
						throw new Error("Failed to enqueue details script");
					}

					const detailsResult = await pollSandboxResult(jobId, sessionVersion);
					if (!detailsResult) {
						throw new Error("Details script did not finish");
					}
					if (detailsResult.status === "failed") {
						throw new Error(detailsResult.error ?? "Details script failed");
					}

					const detailsValue = detailsResult.value as SearchResultDetails;
					const firstImage = detailsValue.properties?.assets?.remoteImages?.[0];
					const image = firstImage
						? { kind: "remote" as const, url: firstImage }
						: null;

					const properties: Record<string, unknown> = {};
					for (const key of Object.keys(
						props.entitySchema.propertiesSchema.fields,
					)) {
						if (detailsValue.properties[key] !== undefined) {
							properties[key] = detailsValue.properties[key];
						}
					}

					const createResult = await createEntity.mutateAsync({
						body: {
							image,
							properties,
							name: detailsValue.name,
							externalId: detailsValue.externalId,
							entitySchemaId: props.entitySchema.id,
							detailsSandboxScriptId: provider.detailsScriptId,
						},
					});
					const entity = createResult.data;
					if (!entity) {
						throw new Error("Failed to create entity");
					}
					assertActiveSession(sessionVersion);

					setAddState((prev) => ({
						...prev,
						[item.identifier]: { entity, error: null, status: "done" },
					}));
					queryClient.invalidateQueries({ queryKey: entityListQueryKey });

					return entity;
				} catch (error) {
					if (!isActiveSession(sessionVersion)) {
						throw error;
					}

					const message = getErrorMessage(error);
					setAddState((prev) => ({
						...prev,
						[item.identifier]: {
							...initialAddItemState(),
							...prev[item.identifier],
							error: message,
							status: "error",
						},
					}));
					throw error;
				} finally {
					inFlightEntityLoadsRef.current.delete(item.identifier);
				}
			})();

			inFlightEntityLoadsRef.current.set(item.identifier, entityPromise);
			return entityPromise;
		},
		[
			addState,
			queryClient,
			createEntity,
			enqueueDetails,
			isActiveSession,
			pollSandboxResult,
			props.entitySchema,
			entityListQueryKey,
			assertActiveSession,
			selectedProviderIndex,
		],
	);

	const runSearch = useCallback(
		async (searchPage: number) => {
			const provider =
				props.entitySchema.searchProviders[selectedProviderIndex];
			if (!provider || !query.trim()) {
				return;
			}
			const sessionVersion = sessionVersionRef.current;

			setIsSearching(true);
			setSearchState((prev) => ({ ...prev, error: null }));

			try {
				assertActiveSession(sessionVersion);
				const enqueueResult = await enqueueSearch.mutateAsync({
					body: {
						kind: "script",
						scriptId: provider.searchScriptId,
						context: { page: searchPage, query, pageSize: 10 },
					},
				});
				const jobId = enqueueResult.data?.jobId;
				if (!jobId) {
					throw new Error("Failed to enqueue search script");
				}

				const result = await pollSandboxResult(jobId, sessionVersion);
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

				assertActiveSession(sessionVersion);
				setSearchState({
					error: null,
					page: searchPage,
					results: value.items ?? [],
					nextPage: value.details?.nextPage ?? null,
					totalItems: value.details?.totalItems ?? 0,
				});
			} catch (error) {
				if (isActiveSession(sessionVersion)) {
					setSearchState((prev) => ({
						...prev,
						error: getErrorMessage(error),
					}));
				}
			} finally {
				if (isActiveSession(sessionVersion)) {
					setIsSearching(false);
				}
			}
		},
		[
			query,
			enqueueSearch,
			isActiveSession,
			pollSandboxResult,
			assertActiveSession,
			selectedProviderIndex,
			props.entitySchema.searchProviders,
		],
	);

	const search = useCallback(() => void runSearch(1), [runSearch]);

	const clearSearch = useCallback(() => {
		sessionVersionRef.current += 1;
		setSearchState(initialSearchState);
		setAddState({});
		setIsSearching(false);
	}, []);

	const goToPage = useCallback(
		(newPage: number) => void runSearch(newPage),
		[runSearch],
	);

	const addItem = useCallback(
		async (item: SearchResultItem) => {
			await ensureItemEntity(item);
		},
		[ensureItemEntity],
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
		ensureItemEntity,
		selectedProviderIndex,
		page: searchState.page,
		setSelectedProviderIndex,
		results: searchState.results,
		nextPage: searchState.nextPage,
		searchError: searchState.error,
		totalItems: searchState.totalItems,
	};
}
