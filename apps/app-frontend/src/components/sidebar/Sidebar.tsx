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
import { FacetIcon } from "#/features/facets/icons";
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
	onEditFacet?: (facetId: string) => void;
	onToggleFacet: (facetId: string) => void;
	onNavLinkClick: () => void;
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
				label={props.facet.name}
				opened={props.isExpanded}
				onClick={() => props.onToggleFacet(props.facet.id)}
				styles={{
					children: { padding: 0 },
					chevron: { color: props.textPrimary },
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
								onClick={(event) => event.stopPropagation()}
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
					props.isCustomizeMode ? (
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
					) : undefined
				}
			>
				{props.facet.views?.map((view) => (
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
				))}
			</NavLink>
		</Box>
	);
}

export function Sidebar(props: SidebarProps) {
	const isMobile = useIsMobileScreen();
	const { hovered, ref } = useHover<HTMLDivElement>();
	const computedColorScheme = useColorScheme();
	const [searchQuery, setSearchQuery] = useState("");
	const [expandedFacets, setExpandedFacets] = useState<Record<string, boolean>>(
		{},
	);

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
		props.onSearch?.(value);
	};

	const handleToggleFacet = (facetId: string) => {
		setExpandedFacets((current) => ({
			...current,
			[facetId]: !(current[facetId] ?? false),
		}));
		props.onToggleFacet?.(facetId);
	};

	const handleDragEnd = (event: DragEndEvent) => {
		if (!props.isCustomizeMode) return;

		const { active, over } = event;
		if (!over || active.id === over.id) return;

		const activeIndex = props.facets.findIndex(
			(facet) => facet.id === active.id,
		);
		const overIndex = props.facets.findIndex((facet) => facet.id === over.id);

		if (activeIndex === -1 || overIndex === -1) return;

		const nextFacets = Array.from(props.facets);
		const movedFacet = nextFacets[activeIndex];
		if (!movedFacet) return;

		nextFacets.splice(activeIndex, 1);
		nextFacets.splice(overIndex, 0, movedFacet);
		props.onReorderFacets(nextFacets);
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
						onClick={props.onToggleCustomizeMode}
						opacity={hovered || props.isCustomizeMode ? 1 : 0}
						color={props.isCustomizeMode ? "accent.5" : undefined}
						styles={{
							root: {
								transition: "opacity 120ms ease",
								color: props.isCustomizeMode ? borderAccent : textMuted,
								pointerEvents:
									hovered || props.isCustomizeMode ? "auto" : "none",
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
						items={props.facets.map((facet) => facet.id)}
					>
						{props.facets.map((facet) => {
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
									onEditFacet={props.onEditFacet}
									onToggleFacet={handleToggleFacet}
									onNavLinkClick={handleNavLinkClick}
									isCustomizeMode={props.isCustomizeMode}
									isMutationBusy={props.isMutationBusy ?? false}
									onToggleFacetEnabled={props.onToggleFacetEnabled}
								/>
							);
						})}
					</SortableContext>
				</DndContext>

				{props.isCustomizeMode && (
					<NavLink
						label="Add tracker"
						onClick={props.onCreateFacet}
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

				{props.views.map((view) => (
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
				account={props.account}
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
					opened={props.drawerOpened ?? false}
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
