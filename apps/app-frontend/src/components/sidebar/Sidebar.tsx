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
import { useHover } from "@mantine/hooks";
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
import { toSidebarAccount } from "#/components/sidebar/sidebar-account";
import { toSidebarData } from "#/components/sidebar/sidebar-data";
import { FacetIcon } from "#/features/facets/icons";
import {
	useFacetSidebarActions,
	useFacetSidebarState,
} from "#/features/facets/sidebar-context";
import { useSavedViewsQuery } from "#/features/saved-views/hooks";
import { useProtectedUser } from "#/hooks/protected-user";
import { useIsMobileScreen } from "#/hooks/screen";
import { useColorScheme } from "#/hooks/theme";
import type { SidebarFacet, SidebarProps, SidebarView } from "./Sidebar.types";
import { SidebarAccountSection } from "./SidebarAccountSection";

function getFacetColor(facet: SidebarFacet) {
	return { base: facet.accentColor, muted: rgba(facet.accentColor, 0) };
}

function ViewIcon(props: { view: SidebarView }) {
	return (
		<Box
			c={props.view.accentColor}
			style={{ display: "flex", alignItems: "center" }}
		>
			<FacetIcon icon={props.view.icon} size={16} />
		</Box>
	);
}

function SortableFacet(props: {
	isDark: boolean;
	facet: SidebarFacet;
	isExpanded: boolean;
	textPrimary: string;
	textSecondary: string;
	isMutationBusy: boolean;
	isCustomizeMode: boolean;
	onNavLinkClick: () => void;
	onEditFacet?: (facetId: string) => void;
	onToggleFacet: (facetId: string) => void;
	onToggleFacetEnabled?: (facetId: string) => void;
}) {
	const color = getFacetColor(props.facet);
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: props.facet.id });

	const style = {
		transition,
		opacity: isDragging ? 0.5 : 1,
		transform: CSS.Transform.toString(transform),
	};

	return (
		<Box ref={setNodeRef} style={style}>
			<NavLink
				component={Link}
				label={props.facet.name}
				onClick={() => {
					if (props.facet.views?.length) {
						props.onToggleFacet(props.facet.id);
					}

					props.onNavLinkClick();
				}}
				to={`/tracking/${props.facet.slug}`}
				styles={{
					label: {
						fontSize: "14px",
						fontWeight: 500,
						color: props.textPrimary,
					},
					root: {
						padding: "10px 14px",
						borderLeft: "2px solid transparent",
						opacity: props.facet.enabled ? 1 : 0.48,
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
								c={props.isDark ? "dark.4" : "stone.5"}
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
							<FacetIcon icon={props.facet.icon} size={18} />
						</Box>
					</Group>
				}
				rightSection={
					<Group gap={4} wrap="nowrap">
						{props.isCustomizeMode ? (
							<Group gap={4} wrap="nowrap">
								{props.facet.isBuiltin ? undefined : (
									<ActionIcon
										size="sm"
										variant="subtle"
										aria-label="Edit facet"
										disabled={props.isMutationBusy}
										onClick={(event) => {
											event.preventDefault();
											event.stopPropagation();
											props.onEditFacet?.(props.facet.id);
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
										props.facet.enabled ? "Disable facet" : "Enable facet"
									}
									onClick={(event) => {
										event.preventDefault();
										event.stopPropagation();
										props.onToggleFacetEnabled?.(props.facet.id);
									}}
								>
									{props.facet.enabled ? (
										<ToggleRight size={14} strokeWidth={1.8} />
									) : (
										<ToggleLeft size={14} strokeWidth={1.8} />
									)}
								</ActionIcon>
							</Group>
						) : undefined}
						{props.facet.views?.length ? (
							<Box
								aria-hidden="true"
								style={{ display: "flex", alignItems: "center" }}
							>
								{props.isExpanded ? (
									<ChevronDown size={16} strokeWidth={1.8} />
								) : (
									<ChevronRight size={16} strokeWidth={1.8} />
								)}
							</Box>
						) : undefined}
					</Group>
				}
			/>
			{props.isExpanded
				? props.facet.views?.map((view) => (
						<NavLink
							key={view.id}
							component={Link}
							label={view.name}
							onClick={props.onNavLinkClick}
							leftSection={<ViewIcon view={view} />}
							to={`/tracking/random-slug/views/${view.id}`}
							styles={{
								root: {
									paddingLeft: "40px",
									"&:hover": { backgroundColor: color.muted },
								},
								label: {
									fontSize: "13px",
									fontWeight: 400,
									color: props.textSecondary,
								},
							}}
						/>
					))
				: undefined}
		</Box>
	);
}

export function Sidebar(props: SidebarProps) {
	const user = useProtectedUser();
	const isMobile = useIsMobileScreen();
	const state = useFacetSidebarState();
	const actions = useFacetSidebarActions();
	const computedColorScheme = useColorScheme();
	const savedViewsQuery = useSavedViewsQuery();
	const { hovered, ref } = useHover<HTMLDivElement>();
	const [searchQuery, setSearchQuery] = useState("");
	const [expandedFacets, setExpandedFacets] = useState<Record<string, boolean>>(
		{},
	);
	const sidebarData = toSidebarData({
		views: savedViewsQuery.savedViews,
		facets: state.facets,
		isCustomizeMode: state.isCustomizeMode,
	});

	const isDark = computedColorScheme === "dark";
	const surface = isDark ? "var(--mantine-color-dark-8)" : "white";
	const border = isDark
		? "var(--mantine-color-dark-6)"
		: "var(--mantine-color-stone-3)";
	const borderAccent = "var(--mantine-color-accent-5)";
	const textPrimary = isDark
		? "var(--mantine-color-dark-0)"
		: "var(--mantine-color-dark-9)";
	const textMuted = isDark
		? "var(--mantine-color-dark-4)"
		: "var(--mantine-color-stone-5)";
	const textSecondary = isDark
		? "var(--mantine-color-dark-2)"
		: "var(--mantine-color-dark-6)";

	const handleSearchChange = (value: string) => {
		setSearchQuery(value);
	};

	const handleToggleFacet = (facetId: string) => {
		setExpandedFacets((current) => ({
			...current,
			[facetId]: !(current[facetId] ?? false),
		}));
	};

	const handleDragEnd = (event: DragEndEvent) => {
		if (!state.isCustomizeMode) return;

		const { active, over } = event;
		if (!over || active.id === over.id) return;

		const activeIndex = sidebarData.facets.findIndex(
			(facet) => facet.id === active.id,
		);
		const overIndex = sidebarData.facets.findIndex(
			(facet) => facet.id === over.id,
		);

		if (activeIndex === -1 || overIndex === -1) return;

		const nextFacets = Array.from(sidebarData.facets);
		const movedFacet = nextFacets[activeIndex];
		if (!movedFacet) return;

		nextFacets.splice(activeIndex, 1);
		nextFacets.splice(overIndex, 0, movedFacet);
		void actions.reorderFacetIds(nextFacets.map((facet) => facet.id));
	};

	const handleNavLinkClick = () => {
		if (isMobile) props.onCloseDrawer?.();
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

			<Box h={1} mx="lg" style={{ backgroundColor: border }} />

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
							ff="var(--mantine-headings-font-family)"
							style={{ letterSpacing: "1px", textTransform: "uppercase" }}
						>
							Facets
						</Text>
					</Box>
				</Box>

				<DndContext
					onDragEnd={handleDragEnd}
					collisionDetection={closestCenter}
				>
					<SortableContext
						strategy={verticalListSortingStrategy}
						items={sidebarData.facets.map((facet) => facet.id)}
					>
						{sidebarData.facets.map((facet) => {
							const isExpanded =
								expandedFacets[facet.id] ?? facet.isExpanded ?? false;

							return (
								<SortableFacet
									facet={facet}
									key={facet.id}
									isDark={isDark}
									isExpanded={isExpanded}
									textPrimary={textPrimary}
									textSecondary={textSecondary}
									onEditFacet={actions.openEditModal}
									onToggleFacet={handleToggleFacet}
									onNavLinkClick={handleNavLinkClick}
									isCustomizeMode={state.isCustomizeMode}
									isMutationBusy={state.isMutationBusy}
									onToggleFacetEnabled={(facetId) =>
										void actions.toggleFacetById(facetId)
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
							ff="var(--mantine-headings-font-family)"
							style={{ letterSpacing: "1px", textTransform: "uppercase" }}
						>
							Views
						</Text>
					</Box>
				</Box>

				{sidebarData.views.map((view) => (
					<NavLink
						key={view.id}
						label={view.name}
						component={Link}
						onClick={handleNavLinkClick}
						leftSection={<ViewIcon view={view} />}
						to={`/tracking/random-slug/views/${view.id}`}
						styles={{
							label: {
								fontSize: "13px",
								fontWeight: 400,
								color: textSecondary,
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
				))}
			</Stack>

			<SidebarAccountSection
				border={border}
				isDark={isDark}
				textMuted={textMuted}
				account={toSidebarAccount(user)}
				textPrimary={textPrimary}
				borderAccent={borderAccent}
			/>
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
	const computedColorScheme = useColorScheme();
	const isDark = computedColorScheme === "dark";

	if (!isMobile) return null;

	return (
		<Burger
			size="sm"
			opened={props.opened}
			onClick={props.onClick}
			color={
				isDark ? "var(--mantine-color-dark-1)" : "var(--mantine-color-dark-7)"
			}
		/>
	);
}
