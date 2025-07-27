import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import {
	SortableContext,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	ActionIcon,
	Box,
	Burger,
	Drawer,
	Group,
	Image,
	NavLink,
	rgba,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import { useHover, useLocalStorage } from "@mantine/hooks";
import { Link } from "@tanstack/react-router";
import {
	ChevronDown,
	ChevronRight,
	GripVertical,
	Home,
	Pencil,
	Plus,
	Search,
	Settings,
	ToggleLeft,
	ToggleRight,
} from "lucide-react";
import { useState } from "react";
import { toSidebarAccount } from "~/components/sidebar/sidebar-account";
import { toSidebarData } from "~/components/sidebar/sidebar-data";
import {
	useSavedViewMutations,
	useSavedViewsQuery,
} from "~/features/saved-views/hooks";
import { TrackerIcon } from "~/features/trackers/icons";
import {
	useTrackerSidebarActions,
	useTrackerSidebarState,
} from "~/features/trackers/sidebar-context";
import { useProtectedUser } from "~/hooks/protected-user";
import { useIsMobileScreen } from "~/hooks/screen";
import { useThemeTokens } from "~/hooks/theme";
import { STORAGE_KEYS } from "~/lib/storage-keys";
import type {
	SidebarProps,
	SidebarTracker,
	SidebarView,
} from "./Sidebar.types";
import { SidebarAccountSection } from "./SidebarAccountSection";

function getTrackerColor(tracker: SidebarTracker) {
	return { base: tracker.accentColor, muted: rgba(tracker.accentColor, 0) };
}

function ViewIcon(props: { view: SidebarView }) {
	return (
		<Box
			c={props.view.accentColor}
			style={{ display: "flex", alignItems: "center" }}
		>
			<TrackerIcon icon={props.view.icon} size={16} />
		</Box>
	);
}

function SortableView(props: {
	view: SidebarView;
	textColor: string;
	hoverColor: string;
	leftPadding: string;
	onClick: () => void;
	isMutationBusy: boolean;
	isCustomizeMode: boolean;
	onToggleViewEnabled: (viewId: string) => void;
}) {
	const { isDark } = useThemeTokens();
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: props.view.id });

	const style = {
		transition,
		opacity: isDragging ? 0.5 : 1,
		transform: CSS.Transform.toString(transform),
	};

	return (
		<Box ref={setNodeRef} style={style}>
			<NavLink
				label={props.view.name}
				leftSection={
					<Group gap={props.isCustomizeMode ? 8 : 0} wrap="nowrap">
						{props.isCustomizeMode ? (
							<Box
								component="button"
								c={isDark ? "dark.4" : "stone.5"}
								onClick={(event) => {
									event.preventDefault();
									event.stopPropagation();
								}}
								style={{
									padding: 0,
									cursor: "grab",
									border: "none",
									display: "flex",
									alignItems: "center",
									background: "transparent",
								}}
								{...attributes}
								{...listeners}
							>
								<GripVertical size={16} />
							</Box>
						) : undefined}
						<ViewIcon view={props.view} />
					</Group>
				}
				onClick={props.isCustomizeMode ? undefined : props.onClick}
				renderRoot={
					props.isCustomizeMode
						? undefined
						: (rootProps) => (
								<Link
									{...rootProps}
									to="/views/$viewId"
									params={{ viewId: props.view.id }}
								/>
							)
				}
				rightSection={
					props.isCustomizeMode ? (
						<Group gap={4} wrap="nowrap">
							<ActionIcon
								size="sm"
								variant="subtle"
								disabled={props.isMutationBusy}
								aria-label={
									props.view.isDisabled ? "Enable view" : "Disable view"
								}
								onClick={(event) => {
									event.preventDefault();
									event.stopPropagation();
									props.onToggleViewEnabled(props.view.id);
								}}
							>
								{props.view.isDisabled ? (
									<ToggleLeft size={14} strokeWidth={1.8} />
								) : (
									<ToggleRight size={14} strokeWidth={1.8} />
								)}
							</ActionIcon>
						</Group>
					) : undefined
				}
				styles={{
					label: { fontSize: "13px", fontWeight: 400, color: props.textColor },
					root: {
						paddingLeft: props.leftPadding,
						"&:hover": { backgroundColor: props.hoverColor },
					},
				}}
			/>
		</Box>
	);
}

