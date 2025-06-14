import {
	ActionIcon,
	Badge,
	Button,
	Group,
	Loader,
	ScrollArea,
	SegmentedControl,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
	useCollectionDiscovery,
	useCollectionsDestination,
} from "~/features/collections";
import type { AppEntitySchema } from "~/features/entity-schemas/model";
import { useEventSchemasQuery } from "~/features/event-schemas/hooks";
import { useApiClient } from "~/hooks/api";
import { getErrorMessage } from "~/lib/errors";
import {
	createBacklogEventPayload,
	createLogEventPayload,
	createReviewEventPayload,
	getMediaLifecycleUnavailableMessage,
} from "./search-modal-media-actions";
import {
	defaultSearchResultRowActionState,
	SearchResultRow,
	type SearchResultRowActionState,
} from "./search-result-row";
import type { SearchResultItem } from "./use-search";
import { isCancelledEntitySearchError, useEntitySearch } from "./use-search";

export function SearchEntityModalTitle(props: {
	onBack: () => void;
	actionVerb?: string;
	entitySchemaName: string;
}) {
	return (
		<Group gap="xs">
			<ActionIcon
				size="sm"
				variant="subtle"
				onClick={props.onBack}
				aria-label="Back to type picker"
			>
				<ChevronLeft size={16} />
			</ActionIcon>
			<Text ff="var(--mantine-headings-font-family)" fw={600} fz="md">
				{props.actionVerb ?? "Add"} {props.entitySchemaName}
			</Text>
		</Group>
	);
}

