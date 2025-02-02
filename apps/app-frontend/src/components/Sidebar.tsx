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
	Group,
	NavLink,
	Stack,
	Text,
	TextInput,
	useMantineColorScheme,
} from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { BookOpen, GripVertical, Home, Search, Settings } from "lucide-react";
import { useState } from "react";
import { FacetIcon } from "#/features/facets/icons";
import type { SidebarFacet, SidebarProps, SidebarView } from "./Sidebar.types";

const DEFAULT_FACET_COLOR = {
	base: "#5B7FFF",
	muted: "rgba(91, 127, 255, 0.12)",
};

const facetColors: Record<string, { base: string; muted: string }> = {
	media: DEFAULT_FACET_COLOR,
	fitness: { base: "#2DD4BF", muted: "rgba(45, 212, 191, 0.12)" },
	whiskey: { base: "#D4A574", muted: "rgba(212, 165, 116, 0.12)" },
	places: { base: "#A78BFA", muted: "rgba(167, 139, 250, 0.12)" },
};

function hexToMutedRgba(color: string) {
	const normalized = color.replace("#", "");
	const expanded =
		normalized.length === 3
			? normalized
					.split("")
					.map((part) => `${part}${part}`)
					.join("")
			: normalized;

	if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return undefined;

	const red = Number.parseInt(expanded.slice(0, 2), 16);
	const green = Number.parseInt(expanded.slice(2, 4), 16);
	const blue = Number.parseInt(expanded.slice(4, 6), 16);

	return `rgba(${red}, ${green}, ${blue}, 0.12)`;
}

function getFacetColor(facet: SidebarFacet) {
	if (facet.accentColor) {
		const muted = hexToMutedRgba(facet.accentColor);
		if (muted) return { muted, base: facet.accentColor };
	}

	return facetColors[facet.slug] ?? DEFAULT_FACET_COLOR;
}

function ViewIcon(props: { borderAccent: string; view: SidebarView }) {
	if (!props.view.icon)
		return <BookOpen color={props.borderAccent} size={16} />;

	return (
		<Box
			c={props.borderAccent}
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
	isCustomizeMode: boolean;
	onToggleFacet: (facetId: string) => void;
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
				opened={props.isExpanded}
				label={props.facet.name}
				onClick={() => props.onToggleFacet(props.facet.id)}
				leftSection={
					<Group gap={props.isCustomizeMode ? 8 : 0} wrap="nowrap">
						{props.isCustomizeMode && (
							<Box
								c={props.isDark ? "dark.4" : "stone.5"}
								component="button"
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
						"&:hover": {
							borderLeftColor: color.base,
							backgroundColor: color.muted,
						},
					},
				}}
			>
				{props.facet.entitySchemas.map((schema) => (
					<NavLink
						to="/"
						key={schema.id}
						label={schema.name}
						component={Link}
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
	const { colorScheme } = useMantineColorScheme();
	const [searchQuery, setSearchQuery] = useState("");
	const [expandedFacets, setExpandedFacets] = useState<Record<string, boolean>>(
		{},
	);

	const isDark = colorScheme === "dark";
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

	return (
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
			<Stack gap={0} h="100%">
				<Box p="xl" pb="lg">
					<Group align="flex-start" justify="space-between" mb={4}>
						<Group gap="sm">
							<Box
								w={32}
								h={32}
								style={{
									display: "grid",
									borderRadius: 6,
									placeItems: "center",
									background:
										"linear-gradient(135deg, #D4A574 0%, #C4963C 100%)",
								}}
							>
								<Text
									c="white"
									fw={700}
									size="md"
									ff="var(--mantine-headings-font-family)"
								>
									R
								</Text>
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
							color={props.isCustomizeMode ? "accent.5" : undefined}
							styles={{
								root: {
									color: props.isCustomizeMode ? borderAccent : textMuted,
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
						leftSection={<Home color={borderAccent} size={18} />}
						styles={{
							label: { fontWeight: 500, fontSize: "14px" },
							root: {
								padding: "10px 14px",
								borderLeft: "2px solid transparent",
								"&:hover": {
									backgroundColor: "rgba(212, 165, 116, 0.06)",
									borderLeftColor: borderAccent,
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
								c={textMuted}
								fw={600}
								size="xs"
								ff="var(--mantine-headings-font-family)"
								style={{ letterSpacing: "1px", textTransform: "uppercase" }}
							>
								Facets
							</Text>
						</Box>
					</Box>

					<DndContext
						collisionDetection={closestCenter}
						onDragEnd={handleDragEnd}
					>
						<SortableContext
							items={props.facets.map((facet) => facet.id)}
							strategy={verticalListSortingStrategy}
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
										onToggleFacet={handleToggleFacet}
										isCustomizeMode={props.isCustomizeMode}
									/>
								);
							})}
						</SortableContext>
					</DndContext>

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
							to="/"
							key={view.id}
							label={view.name}
							component={Link}
							leftSection={<ViewIcon borderAccent={borderAccent} view={view} />}
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
			</Stack>
		</Box>
	);
}
