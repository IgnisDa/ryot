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

interface FacetSidebarState {
	isError: boolean;
	facets: AppFacet[];
	isLoading: boolean;
	modalOpened: boolean;
	isReordering: boolean;
	isMutationBusy: boolean;
	isCustomizeMode: boolean;
	isModalSubmitting: boolean;
	activeFacet: AppFacet | undefined;
}

interface FacetSidebarActions {
	retry: () => void;
	closeModal: () => void;
	openCreateModal: () => void;
	toggleCustomizeMode: () => void;
	openEditModal: (facetId: string) => void;
	toggleFacetById: (facetId: string) => Promise<void>;
	reorderFacetIds: (facetIds: string[]) => Promise<void>;
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
	const [isCustomizeMode, setIsCustomizeMode] = useState(false);
	const [activeFacetId, setActiveFacetId] = useState<string | null>(null);
	const [modalOpened, { close: closeDisclosure, open: openDisclosure }] =
		useDisclosure(false);
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
			await mutations.toggle.mutateAsync({
				body: { enabled: !facet.enabled },
				params: { path: { facetId: facet.id } },
			});
		},
		[mutations.toggle],
	);

	const reorderFacetIds = useCallback(
		async (facetIds: string[]) => {
			await mutations.reorder.mutateAsync({ body: { facetIds } });
		},
		[mutations.reorder],
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

	const retry = useCallback(() => {
		void facetsQuery.refetch();
	}, [facetsQuery.refetch]);

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
			activeFacet,
			modalOpened,
			isMutationBusy,
			isCustomizeMode,
			isModalSubmitting,
			facets: facetsQuery.facets,
			isError: facetsQuery.isError,
			isLoading: facetsQuery.isLoading,
			isReordering: mutations.reorder.isPending,
		}),
		[
			activeFacet,
			modalOpened,
			isMutationBusy,
			isCustomizeMode,
			isModalSubmitting,
			facetsQuery.facets,
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
			reorderFacetIds,
			openCreateModal,
			toggleFacetById,
			toggleCustomizeMode,
		}),
		[
			retry,
			closeModal,
			submitModal,
			openEditModal,
			reorderFacetIds,
			openCreateModal,
			toggleFacetById,
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
