import {
	ActionIcon,
	Badge,
	Button,
	Group,
	Loader,
	ScrollArea,
	SegmentedControl,
	Select,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
	buildMembershipFormSchema,
	type CollectionMembershipFormValues,
	toMembershipPayload,
	useCollectionDiscovery,
	useCollectionsDestination,
} from "~/features/collections";
import type { AppEntitySchema } from "~/features/entity-schemas/model";
import { useEventSchemasQuery } from "~/features/event-schemas/hooks";
import { useApiClient } from "~/hooks/api";
import { getErrorMessage } from "~/lib/errors";

import type { SearchResultItem } from "./model";
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
	const addToCollection = apiClient.useMutation("post", "/collections/memberships");
	const eventSchemasQuery = useEventSchemasQuery(props.entitySchema.id, true);
	const { state: collectionState, refetch: refetchCollections } = useCollectionDiscovery();
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
		trackedExternalIds,
		selectedProviderIndex,
		setSelectedProviderIndex,
		ensuredEntityByExternalId,
	} = useEntitySearch({ entitySchema: props.entitySchema });

	const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
	const [actionStateById, setActionStateById] = useState<
		Record<string, SearchResultRowActionState>
	>({});

	const isPersonSchema = props.entitySchema.slug === "person";
	const isEpisodicEntity = ["show", "anime", "manga", "podcast"].includes(props.entitySchema.slug);
	const accentColor = props.entitySchema.accentColor ?? "#8C7560";
	const activeProvider = props.entitySchema.providers[selectedProviderIndex];
	const lifecycleErrorMessage = useMemo(() => {
		if (eventSchemasQuery.isError) {
			return "Lifecycle actions failed to load.";
		}

		if (isPersonSchema) {
			const hasReviewSchema = eventSchemasQuery.eventSchemas.some((s) => s.slug === "review");
			return hasReviewSchema
				? null
				: "Review is unavailable. Please check your event schemas configuration.";
		}

		return getMediaLifecycleUnavailableMessage(eventSchemasQuery.eventSchemas);
	}, [isPersonSchema, eventSchemasQuery.isError, eventSchemasQuery.eventSchemas]);

	const getActionState = useCallback(
		(externalId: string) => actionStateById[externalId] ?? defaultSearchResultRowActionState,
		[actionStateById],
	);

	const patchActionState = useCallback(
		(externalId: string, patch: Partial<SearchResultRowActionState>) => {
			setActionStateById((prev) => ({
				...prev,
				[externalId]: {
					...(prev[externalId] ?? defaultSearchResultRowActionState),
					...patch,
				},
			}));
		},
		[],
	);

	const markDone = useCallback(
		(externalId: string, actions: SearchResultRowActionState["doneActions"]) => {
			const current = getActionState(externalId);
			patchActionState(externalId, {
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
			patchActionState(item.externalId, {
				actionError: null,
				pendingAction: "add",
			});

			try {
				await addItem(item);

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

				patchActionState(item.externalId, {
					actionError: getErrorMessage(error),
				});
			} finally {
				patchActionState(item.externalId, { pendingAction: null });
			}
		},
		[addItem, markDone, patchActionState],
	);

	const runLifecycleAction = useCallback(
		async (input: {
			externalId: string;
			item: SearchResultItem;
			pendingAction: "backlog" | "log" | "rate";
			buildPayload: (entityId: string) => ReturnType<typeof createBacklogEventPayload>;
			successMessage: string;
			partialFailureMessage: string;
			doneAction: "backlog" | "log" | "rate";
		}) => {
			patchActionState(input.externalId, {
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
				markDone(input.externalId, [input.doneAction]);
				props.onActionCompleted?.();
				patchActionState(input.externalId, {
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
				patchActionState(input.externalId, {
					actionError: message,
					openPanel: entityId ? getActionState(input.externalId).openPanel : null,
				});
			} finally {
				patchActionState(input.externalId, { pendingAction: null });
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
				externalId: item.externalId,
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

			const state = getActionState(item.externalId);
			try {
				createLogEventPayload({
					entityId: "",
					logDate: state.logDate,
					startedOn: state.logStartedOn,
					completedOn: state.logCompletedOn,
					entitySchemaSlug: props.entitySchema.slug,
					eventSchemas: eventSchemasQuery.eventSchemas,
					showSeason: state.showSeason === "" ? undefined : state.showSeason,
					showEpisode: state.showEpisode === "" ? undefined : state.showEpisode,
					mangaVolume: state.mangaVolume === "" ? undefined : state.mangaVolume,
					animeEpisode: state.animeEpisode === "" ? undefined : state.animeEpisode,
					mangaChapter: state.mangaChapter === "" ? undefined : state.mangaChapter,
					podcastEpisode: state.podcastEpisode === "" ? undefined : state.podcastEpisode,
				});
			} catch (error) {
				patchActionState(item.externalId, {
					actionError: getErrorMessage(error),
				});
				return;
			}

			void runLifecycleAction({
				item,
				doneAction: "log",
				pendingAction: "log",
				externalId: item.externalId,
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
						entitySchemaSlug: props.entitySchema.slug,
						eventSchemas: eventSchemasQuery.eventSchemas,
						showSeason: state.showSeason === "" ? undefined : state.showSeason,
						showEpisode: state.showEpisode === "" ? undefined : state.showEpisode,
						animeEpisode: state.animeEpisode === "" ? undefined : state.animeEpisode,
						mangaChapter: state.mangaChapter === "" ? undefined : state.mangaChapter,
						mangaVolume: state.mangaVolume === "" ? undefined : state.mangaVolume,
						podcastEpisode: state.podcastEpisode === "" ? undefined : state.podcastEpisode,
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

			const state = getActionState(item.externalId);
			try {
				createReviewEventPayload({
					entityId: "",
					rating: state.rateStars,
					review: state.rateReview,
					eventSchemas: eventSchemasQuery.eventSchemas,
				});
			} catch (error) {
				patchActionState(item.externalId, {
					actionError: getErrorMessage(error),
				});
				return;
			}

			void runLifecycleAction({
				item,
				doneAction: "rate",
				pendingAction: "rate",
				externalId: item.externalId,
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
		async (item: SearchResultItem, values: CollectionMembershipFormValues) => {
			const selectedCollection =
				collectionState.type === "collections"
					? collectionState.collections.find((collection) => collection.id === values.collectionId)
					: undefined;
			const validationResult = buildMembershipFormSchema(
				collectionState.type === "collections" ? collectionState.collections : [],
			).safeParse(values);
			if (!validationResult.success) {
				patchActionState(item.externalId, {
					actionError:
						validationResult.error.issues[0]?.message ?? "Collection details are invalid.",
				});
				return;
			}

			patchActionState(item.externalId, {
				actionError: null,
				pendingAction: "collection",
			});

			let entityId: string | null = null;
			try {
				const entity = await ensureItemEntity(item);
				entityId = entity.id;
				await addToCollection.mutateAsync({
					body: toMembershipPayload(validationResult.data, entity.id, selectedCollection),
				});
				markDone(item.externalId, ["collection"]);
				props.onActionCompleted?.();
				patchActionState(item.externalId, {
					actionError: null,
					openPanel: null,
				});
				const collectionName =
					collectionState.type === "collections"
						? (collectionState.collections.find((c) => c.id === validationResult.data.collectionId)
								?.name ?? "collection")
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

				const isPartialFailure = entityId !== null;
				const message = isPartialFailure
					? `${item.titleProperty.value} is in your library, but could not be added to the collection: ${getErrorMessage(error)}`
					: getErrorMessage(error);
				patchActionState(item.externalId, {
					actionError: message,
					openPanel: getActionState(item.externalId).openPanel,
				});
			} finally {
				patchActionState(item.externalId, { pendingAction: null });
			}
		},
		[
			markDone,
			getActionState,
			addToCollection,
			collectionState,
			ensureItemEntity,
			patchActionState,
		],
	);

	const canUseCollectionAction = true;

	const handleOpenPanel = useCallback(
		(item: SearchResultItem, panel: "log" | "rate" | "collection") => {
			setSelectedResultId(item.externalId);
			const state = getActionState(item.externalId);
			patchActionState(item.externalId, {
				actionError: null,
				openPanel: state.openPanel === panel ? null : panel,
			});

			if (
				panel === "log" &&
				state.openPanel !== panel &&
				isEpisodicEntity &&
				!ensuredEntityByExternalId[item.externalId]
			) {
				void ensureItemEntity(item).catch((error) => {
					if (isCancelledEntitySearchError(error)) {
						return;
					}
					patchActionState(item.externalId, {
						actionError: getErrorMessage(error),
					});
				});
			}
		},
		[
			getActionState,
			patchActionState,
			isEpisodicEntity,
			ensureItemEntity,
			ensuredEntityByExternalId,
		],
	);

	const providerCount = props.entitySchema.providers.length;
	const providerData = props.entitySchema.providers.map((provider, index) => ({
		label: provider.name,
		value: String(index),
	}));

	function renderProviderPicker() {
		if (providerCount <= 1) {
			return null;
		}
		if (providerCount <= 3) {
			return (
				<SegmentedControl
					fullWidth
					data={providerData}
					onChange={handleProviderChange}
					value={String(selectedProviderIndex)}
				/>
			);
		}
		return (
			<Select
				data={providerData}
				allowDeselect={false}
				value={String(selectedProviderIndex)}
				onChange={(value) => {
					if (value !== null) {
						handleProviderChange(value);
					}
				}}
			/>
		);
	}

	return (
		<Stack gap="md">
			{renderProviderPicker()}
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
											key={item.externalId}
											accentColor={accentColor}
											isPersonSchema={isPersonSchema}
											collectionState={collectionState}
											onAdd={() => void handleAdd(item)}
											addError={addError[item.externalId]}
											entityName={props.entitySchema.name}
											onSaveLog={() => handleSaveLog(item)}
											providerName={activeProvider?.name ?? ""}
											entitySchemaSlug={props.entitySchema.slug}
											onBacklog={() => void handleBacklog(item)}
											onSaveReview={() => handleSaveReview(item)}
											actionState={getActionState(item.externalId)}
											lifecycleErrorMessage={lifecycleErrorMessage}
											canUseCollectionAction={canUseCollectionAction}
											addStatus={addStatus[item.externalId] ?? "idle"}
											isLifecycleLoading={eventSchemasQuery.isLoading}
											isExpanded={selectedResultId === item.externalId}
											onTogglePanel={(panel) => handleOpenPanel(item, panel)}
											onRetryCollectionDiscovery={() => refetchCollections()}
											isTracked={trackedExternalIds.has(item.externalId)}
											collectionsDestination={collectionsDestination.destination}
											entityProperties={
												ensuredEntityByExternalId[item.externalId]?.properties as
													| Record<string, unknown>
													| undefined
											}
											onPatchActionState={(patch) => patchActionState(item.externalId, patch)}
											onSaveCollection={(values) => handleSaveCollection(item, values)}
											isLoadingEntityProperties={
												isEpisodicEntity && addStatus[item.externalId] === "loading"
											}
											propertyLoadError={
												isEpisodicEntity && addStatus[item.externalId] === "error"
													? (addError[item.externalId] ?? "Could not load episode details.")
													: null
											}
											onToggleActions={() => {
												const isCurrentlyExpanded = selectedResultId === item.externalId;
												setSelectedResultId((current) =>
													current === item.externalId ? null : item.externalId,
												);
												if (!isCurrentlyExpanded && props.initialAction === "log") {
													patchActionState(item.externalId, {
														openPanel: "log",
														actionError: null,
													});
												} else {
													patchActionState(item.externalId, {
														openPanel: null,
													});
												}
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