function SortableTracker(props: {
	isExpanded: boolean;
	textPrimary: string;
	textSecondary: string;
	isMutationBusy: boolean;
	tracker: SidebarTracker;
	isCustomizeMode: boolean;
	onNavLinkClick: () => void;
	isViewMutationBusy: boolean;
	onEditTracker?: (trackerId: string) => void;
	onExpandTracker: (trackerId: string) => void;
	onToggleTracker: (trackerId: string) => void;
	onToggleViewEnabled: (viewId: string) => void;
	onToggleTrackerEnabled?: (trackerId: string) => void;
}) {
	const { isDark } = useThemeTokens();
	const color = getTrackerColor(props.tracker);
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: props.tracker.id });

	const style = {
		transition,
		opacity: isDragging ? 0.5 : 1,
		transform: CSS.Transform.toString(transform),
	};

	return (
		<Box ref={setNodeRef} style={style}>
			<NavLink
				label={props.tracker.name}
				onClick={() => {
					if (props.isCustomizeMode) {
						return;
					}
					if (props.tracker.views?.length) {
						props.onExpandTracker(props.tracker.id);
					}
					props.onNavLinkClick();
				}}
				renderRoot={
					props.isCustomizeMode
						? undefined
						: (rootProps) => (
								<Link
									{...rootProps}
									to="/$trackerSlug"
									params={{ trackerSlug: props.tracker.slug }}
								/>
							)
				}
				styles={{
					label: {
						fontSize: "14px",
						fontWeight: 500,
						color: props.textPrimary,
					},
					root: {
						padding: "10px 14px",
						borderLeft: "2px solid transparent",
						"&:hover": {
							borderLeftColor: color.base,
							backgroundColor: color.muted,
						},
					},
				}}
				leftSection={
					<Group gap={props.isCustomizeMode ? 8 : 0} wrap="nowrap">
						{props.isCustomizeMode && (
							<Box
								component="button"
								c={isDark ? "dark.4" : "stone.5"}
								onClick={(event) => {
									event.preventDefault();
									event.stopPropagation();
								}}
								style={{
									padding: 0,
									cursor: "grab",
									border: "none",
									display: "flex",
									alignItems: "center",
									background: "transparent",
								}}
								{...attributes}
								{...listeners}
							>
								<GripVertical size={16} />
							</Box>
						)}
						<Box
							c={color.base}
							style={{ display: "flex", alignItems: "center" }}
						>
							<TrackerIcon icon={props.tracker.icon} size={18} />
						</Box>
					</Group>
				}
				rightSection={
					<Group gap={4} wrap="nowrap">
						{props.isCustomizeMode ? (
							<Group gap={4} wrap="nowrap">
								{props.tracker.isBuiltin ? undefined : (
									<ActionIcon
										size="sm"
										variant="subtle"
										aria-label="Edit tracker"
										disabled={props.isMutationBusy}
										onClick={(event) => {
											event.preventDefault();
											event.stopPropagation();
											props.onEditTracker?.(props.tracker.id);
										}}
									>
										<Pencil size={14} strokeWidth={1.8} />
									</ActionIcon>
								)}
								<ActionIcon
									size="sm"
									variant="subtle"
									disabled={props.isMutationBusy}
									aria-label={
										props.tracker.isDisabled
											? "Enable tracker"
											: "Disable tracker"
									}
									onClick={(event) => {
										event.preventDefault();
										event.stopPropagation();
										props.onToggleTrackerEnabled?.(props.tracker.id);
									}}
								>
									{props.tracker.isDisabled ? (
										<ToggleLeft size={14} strokeWidth={1.8} />
									) : (
										<ToggleRight size={14} strokeWidth={1.8} />
									)}
								</ActionIcon>
							</Group>
						) : undefined}
						{props.tracker.views?.length ? (
							<ActionIcon
								size="xs"
								variant="subtle"
								aria-label={
									props.isExpanded ? "Collapse tracker" : "Expand tracker"
								}
								onClick={(event) => {
									event.preventDefault();
									event.stopPropagation();
									props.onToggleTracker(props.tracker.id);
								}}
							>
								{props.isExpanded ? (
									<ChevronDown size={16} strokeWidth={1.8} />
								) : (
									<ChevronRight size={16} strokeWidth={1.8} />
								)}
							</ActionIcon>
						) : undefined}
					</Group>
				}
			/>
			{props.isExpanded ? (
				<SortableTrackerViews
					tracker={props.tracker}
					hoverColor={color.muted}
					textSecondary={props.textSecondary}
					onNavLinkClick={props.onNavLinkClick}
					isCustomizeMode={props.isCustomizeMode}
					isMutationBusy={props.isViewMutationBusy}
					onToggleViewEnabled={props.onToggleViewEnabled}
				/>
			) : undefined}
		</Box>
	);
}

