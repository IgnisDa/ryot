import { useDisclosure } from "@mantine/hooks";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import type { CreateTrackerPayload, UpdateTrackerPayload } from "./form";
import { useTrackerMutations, useTrackersQuery } from "./hooks";
import type { AppTracker } from "./model";

interface TrackerSidebarState {
	isError: boolean;
	trackers: AppTracker[];
	isLoading: boolean;
	modalOpened: boolean;
	isReordering: boolean;
	isMutationBusy: boolean;
	isCustomizeMode: boolean;
	isModalSubmitting: boolean;
	activeTracker: AppTracker | undefined;
}

interface TrackerSidebarActions {
	retry: () => void;
	closeModal: () => void;
	openCreateModal: () => void;
	toggleCustomizeMode: () => void;
	openEditModal: (trackerId: string) => void;
	toggleTrackerById: (trackerId: string) => Promise<void>;
	reorderTrackerIds: (trackerIds: string[]) => Promise<void>;
	submitModal: (
		payload: CreateTrackerPayload | UpdateTrackerPayload,
	) => Promise<void>;
}

const TrackerSidebarStateContext = createContext<
	TrackerSidebarState | undefined
>(undefined);

const TrackerSidebarActionsContext = createContext<
	TrackerSidebarActions | undefined
>(undefined);

export function useTrackerSidebarState() {
	const context = useContext(TrackerSidebarStateContext);

	if (!context) {
		throw new Error(
			"useTrackerSidebarState must be used within TrackerSidebarProvider",
		);
	}

	return context;
}

export function useTrackerSidebarActions() {
	const context = useContext(TrackerSidebarActionsContext);

	if (!context) {
		throw new Error(
			"useTrackerSidebarActions must be used within TrackerSidebarProvider",
		);
	}

	return context;
}

export default function TrackerSidebarProvider(props: { children: ReactNode }) {
	const trackersQuery = useTrackersQuery();
	const mutations = useTrackerMutations();
	const [isCustomizeMode, setIsCustomizeMode] = useState(false);
	const [activeTrackerId, setActiveTrackerId] = useState<string | null>(null);
	const [modalOpened, { close: closeDisclosure, open: openDisclosure }] =
		useDisclosure(false);
	const activeTracker = useMemo(
		() =>
			trackersQuery.trackers.find((tracker) => tracker.id === activeTrackerId),
		[activeTrackerId, trackersQuery.trackers],
	);

	const closeModal = useCallback(() => {
		closeDisclosure();
		setActiveTrackerId(null);
	}, [closeDisclosure]);

	const openCreateModal = useCallback(() => {
		setActiveTrackerId(null);
		openDisclosure();
	}, [openDisclosure]);

	const openEditModal = useCallback(
		(trackerId: string) => {
			setActiveTrackerId(trackerId);
			openDisclosure();
		},
		[openDisclosure],
	);

	const toggleTracker = useCallback(
		async (tracker: AppTracker) => {
			await mutations.toggle.mutateAsync({
				body: { isDisabled: !tracker.isDisabled },
				params: { path: { trackerId: tracker.id } },
			});
		},
		[mutations.toggle],
	);

	const reorderTrackerIds = useCallback(
		async (trackerIds: string[]) => {
			await mutations.reorder.mutateAsync({ body: { trackerIds } });
		},
		[mutations.reorder],
	);

	const toggleTrackerById = useCallback(
		async (trackerId: string) => {
			const targetTracker = trackersQuery.trackers.find(
				(tracker) => tracker.id === trackerId,
			);

			if (!targetTracker) {
				return;
			}

			await toggleTracker(targetTracker);
		},
		[trackersQuery.trackers, toggleTracker],
	);

	const submitModal = useCallback(
		async (payload: CreateTrackerPayload | UpdateTrackerPayload) => {
			if (activeTracker !== undefined) {
				await mutations.update.mutateAsync({
					body: payload,
					params: { path: { trackerId: activeTracker.id } },
				});

				closeModal();
				return;
			}

			await mutations.create.mutateAsync({
				body: payload as CreateTrackerPayload,
			});
			closeModal();
		},
		[activeTracker, closeModal, mutations.create, mutations.update],
	);

	const retry = useCallback(() => {
		void trackersQuery.refetch();
	}, [trackersQuery.refetch]);

	const toggleCustomizeMode = useCallback(() => {
		setIsCustomizeMode((current) => !current);
	}, []);

	const isMutationBusy =
		mutations.create.isPending ||
		mutations.update.isPending ||
		mutations.toggle.isPending;

	const isModalSubmitting =
		mutations.create.isPending || mutations.update.isPending;

	const stateValue = useMemo(
		() => ({
			activeTracker,
			modalOpened,
			isMutationBusy,
			isCustomizeMode,
			isModalSubmitting,
			trackers: trackersQuery.trackers,
			isError: trackersQuery.isError,
			isLoading: trackersQuery.isLoading,
			isReordering: mutations.reorder.isPending,
		}),
		[
			activeTracker,
			modalOpened,
			isMutationBusy,
			isCustomizeMode,
			isModalSubmitting,
			trackersQuery.trackers,
			trackersQuery.isError,
			trackersQuery.isLoading,
			mutations.reorder.isPending,
		],
	);

	const actionsValue = useMemo(
		() => ({
			retry,
			closeModal,
			submitModal,
			openEditModal,
			reorderTrackerIds,
			openCreateModal,
			toggleTrackerById,
			toggleCustomizeMode,
		}),
		[
			retry,
			closeModal,
			submitModal,
			openEditModal,
			reorderTrackerIds,
			openCreateModal,
			toggleTrackerById,
			toggleCustomizeMode,
		],
	);

	return (
		<TrackerSidebarStateContext.Provider value={stateValue}>
			<TrackerSidebarActionsContext.Provider value={actionsValue}>
				{props.children}
			</TrackerSidebarActionsContext.Provider>
		</TrackerSidebarStateContext.Provider>
	);
}
