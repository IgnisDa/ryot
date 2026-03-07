import { useDisclosure } from "@mantine/hooks";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import type { CreateFacetPayload, UpdateFacetPayload } from "./form";
import { useFacetMutations, useFacetsQuery } from "./hooks";
import type { AppFacet } from "./model";
import { toTrackingNavItems } from "./nav";
import { moveFacet } from "./reorder";

interface FacetSidebarState {
	isError: boolean;
	isLoading: boolean;
	isCustomizeMode: boolean;
	modalOpened: boolean;
	isReordering: boolean;
	isMutationBusy: boolean;
	isDisablePending: boolean;
	isModalSubmitting: boolean;
	activeFacet: AppFacet | undefined;
	navItems: ReturnType<typeof toTrackingNavItems>;
}

interface FacetSidebarActions {
	retry: () => void;
	closeModal: () => void;
	openCreateModal: () => void;
	toggleCustomizeMode: () => void;
	toggleActiveFacet: () => Promise<void>;
	toggleFacetById: (facetId: string) => Promise<void>;
	openEditModal: (facetId: string) => void;
	moveFacetById: (facetId: string, direction: "up" | "down") => Promise<void>;
	submitModal: (
		payload: CreateFacetPayload | UpdateFacetPayload,
	) => Promise<void>;
}

const FacetSidebarStateContext = createContext<FacetSidebarState | undefined>(
	undefined,
);

const FacetSidebarActionsContext = createContext<
	FacetSidebarActions | undefined
>(undefined);

export function useFacetSidebarState() {
	const context = useContext(FacetSidebarStateContext);

	if (!context)
		throw new Error(
			"useFacetSidebarState must be used within FacetSidebarProvider",
		);

	return context;
}

export function useFacetSidebarActions() {
	const context = useContext(FacetSidebarActionsContext);

	if (!context)
		throw new Error(
			"useFacetSidebarActions must be used within FacetSidebarProvider",
		);

	return context;
}

export default function FacetSidebarProvider(props: { children: ReactNode }) {
	const facetsQuery = useFacetsQuery();
	const mutations = useFacetMutations();
	const [modalOpened, { close: closeDisclosure, open: openDisclosure }] =
		useDisclosure(false);
	const [isCustomizeMode, setIsCustomizeMode] = useState(false);
	const [activeFacetId, setActiveFacetId] = useState<string | null>(null);
	const navItems = useMemo(
		() => toTrackingNavItems(facetsQuery.facets),
		[facetsQuery.facets],
	);
	const activeFacet = useMemo(
		() => facetsQuery.facets.find((facet) => facet.id === activeFacetId),
		[activeFacetId, facetsQuery.facets],
	);

	const closeModal = useCallback(() => {
		closeDisclosure();
		setActiveFacetId(null);
	}, [closeDisclosure]);

	const openCreateModal = useCallback(() => {
		setActiveFacetId(null);
		openDisclosure();
	}, [openDisclosure]);

	const openEditModal = useCallback(
		(facetId: string) => {
			setActiveFacetId(facetId);
			openDisclosure();
		},
		[openDisclosure],
	);

	const toggleFacet = useCallback(
		async (facet: AppFacet) => {
			if (facet.enabled) {
				await mutations.disable.mutateAsync({
					params: { path: { facetId: facet.id } },
				});
				return;
			}

			await mutations.enable.mutateAsync({
				params: { path: { facetId: facet.id } },
			});
		},
		[mutations.disable, mutations.enable],
	);

	const moveFacetById = useCallback(
		async (facetId: string, direction: "up" | "down") => {
			const facetIds = facetsQuery.facets.map((facet) => facet.id);
			const reorderedFacetIds = moveFacet(facetIds, facetId, direction);

			await mutations.reorder.mutateAsync({
				body: { facetIds: reorderedFacetIds },
			});
		},
		[facetsQuery.facets, mutations.reorder],
	);

	const toggleFacetById = useCallback(
		async (facetId: string) => {
			const targetFacet = facetsQuery.facets.find(
				(facet) => facet.id === facetId,
			);

			if (!targetFacet) return;

			await toggleFacet(targetFacet);
		},
		[facetsQuery.facets, toggleFacet],
	);

	const submitModal = useCallback(
		async (payload: CreateFacetPayload | UpdateFacetPayload) => {
			if (activeFacet !== undefined) {
				await mutations.update.mutateAsync({
					body: payload,
					params: { path: { facetId: activeFacet.id } },
				});

				closeModal();
				return;
			}

			await mutations.create.mutateAsync({
				body: payload as CreateFacetPayload,
			});
			closeModal();
		},
		[activeFacet, closeModal, mutations.create, mutations.update],
	);

	const toggleActiveFacet = useCallback(async () => {
		if (!activeFacet) {
			return;
		}

		await toggleFacet(activeFacet);
		closeModal();
	}, [activeFacet, closeModal, toggleFacet]);

	const retry = useCallback(() => {
		void facetsQuery.refetch();
	}, [facetsQuery.refetch]);

	const toggleCustomizeMode = useCallback(() => {
		setIsCustomizeMode((current) => !current);
	}, []);

	const isMutationBusy =
		mutations.create.isPending ||
		mutations.update.isPending ||
		mutations.enable.isPending ||
		mutations.disable.isPending;

	const isModalSubmitting =
		mutations.create.isPending || mutations.update.isPending;

	const isDisablePending =
		mutations.enable.isPending || mutations.disable.isPending;

	const stateValue = useMemo(
		() => ({
			navItems,
			activeFacet,
			modalOpened,
			isMutationBusy,
			isCustomizeMode,
			isDisablePending,
			isModalSubmitting,
			isError: facetsQuery.isError,
			isLoading: facetsQuery.isLoading,
			isReordering: mutations.reorder.isPending,
		}),
		[
			navItems,
			activeFacet,
			modalOpened,
			isMutationBusy,
			isCustomizeMode,
			isDisablePending,
			isModalSubmitting,
			facetsQuery.isError,
			facetsQuery.isLoading,
			mutations.reorder.isPending,
		],
	);

	const actionsValue = useMemo(
		() => ({
			retry,
			closeModal,
			submitModal,
			openEditModal,
			moveFacetById,
			openCreateModal,
			toggleFacetById,
			toggleActiveFacet,
			toggleCustomizeMode,
		}),
		[
			retry,
			closeModal,
			submitModal,
			openEditModal,
			moveFacetById,
			openCreateModal,
			toggleFacetById,
			toggleActiveFacet,
			toggleCustomizeMode,
		],
	);

	return (
		<FacetSidebarStateContext.Provider value={stateValue}>
			<FacetSidebarActionsContext.Provider value={actionsValue}>
				{props.children}
			</FacetSidebarActionsContext.Provider>
		</FacetSidebarStateContext.Provider>
	);
}