function SortableTrackerViews(props: {
	hoverColor: string;
	textSecondary: string;
	isMutationBusy: boolean;
	tracker: SidebarTracker;
	isCustomizeMode: boolean;
	onNavLinkClick: () => void;
	onToggleViewEnabled: (viewId: string) => void;
}) {
	if (!props.tracker.views?.length) {
		return null;
	}

	return (
		<SortableContext
			strategy={verticalListSortingStrategy}
			items={props.tracker.views.map((view) => view.id)}
		>
			{props.tracker.views.map((view) => (
				<SortableView
					view={view}
					key={view.id}
					leftPadding="40px"
					hoverColor={props.hoverColor}
					onClick={props.onNavLinkClick}
					textColor={props.textSecondary}
					isMutationBusy={props.isMutationBusy}
					isCustomizeMode={props.isCustomizeMode}
					onToggleViewEnabled={props.onToggleViewEnabled}
				/>
			))}
		</SortableContext>
	);
}

function SortableStandaloneViews(props: {
	views: SidebarView[];
	textSecondary: string;
	hoverColor: string;
	isCustomizeMode: boolean;
	isMutationBusy: boolean;
	onNavLinkClick: () => void;
	onToggleViewEnabled: (viewId: string) => void;
}) {
	return (
		<SortableContext
			strategy={verticalListSortingStrategy}
			items={props.views.map((view) => view.id)}
		>
			{props.views.map((view) => (
				<SortableView
					view={view}
					key={view.id}
					leftPadding="14px"
					hoverColor={props.hoverColor}
					onClick={props.onNavLinkClick}
					textColor={props.textSecondary}
					isMutationBusy={props.isMutationBusy}
					isCustomizeMode={props.isCustomizeMode}
					onToggleViewEnabled={props.onToggleViewEnabled}
				/>
			))}
		</SortableContext>
	);
}

