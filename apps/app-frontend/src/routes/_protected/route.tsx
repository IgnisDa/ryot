import { Box, Flex } from "@mantine/core";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Sidebar } from "#/components/Sidebar";
import { toSidebarData } from "#/components/sidebar-data";
import { useFacetsQuery } from "#/features/facets/hooks";
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
	const facetsQuery = useFacetsQuery();
	const savedViewsQuery = useSavedViewsQuery();
	const sidebarData = toSidebarData({
		views: savedViewsQuery.savedViews,
		facets: facetsQuery.enabledFacets,
	});

	return (
		<Flex gap={0} h="100vh">
			<Sidebar
				isCustomizeMode={false}
				views={sidebarData.views}
				facets={sidebarData.facets}
				onReorderFacets={() => undefined}
				onToggleCustomizeMode={() => undefined}
			/>

			<Box flex={1} p={16} style={{ overflowY: "auto" }}>
				<Outlet />
			</Box>
		</Flex>
	);
}
