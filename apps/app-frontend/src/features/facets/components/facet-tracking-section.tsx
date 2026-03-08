import {
	ActionIcon,
	Box,
	Button,
	Flex,
	Group,
	Loader,
	Text,
	Tooltip,
} from "@mantine/core";
import { Plus } from "lucide-react";
import type { RefCallback } from "react";
import { useSavedViewsQuery } from "#/features/saved-views/hooks";
import {
	useFacetSidebarActions,
	useFacetSidebarState,
} from "../sidebar-context";
import { FacetNavItem } from "./facet-nav-item";

interface FacetTrackingSectionProps {
	autoAnimateRef: RefCallback<HTMLDivElement>;
}

export function FacetTrackingSection(props: FacetTrackingSectionProps) {
	const state = useFacetSidebarState();
	const actions = useFacetSidebarActions();
	const savedViewsQuery = useSavedViewsQuery();
	const isCreateVisible = state.isCustomizeMode;
	const visibleItems = state.isCustomizeMode
		? state.navItems
		: state.navItems.filter((item) => item.enabled);

	return (
		<Box ref={props.autoAnimateRef}>
			<Group justify="space-between" mb={12} gap="xs" wrap="nowrap">
				<Text fw={600} size="sm" c="dimmed">
					TRACKING
				</Text>
				<Tooltip label="Create facet" openDelay={200}>
					<ActionIcon
						size="sm"
						radius="xl"
						variant="light"
						aria-label="Create facet"
						onClick={actions.openCreateModal}
						tabIndex={isCreateVisible ? 0 : -1}
						style={{
							opacity: isCreateVisible ? 1 : 0,
							transition: "opacity 120ms ease",
							pointerEvents: isCreateVisible ? "auto" : "none",
						}}
					>
						<Plus size={14} strokeWidth={2.2} />
					</ActionIcon>
				</Tooltip>
			</Group>

			{state.isLoading && (
				<Flex justify="center" p={16}>
					<Loader size="sm" />
				</Flex>
			)}

			{state.isError && (
				<Flex direction="column" gap="xs">
					<Text size="sm" c="red">
						Failed to load facets
					</Text>
					<Button size="xs" variant="light" onClick={actions.retry}>
						Retry
					</Button>
				</Flex>
			)}

			{!state.isLoading && !state.isError && visibleItems.length === 0 && (
				<Text size="sm" c="dimmed">
					{state.navItems.length === 0
						? "Use Customize to create your first facet."
						: "No visible facets. Use Customize to manage hidden facets."}
				</Text>
			)}

			{visibleItems.map((item, index) => (
				<FacetNavItem
					facet={item}
					key={item.facetId}
					isFirst={index === 0}
					savedViews={savedViewsQuery.savedViews}
					isLast={index === visibleItems.length - 1}
				/>
			))}
		</Box>
	);
}
