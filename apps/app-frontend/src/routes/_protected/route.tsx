import { Box, Flex } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { MobileSidebarBurger, Sidebar } from "#/components/sidebar/Sidebar";
import { TrackerModal } from "#/features/trackers/components/tracker-modal";
import TrackerSidebarProvider from "#/features/trackers/sidebar-context";
import { useIsMobileScreen } from "#/hooks/screen";
import { useColorScheme } from "#/hooks/theme";
import { authClient } from "#/lib/auth";

export const Route = createFileRoute("/_protected")({
	component: RouteComponent,
	beforeLoad: async ({ location }) => {
		const session = await authClient.getSession();
		if (!session.data) {
			throw redirect({
				to: "/start",
				search: { redirect: location.href },
			});
		}

		return { user: session.data };
	},
});

function RouteComponent() {
	const isMobile = useIsMobileScreen();
	const colorScheme = useColorScheme();
	const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
		useDisclosure(false);
	const isDark = colorScheme === "dark";

	return (
		<TrackerSidebarProvider>
			<Flex gap={0} h="100vh" direction="column">
				{isMobile && (
					<Box
						p="md"
						style={{
							backgroundColor: isDark ? "var(--mantine-color-dark-8)" : "white",
							borderBottom: isDark
								? "1px solid var(--mantine-color-dark-6)"
								: "1px solid var(--mantine-color-stone-3)",
						}}
					>
						<MobileSidebarBurger opened={drawerOpened} onClick={openDrawer} />
					</Box>
				)}

				<Flex gap={0} style={{ flex: 1, overflow: "hidden" }}>
					<Sidebar
						onOpenDrawer={openDrawer}
						onCloseDrawer={closeDrawer}
						drawerOpened={drawerOpened}
					/>

					<Box flex={1} p={16} style={{ overflowY: "auto" }}>
						<Outlet />
					</Box>
				</Flex>
			</Flex>

			<TrackerModal />
		</TrackerSidebarProvider>
	);
}