export function Sidebar(props: SidebarProps) {
	const user = useProtectedUser();
	const isMobile = useIsMobileScreen();
	const state = useTrackerSidebarState();
	const actions = useTrackerSidebarActions();
	const savedViewsQuery = useSavedViewsQuery({
		includeDisabled: state.isCustomizeMode,
	});
	const savedViewMutations = useSavedViewMutations();
	const { hovered, ref } = useHover<HTMLDivElement>();
	const [searchQuery, setSearchQuery] = useState("");
	const [expandedTrackers, setExpandedTrackers] = useLocalStorage<
		Record<string, boolean>
	>({ key: STORAGE_KEYS.sidebarExpandedTrackers, defaultValue: {} });
	const sidebarData = toSidebarData({
		trackers: state.isCustomizeMode
			? state.trackers
			: state.trackers.filter((tracker) => !tracker.isDisabled),
		views: savedViewsQuery.savedViews,
	});

	const { isDark, surface, border, textPrimary, textMuted, textSecondary } =
		useThemeTokens();
	const borderAccent = "var(--mantine-color-accent-5)";

	const handleSearchChange = (value: string) => {
		setSearchQuery(value);
	};

	const handleToggleTracker = (trackerId: string) => {
		setExpandedTrackers((current) => ({
			...current,
			[trackerId]: !(current[trackerId] ?? false),
		}));
	};

	const handleExpandTracker = (trackerId: string) => {
		setExpandedTrackers((current) => ({ ...current, [trackerId]: true }));
	};

	const handleDragEnd = (event: DragEndEvent) => {
		if (!state.isCustomizeMode) {
			return;
		}

		const { active, over } = event;
		if (!over || active.id === over.id) {
			return;
		}
		const activeId = String(active.id);
		const overId = String(over.id);

		const activeIndex = sidebarData.trackers.findIndex(
			(tracker) => tracker.id === activeId,
		);
		const overIndex = sidebarData.trackers.findIndex(
			(tracker) => tracker.id === overId,
		);

		if (activeIndex !== -1 && overIndex !== -1) {
			const nextTrackers = Array.from(sidebarData.trackers);
			const movedTracker = nextTrackers[activeIndex];
			if (!movedTracker) {
				return;
			}

			nextTrackers.splice(activeIndex, 1);
			nextTrackers.splice(overIndex, 0, movedTracker);
			void actions.reorderTrackerIds(nextTrackers.map((tracker) => tracker.id));
			return;
		}

		const activeTracker = sidebarData.trackers.find((tracker) =>
			tracker.views?.some((view) => view.id === activeId),
		);
		const overTracker = sidebarData.trackers.find((tracker) =>
			tracker.views?.some((view) => view.id === overId),
		);

		if (
			activeTracker !== undefined &&
			overTracker !== undefined &&
			activeTracker.id === overTracker.id
		) {
			const currentViews = activeTracker.views ?? [];
			const activeViewIndex = currentViews.findIndex(
				(view) => view.id === activeId,
			);
			const overViewIndex = currentViews.findIndex(
				(view) => view.id === overId,
			);

			if (activeViewIndex === -1 || overViewIndex === -1) {
				return;
			}

			const nextViews = Array.from(currentViews);
			const movedView = nextViews[activeViewIndex];
			if (!movedView) {
				return;
			}

			nextViews.splice(activeViewIndex, 1);
			nextViews.splice(overViewIndex, 0, movedView);
			void savedViewMutations.reorderViewIds({
				viewIds: nextViews.map((view) => view.id),
				trackerId: activeTracker.id,
			});
			return;
		}

		const activeStandaloneIndex = sidebarData.views.findIndex(
			(view) => view.id === activeId,
		);
		const overStandaloneIndex = sidebarData.views.findIndex(
			(view) => view.id === overId,
		);

		if (activeStandaloneIndex === -1 || overStandaloneIndex === -1) {
			return;
		}

		const nextViews = Array.from(sidebarData.views);
		const movedView = nextViews[activeStandaloneIndex];
		if (!movedView) {
			return;
		}

		nextViews.splice(activeStandaloneIndex, 1);
		nextViews.splice(overStandaloneIndex, 0, movedView);
		void savedViewMutations.reorderViewIds({
			viewIds: nextViews.map((view) => view.id),
		});
	};

	const handleNavLinkClick = () => {
		if (isMobile) {
			props.onCloseDrawer?.();
		}
	};

	const sidebarContent = (
		<Stack gap={0} h="100%">
			<Box ref={ref} p="xl" pb="lg">
				<Group align="flex-start" justify="space-between" mb={4}>
					<Group gap="sm">
						<Box
							w={32}
							h={32}
							style={{
								display: "grid",
								borderRadius: 6,
								placeItems: "center",
								background: "#fd7e14",
							}}
						>
							<Image
								h={30}
								w={30}
								radius="md"
								src="https://raw.githubusercontent.com/IgnisDa/ryot/main/libs/assets/icon-512x512.png"
							/>
						</Box>
						<Text
							fw={600}
							size="xl"
							c={textPrimary}
							ff="var(--mantine-headings-font-family)"
						>
							Ryot
						</Text>
					</Group>

					<ActionIcon
						variant="subtle"
						onClick={actions.toggleCustomizeMode}
						opacity={hovered || state.isCustomizeMode ? 1 : 0}
						color={state.isCustomizeMode ? "accent.5" : undefined}
						styles={{
							root: {
								transition: "opacity 120ms ease",
								color: state.isCustomizeMode ? borderAccent : textMuted,
								pointerEvents:
									hovered || state.isCustomizeMode ? "auto" : "none",
							},
						}}
					>
						<Settings size={18} />
					</ActionIcon>
				</Group>

				<Text size="xs" c={textMuted} style={{ letterSpacing: "0.3px" }}>
					A journal of personal tracking
				</Text>
			</Box>

			<Box pb="md" px="lg">
				<TextInput
					size="sm"
					value={searchQuery}
					placeholder="Search..."
					leftSection={<Search color={borderAccent} size={16} />}
					onChange={(event) => handleSearchChange(event.currentTarget.value)}
					styles={{
						input: {
							fontWeight: 400,
							fontSize: "13px",
							border: `1px solid ${border}`,
							backgroundColor: isDark
								? "var(--mantine-color-dark-7)"
								: "var(--mantine-color-stone-1)",
							"&:focus": {
								borderColor: borderAccent,
								boxShadow: "0 0 0 2px rgba(212, 165, 116, 0.15)",
							},
							"&::placeholder": {
								color: isDark
									? "var(--mantine-color-dark-4)"
									: "var(--mantine-color-stone-4)",
							},
						},
					}}
				/>
			</Box>

			<Box h={1} mx="lg" bg={border} />

			<Stack gap={0} px="sm" py="md" style={{ flex: 1, overflowY: "auto" }}>
				<NavLink
					to="/"
					label="Home"
					color="accent.5"
					variant="subtle"
					component={Link}
					onClick={handleNavLinkClick}
					leftSection={<Home color={borderAccent} size={18} />}
					styles={{
						label: { fontWeight: 500, fontSize: "14px" },
						root: {
							padding: "10px 14px",
							borderLeft: "2px solid transparent",
							"&:hover": {
								borderLeftColor: borderAccent,
								backgroundColor: "rgba(212, 165, 116, 0.06)",
							},
						},
					}}
				/>

				<Box mb="sm" mt="xl">
					<Box
						px="md"
						py="xs"
						style={{ borderLeft: `2px solid ${borderAccent}` }}
					>
						<Text
							fw={600}
							size="xs"
							c={textMuted}
							tt="uppercase"
							style={{ letterSpacing: "1px" }}
							ff="var(--mantine-headings-font-family)"
						>
							Trackers
						</Text>
					</Box>
				</Box>

				<DndContext
					onDragEnd={handleDragEnd}
					collisionDetection={closestCenter}
				>
					<SortableContext
						strategy={verticalListSortingStrategy}
						items={sidebarData.trackers.map((tracker) => tracker.id)}
					>
						{sidebarData.trackers.map((tracker) => {
							const isExpanded =
								expandedTrackers[tracker.id] ?? tracker.isExpanded ?? false;

							return (
								<SortableTracker
									key={tracker.id}
									tracker={tracker}
									isExpanded={isExpanded}
									textPrimary={textPrimary}
									textSecondary={textSecondary}
									onNavLinkClick={handleNavLinkClick}
									onEditTracker={actions.openEditModal}
									onExpandTracker={handleExpandTracker}
									onToggleTracker={handleToggleTracker}
									isMutationBusy={state.isMutationBusy}
									isCustomizeMode={state.isCustomizeMode}
									isViewMutationBusy={savedViewMutations.isPending}
									onToggleTrackerEnabled={(trackerId) =>
										void actions.toggleTrackerById(trackerId)
									}
									onToggleViewEnabled={(viewId) =>
										void savedViewMutations.toggleViewById(
											viewId,
											savedViewsQuery.savedViews,
										)
									}
								/>
							);
						})}
					</SortableContext>
				</DndContext>

				{state.isCustomizeMode && (
					<NavLink
						label="Add tracker"
						onClick={actions.openCreateModal}
						leftSection={<Plus color={borderAccent} size={16} />}
						styles={{
							label: {
								fontSize: "13px",
								fontWeight: 500,
								color: textPrimary,
							},
							root: {
								padding: "8px 14px",
								borderLeft: "2px solid transparent",
								"&:hover": {
									borderLeftColor: borderAccent,
									backgroundColor: "rgba(212, 165, 116, 0.06)",
								},
							},
						}}
					/>
				)}

				<Box mb="sm" mt="xl">
					<Box px="md" py="xs" style={{ borderLeft: `2px solid ${border}` }}>
						<Text
							fw={600}
							size="xs"
							c={textMuted}
							tt="uppercase"
							style={{ letterSpacing: "1px" }}
							ff="var(--mantine-headings-font-family)"
						>
							Views
						</Text>
					</Box>
				</Box>

				<DndContext
					onDragEnd={handleDragEnd}
					collisionDetection={closestCenter}
				>
					<SortableStandaloneViews
						views={sidebarData.views}
						textSecondary={textSecondary}
						onNavLinkClick={handleNavLinkClick}
						hoverColor="rgba(212, 165, 116, 0.06)"
						isCustomizeMode={state.isCustomizeMode}
						isMutationBusy={savedViewMutations.isPending}
						onToggleViewEnabled={(viewId) =>
							void savedViewMutations.toggleViewById(
								viewId,
								savedViewsQuery.savedViews,
							)
						}
					/>
				</DndContext>
			</Stack>

			<SidebarAccountSection account={toSidebarAccount(user)} />
		</Stack>
	);

	return (
		<>
			{isMobile && (
				<Drawer
					size={300}
					padding={0}
					withCloseButton={false}
					opened={props.drawerOpened}
					onClose={() => props.onCloseDrawer?.()}
					styles={{
						body: {
							height: "100%",
							backgroundColor: isDark ? "var(--mantine-color-dark-8)" : "white",
						},
						content: {
							backgroundColor: isDark ? "var(--mantine-color-dark-8)" : "white",
						},
					}}
				>
					{sidebarContent}
				</Drawer>
			)}

			{!isMobile && (
				<Box
					w={300}
					h="100vh"
					bg={surface}
					style={{
						flexShrink: 0,
						display: "flex",
						flexDirection: "column",
						borderRight: `1px solid ${border}`,
					}}
				>
					{sidebarContent}
				</Box>
			)}
		</>
	);
}

export function MobileSidebarBurger(props: {
	opened: boolean;
	onClick: () => void;
}) {
	const isMobile = useIsMobileScreen();
	const { textLink } = useThemeTokens();

	if (!isMobile) {
		return null;
	}

	return (
		<Burger
			size="sm"
			color={textLink}
			opened={props.opened}
			onClick={props.onClick}
		/>
	);
}