export function SearchEntityModalContent(props: {
	entitySchema: AppEntitySchema;
	onActionCompleted?: () => void;
	initialAction?: "log" | "backlog";
}) {
	const apiClient = useApiClient();
	const queryClient = useQueryClient();
	const createEvents = apiClient.useMutation("post", "/events");
	const addToCollection = apiClient.useMutation(
		"post",
		"/collections/memberships",
	);
	const eventSchemasQuery = useEventSchemasQuery(props.entitySchema.id, true);
	const { state: collectionState } = useCollectionDiscovery();
	const collectionsDestination = useCollectionsDestination();
	const {
		page,
		query,
		search,
		results,
		addItem,
		setQuery,
		addError,
		nextPage,
		goToPage,
		addStatus,
		totalItems,
		isSearching,
		searchError,
		clearSearch,
		ensureItemEntity,
		selectedProviderIndex,
		setSelectedProviderIndex,
	} = useEntitySearch({ entitySchema: props.entitySchema });

	const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
	const [actionStateById, setActionStateById] = useState<
		Record<string, SearchResultRowActionState>
	>({});

	const accentColor = props.entitySchema.accentColor ?? "#8C7560";
	const activeProvider = props.entitySchema.providers[selectedProviderIndex];
	const lifecycleErrorMessage = useMemo(() => {
		if (eventSchemasQuery.isError) {
			return "Lifecycle actions failed to load.";
		}

		return getMediaLifecycleUnavailableMessage(eventSchemasQuery.eventSchemas);
	}, [eventSchemasQuery.eventSchemas, eventSchemasQuery.isError]);

	const getActionState = useCallback(
		(identifier: string) =>
			actionStateById[identifier] ?? defaultSearchResultRowActionState,
		[actionStateById],
	);

	const patchActionState = useCallback(
		(identifier: string, patch: Partial<SearchResultRowActionState>) => {
			setActionStateById((prev) => ({
				...prev,
				[identifier]: {
					...(prev[identifier] ?? defaultSearchResultRowActionState),
					...patch,
				},
			}));
		},
		[],
	);

	const markDone = useCallback(
		(
			identifier: string,
			actions: SearchResultRowActionState["doneActions"],
		) => {
			const current = getActionState(identifier);
			patchActionState(identifier, {
				doneActions: [...new Set([...current.doneActions, ...actions])],
			});
		},
		[getActionState, patchActionState],
	);

	const handleProviderChange = useCallback(
		(value: string) => {
			clearSearch();
			setSelectedResultId(null);
			setActionStateById({});
			setSelectedProviderIndex(Number(value));
		},
		[clearSearch, setSelectedProviderIndex],
	);

	const handleAdd = useCallback(
		async (item: SearchResultItem) => {
			patchActionState(item.identifier, {
				actionError: null,
				pendingAction: "add",
			});

			let entityId: string | null = null;
			try {
				const entity = await addItem(item);
				entityId = entity.id;
				markDone(item.identifier, ["track"]);

				if (collectionState.type === "collections") {
					const firstCollection = collectionState.collections[0];
					if (firstCollection) {
						await addToCollection.mutateAsync({
							body: {
								entityId: entity.id,
								collectionId: firstCollection.id,
								properties: {},
							},
						});
						markDone(item.identifier, ["collection"]);
					}
				}

				props.onActionCompleted?.();
				notifications.show({
					color: "green",
					title: "Added",
					message: `${item.titleProperty.value} is in your library.`,
				});
			} catch (error) {
				if (isCancelledEntitySearchError(error)) {
					return;
				}

				const message = entityId
					? `${item.titleProperty.value} is in your library, but could not be added to the collection: ${getErrorMessage(error)}`
					: getErrorMessage(error);
				if (entityId) {
					markDone(item.identifier, ["track"]);
				}
				patchActionState(item.identifier, {
					actionError: message,
				});
			} finally {
				patchActionState(item.identifier, { pendingAction: null });
			}
		},
		[addItem, markDone, patchActionState, addToCollection, collectionState],
	);

	const runLifecycleAction = useCallback(
		async (input: {
			identifier: string;
			item: SearchResultItem;
			pendingAction: "backlog" | "log" | "rate";
			buildPayload: (
				entityId: string,
			) => ReturnType<typeof createBacklogEventPayload>;
			successMessage: string;
			partialFailureMessage: string;
			doneAction: "backlog" | "log" | "rate";
		}) => {
			patchActionState(input.identifier, {
				actionError: null,
				pendingAction: input.pendingAction,
			});

			let entityId: string | null = null;
			try {
				const entity = await ensureItemEntity(input.item);
				entityId = entity.id;
				await createEvents.mutateAsync({
					body: input.buildPayload(entity.id),
				});
				queryClient.invalidateQueries({
					queryKey: apiClient.queryOptions("get", "/events", {
						params: { query: { entityId: entity.id } },
					}).queryKey,
				});
				markDone(input.identifier, ["track", input.doneAction]);
				props.onActionCompleted?.();
				patchActionState(input.identifier, {
					actionError: null,
					openPanel: null,
				});
				notifications.show({
					color: "green",
					title: "Saved",
					message: input.successMessage,
				});
			} catch (error) {
				if (isCancelledEntitySearchError(error)) {
					return;
				}

				const message = entityId
					? `${input.partialFailureMessage} ${getErrorMessage(error)}`
					: getErrorMessage(error);
				if (entityId) {
					markDone(input.identifier, ["track"]);
				}
				patchActionState(input.identifier, {
					actionError: message,
					openPanel: entityId
						? getActionState(input.identifier).openPanel
						: null,
				});
			} finally {
				patchActionState(input.identifier, { pendingAction: null });
			}
		},
		[
			markDone,
			apiClient,
			queryClient,
			createEvents,
			getActionState,
			ensureItemEntity,
			patchActionState,
		],
	);

	const handleBacklog = useCallback(
		(item: SearchResultItem) => {
			if (lifecycleErrorMessage) {
				return;
			}

			return runLifecycleAction({
				item,
				doneAction: "backlog",
				pendingAction: "backlog",
				identifier: item.identifier,
				successMessage: `${item.titleProperty.value} is now in your backlog.`,
				partialFailureMessage: `${item.titleProperty.value} is in your library, but it could not be added to backlog.`,
				buildPayload: (entityId) =>
					createBacklogEventPayload({
						entityId,
						eventSchemas: eventSchemasQuery.eventSchemas,
					}),
			});
		},
		[eventSchemasQuery.eventSchemas, lifecycleErrorMessage, runLifecycleAction],
	);

	const handleSaveLog = useCallback(
		(item: SearchResultItem) => {
			if (lifecycleErrorMessage) {
				return;
			}

			const state = getActionState(item.identifier);
			try {
				createLogEventPayload({
					entityId: "",
					logDate: state.logDate,
					startedOn: state.logStartedOn,
					completedOn: state.logCompletedOn,
					eventSchemas: eventSchemasQuery.eventSchemas,
				});
			} catch (error) {
				patchActionState(item.identifier, {
					actionError: getErrorMessage(error),
				});
				return;
			}

			void runLifecycleAction({
				item,
				doneAction: "log",
				pendingAction: "log",
				identifier: item.identifier,
				successMessage:
					state.logDate === "started"
						? `Marked ${item.titleProperty.value} as started.`
						: `Logged ${item.titleProperty.value}.`,
				partialFailureMessage:
					state.logDate === "started"
						? `${item.titleProperty.value} is in your library, but it could not be marked as started.`
						: `${item.titleProperty.value} is in your library, but it could not be logged.`,
				buildPayload: (entityId) =>
					createLogEventPayload({
						entityId,
						logDate: state.logDate,
						startedOn: state.logStartedOn,
						completedOn: state.logCompletedOn,
						eventSchemas: eventSchemasQuery.eventSchemas,
					}),
			});
		},
		[
			getActionState,
			patchActionState,
			runLifecycleAction,
			lifecycleErrorMessage,
			eventSchemasQuery.eventSchemas,
		],
	);

	const handleSaveReview = useCallback(
		(item: SearchResultItem) => {
			if (lifecycleErrorMessage) {
				return;
			}

			const state = getActionState(item.identifier);
			try {
				createReviewEventPayload({
					entityId: "",
					rating: state.rateStars,
					review: state.rateReview,
					eventSchemas: eventSchemasQuery.eventSchemas,
				});
			} catch (error) {
				patchActionState(item.identifier, {
					actionError: getErrorMessage(error),
				});
				return;
			}

			void runLifecycleAction({
				item,
				doneAction: "rate",
				pendingAction: "rate",
				identifier: item.identifier,
				successMessage: `Saved your review for ${item.titleProperty.value}.`,
				partialFailureMessage: `${item.titleProperty.value} is in your library, but the review could not be saved.`,
				buildPayload: (entityId) =>
					createReviewEventPayload({
						entityId,
						rating: state.rateStars,
						review: state.rateReview,
						eventSchemas: eventSchemasQuery.eventSchemas,
					}),
			});
		},
		[
			getActionState,
			patchActionState,
			runLifecycleAction,
			lifecycleErrorMessage,
			eventSchemasQuery.eventSchemas,
		],
	);

	const handleSaveCollection = useCallback(
		async (item: SearchResultItem) => {
			const state = getActionState(item.identifier);
			if (!state.selectedCollectionId) {
				return;
			}

			patchActionState(item.identifier, {
				actionError: null,
				pendingAction: "collection",
			});

			let entityId: string | null = null;
			try {
				const entity = await ensureItemEntity(item);
				entityId = entity.id;
				await addToCollection.mutateAsync({
					body: {
						collectionId: state.selectedCollectionId,
						entityId: entity.id,
						properties: state.collectionProperties,
					},
				});
				markDone(item.identifier, ["track", "collection"]);
				props.onActionCompleted?.();
				patchActionState(item.identifier, {
					actionError: null,
					openPanel: null,
				});
				const collectionName =
					collectionState.type === "collections"
						? (collectionState.collections.find(
								(c) => c.id === state.selectedCollectionId,
							)?.name ?? "collection")
						: "collection";
				notifications.show({
					color: "green",
					title: "Added to collection",
					message: `${item.titleProperty.value} was added to ${collectionName}.`,
				});
			} catch (error) {
				if (isCancelledEntitySearchError(error)) {
					return;
				}

				const message = entityId
					? `${item.titleProperty.value} is in your library, but could not be added to the collection: ${getErrorMessage(error)}`
					: getErrorMessage(error);
				if (entityId) {
					markDone(item.identifier, ["track"]);
				}
				patchActionState(item.identifier, {
					actionError: message,
					openPanel: entityId
						? getActionState(item.identifier).openPanel
						: null,
				});
			} finally {
				patchActionState(item.identifier, { pendingAction: null });
			}
		},
		[
			addToCollection,
			markDone,
			getActionState,
			ensureItemEntity,
			patchActionState,
			collectionState,
		],
	);

	const collections = useMemo(() => {
		if (collectionState.type === "collections") {
			return collectionState.collections.map((c) => ({
				id: c.id,
				name: c.name,
			}));
		}
		return [];
	}, [collectionState]);

	const canUseCollectionAction =
		collections.length > 0 &&
		collectionsDestination.destination.type !== "none";

	return (
		<Stack gap="md">
			{props.entitySchema.providers.length > 1 ? (
				<SegmentedControl
					fullWidth
					onChange={handleProviderChange}
					value={String(selectedProviderIndex)}
					data={props.entitySchema.providers.map((provider, index) => ({
						label: provider.name,
						value: String(index),
					}))}
				/>
			) : null}

			<Group>
				<TextInput
					flex={1}
					value={query}
					disabled={isSearching}
					leftSection={<Search size={16} strokeWidth={1.5} />}
					onChange={(event) => setQuery(event.currentTarget.value)}
					placeholder={`Search for a ${props.entitySchema.name.toLowerCase()}...`}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							search();
						}
					}}
				/>
				<Button
					onClick={search}
					loading={isSearching}
					disabled={!query.trim()}
					style={{ color: "white", backgroundColor: accentColor }}
				>
					Search
				</Button>
			</Group>

			{searchError ? (
				<Text c="red" size="sm">
					{searchError}
				</Text>
			) : null}

			{isSearching ? (
				<Stack align="center" py="xl">
					<Loader size="sm" color={accentColor} />
					<Text size="sm" c="dimmed">
						Searching...
					</Text>
				</Stack>
			) : null}

			{results !== null && !isSearching ? (
				<Stack gap="xs">
					{results.length === 0 ? (
						<Text c="dimmed" size="sm" ta="center" py="md">
							No results found
						</Text>
					) : (
						<>
							<Group justify="flex-end" align="center" px={2}>
								<Badge
									variant="light"
									style={{
										color: accentColor,
										backgroundColor: `${accentColor}12`,
									}}
								>
									{totalItems} result{totalItems === 1 ? "" : "s"}
								</Badge>
							</Group>
							<ScrollArea.Autosize mah={460}>
								<Stack gap={6}>
									{results.map((item) => (
										<SearchResultRow
											item={item}
											key={item.identifier}
											accentColor={accentColor}
											onAdd={() => void handleAdd(item)}
											addError={addError[item.identifier]}
											entityName={props.entitySchema.name}
											onSaveLog={() => handleSaveLog(item)}
											providerName={activeProvider?.name ?? ""}
											onBacklog={() => void handleBacklog(item)}
											onSaveReview={() => handleSaveReview(item)}
											onSaveCollection={() => void handleSaveCollection(item)}
											actionState={getActionState(item.identifier)}
											lifecycleErrorMessage={lifecycleErrorMessage}
											addStatus={addStatus[item.identifier] ?? "idle"}
											isLifecycleLoading={eventSchemasQuery.isLoading}
											isExpanded={selectedResultId === item.identifier}
											canUseCollectionAction={canUseCollectionAction}
											collectionState={collectionState}
											collectionsDestination={
												collectionsDestination.destination
											}
											primaryAction={
												props.initialAction === "backlog" ? "backlog" : "add"
											}
											onPatchActionState={(patch) =>
												patchActionState(item.identifier, patch)
											}
											onToggleActions={() => {
												const isCurrentlyExpanded =
													selectedResultId === item.identifier;
												setSelectedResultId((current) =>
													current === item.identifier ? null : item.identifier,
												);
												if (
													!isCurrentlyExpanded &&
													props.initialAction === "log"
												) {
													patchActionState(item.identifier, {
														openPanel: "log",
														actionError: null,
													});
												} else {
													patchActionState(item.identifier, {
														openPanel: null,
													});
												}
											}}
											onTogglePanel={(panel) => {
												setSelectedResultId(item.identifier);
												const state = getActionState(item.identifier);
												patchActionState(item.identifier, {
													actionError: null,
													openPanel: state.openPanel === panel ? null : panel,
												});
											}}
										/>
									))}
								</Stack>
							</ScrollArea.Autosize>

							{page > 1 || nextPage !== null ? (
								<Group justify="center" gap="xs">
									<Button
										size="xs"
										variant="subtle"
										disabled={page <= 1 || isSearching}
										leftSection={<ChevronLeft size={14} />}
										onClick={() => goToPage(page - 1)}
									>
										Prev
									</Button>
									<Text size="xs" c="dimmed">
										Page {page}
									</Text>
									<Button
										size="xs"
										variant="subtle"
										rightSection={<ChevronRight size={14} />}
										onClick={() => goToPage(page + 1)}
										disabled={nextPage === null || isSearching}
									>
										Next
									</Button>
								</Group>
							) : null}
						</>
					)}
				</Stack>
			) : null}
		</Stack>
	);
}
