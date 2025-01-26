import { Box, Button, Flex, Group, Stack, Text } from "@mantine/core";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { FacetModal } from "#/features/facets/components/facet-modal";
import { FacetTrackingSection } from "#/features/facets/components/facet-tracking-section";
import FacetSidebarProvider, {
	useFacetSidebarActions,
	useFacetSidebarState,
} from "#/features/facets/sidebar-context";

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
		<Flex gap={0} h="100vh">
			<Box w="25%" p={16} style={{ overflowY: "auto" }}>
				<FacetSidebarProvider>
					<FacetSidebarContent />
					<FacetModal />
				</FacetSidebarProvider>
			</Box>

			<Box flex={1} p={16} style={{ overflowY: "auto" }}>
				<Outlet />
			</Box>
		</Flex>
	);
}

function FacetSidebarContent() {
	const state = useFacetSidebarState();
	const actions = useFacetSidebarActions();

	return (
		<Stack gap="lg">
			<Group justify="space-between" align="center">
				<Text fw={700} size="lg">
					Ryot
				</Text>
				<Button
					size="xs"
					onClick={actions.toggleCustomizeMode}
					variant={state.isCustomizeMode ? "filled" : "light"}
				>
					{state.isCustomizeMode ? "Save" : "Customize"}
				</Button>
			</Group>
			<FacetTrackingSection />
		</Stack>
	);
}
