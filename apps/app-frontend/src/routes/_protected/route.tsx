import { Box, Flex } from "@mantine/core";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Sidebar } from "#/components/Sidebar";
import { toSidebarData } from "#/components/sidebar-data";
import { FacetModal } from "#/features/facets/components/facet-modal";
import FacetSidebarProvider, {
	useFacetSidebarActions,
	useFacetSidebarState,
} from "#/features/facets/sidebar-context";
import { useSavedViewsQuery } from "#/features/saved-views/hooks";

export const Route = createFileRoute("/_protected")({
	component: RouteComponent,
	beforeLoad: async ({ context, location }) => {
		const session = await context.authClientInstance.getSession();
		if (!session.data)
			throw redirect({
				to: "/start",
				search: { redirect: location.href },
			});

		return { user: session.data.user };
	},
});

function RouteComponent() {
	return (
		<FacetSidebarProvider>
			<Flex gap={0} h="100vh">
				<ProtectedSidebar />

				<Box flex={1} p={16} style={{ overflowY: "auto" }}>
					<Outlet />
				</Box>
			</Flex>

			<FacetModal />
		</FacetSidebarProvider>
	);
}

function ProtectedSidebar() {
	const state = useFacetSidebarState();
	const actions = useFacetSidebarActions();
	const savedViewsQuery = useSavedViewsQuery();
	const sidebarData = toSidebarData({
		views: savedViewsQuery.savedViews,
		facets: state.facets,
		isCustomizeMode: state.isCustomizeMode,
	});

	return (
		<Sidebar
			views={sidebarData.views}
			facets={sidebarData.facets}
			onEditFacet={actions.openEditModal}
			isMutationBusy={state.isMutationBusy}
			isCustomizeMode={state.isCustomizeMode}
			onCreateFacet={actions.openCreateModal}
			onToggleCustomizeMode={actions.toggleCustomizeMode}
			onToggleFacetEnabled={(facetId) => void actions.toggleFacetById(facetId)}
			onReorderFacets={(facets) =>
				void actions.reorderFacetIds(facets.map((facet) => facet.id))
			}
		/>
	);
}
