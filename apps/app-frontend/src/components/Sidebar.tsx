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
	Stack,
	Text,
	TextInput,
	useMantineColorScheme,
} from "@mantine/core";
import { Link } from "@tanstack/react-router";
import {
	ChevronRight,
	GripVertical,
	Home,
	Search,
	Settings,
} from "lucide-react";
import { useState } from "react";
import { FacetIcon } from "#/features/facets/icons";
import type { SidebarFacet, SidebarProps } from "./Sidebar.types";

function SortableFacet(props: {
	facet: SidebarFacet;
	isExpanded: boolean;
	accentColor: string;
	textPrimary: string;
	isCustomizeMode: boolean;
	placeholderColor: string;
	icon: string | null | undefined;
	onToggleFacet: (facetId: string) => void;
	entitySchemas: Array<{ id: string; name: string }>;
}) {
	const { colorScheme } = useMantineColorScheme();
	const isDark = colorScheme === "dark";
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

	const [hoverStates, setHoverStates] = useState<Record<string, boolean>>({});

	return (
		<Stack gap={0} ref={setNodeRef} style={style}>
			<Group
				p="md"
				pt="sm"
				pb="sm"
				gap="xs"
				component="button"
				onClick={() => props.onToggleFacet(props.facet.id)}
				onMouseEnter={() =>
					setHoverStates((prev) => ({ ...prev, [props.facet.id]: true }))
				}
				onMouseLeave={() =>
					setHoverStates((prev) => ({ ...prev, [props.facet.id]: false }))
				}
				style={{
					width: "100%",
					border: "none",
					textAlign: "left",
					cursor: "pointer",
					background: "none",
					transition: "all 0.2s ease",
					borderLeft: "3px solid transparent",
					paddingLeft: "calc(var(--mantine-spacing-md) - 3px)",
					borderLeftColor: hoverStates[props.facet.id]
						? props.accentColor
						: "transparent",
					backgroundColor: hoverStates[props.facet.id]
						? isDark
							? "var(--mantine-color-dark-7)"
							: "var(--mantine-color-stone-1)"
						: "transparent",
				}}
			>
				{props.isCustomizeMode && (
					<Box
						component="div"
						c={props.placeholderColor}
						{...attributes}
						{...listeners}
						style={{
							cursor: hoverStates[`drag-${props.facet.id}`]
								? "grabbing"
								: "grab",
						}}
						onMouseEnter={() =>
							setHoverStates((prev) => ({
								...prev,
								[`drag-${props.facet.id}`]: true,
							}))
						}
						onMouseLeave={() =>
							setHoverStates((prev) => ({
								...prev,
								[`drag-${props.facet.id}`]: false,
							}))
						}
					>
						<GripVertical size={16} />
					</Box>
				)}
				<FacetIcon icon={props.icon} size={18} />
				<Text fw={500} size="sm" style={{ flex: 1 }} c={props.textPrimary}>
					{props.facet.name}
				</Text>
				{props.entitySchemas.length > 0 && (
					<ChevronRight
						size={16}
						color={props.textPrimary}
						style={{
							transition: "transform 0.2s ease",
							transform: props.isExpanded ? "rotate(90deg)" : "rotate(0deg)",
						}}
					/>
				)}
			</Group>

			{props.entitySchemas.length > 0 && props.isExpanded && (
				<Stack gap={0}>
					{props.entitySchemas.map((schema) => (
						<Box
							p="md"
							pt="sm"
							pb="sm"
							to="/"
							td="none"
							key={schema.id}
							component={Link}
							onMouseEnter={() =>
								setHoverStates((prev) => ({ ...prev, [schema.id]: true }))
							}
							onMouseLeave={() =>
								setHoverStates((prev) => ({ ...prev, [schema.id]: false }))
							}
							style={{
								paddingLeft: "50px",
								transition: "all 0.2s ease",
								borderLeft: "3px solid transparent",
								borderLeftColor: hoverStates[schema.id]
									? props.accentColor
									: "transparent",
								backgroundColor: hoverStates[schema.id]
									? isDark
										? "var(--mantine-color-dark-7)"
										: "var(--mantine-color-stone-1)"
									: "transparent",
							}}
						>
							<Text size="sm" c={props.placeholderColor}>
								{schema.name}
							</Text>
						</Box>
					))}
				</Stack>
			)}
		</Stack>
	);
}

export function Sidebar(props: SidebarProps) {
	const { colorScheme } = useMantineColorScheme();
	const [searchQuery, setSearchQuery] = useState("");
	const [expandedFacets, setExpandedFacets] = useState<Record<string, boolean>>(
		{},
	);
	const [hoverStates, setHoverStates] = useState<Record<string, boolean>>({});

	const accentColor = "#D4A574";
	const isDark = colorScheme === "dark";
	const bgColor = isDark ? "var(--mantine-color-dark-8)" : "white";
	const borderColor = isDark
		? "var(--mantine-color-dark-7)"
		: "var(--mantine-color-stone-2)";
	const textPrimary = isDark
		? "var(--mantine-color-dark-0)"
		: "var(--mantine-color-dark-9)";
	const placeholderColor = isDark
		? "var(--mantine-color-dark-4)"
		: "var(--mantine-color-stone-5)";

	const handleSearchChange = (value: string) => {
		setSearchQuery(value);
		props.onSearch?.(value);
	};

	const handleToggleFacet = (facetId: string) => {
		setExpandedFacets((prev) => ({ ...prev, [facetId]: !prev[facetId] }));
		props.onToggleFacet?.(facetId);
	};

	const handleDragEnd = (event: DragEndEvent) => {
		if (!props.isCustomizeMode) return;

		const { active, over } = event;
		if (!over || active.id === over.id) return;

		const activeIndex = props.facets.findIndex((f) => f.id === active.id);
		const overIndex = props.facets.findIndex((f) => f.id === over.id);

		if (activeIndex === -1 || overIndex === -1) return;

		const newFacets = Array.from(props.facets);
		const movedFacet = newFacets[activeIndex];
		if (!movedFacet) return;

		newFacets.splice(activeIndex, 1);
		newFacets.splice(overIndex, 0, movedFacet);
		props.onReorderFacets(newFacets);
	};

	return (
		<Stack
			p={0}
			gap={0}
			w={240}
			h="100vh"
			bg={bgColor}
			style={{ overflow: "auto", borderRight: `1px solid ${borderColor}` }}
		>
			<Group
				p="md"
				align="center"
				justify="space-between"
				style={{ borderBottom: `1px solid ${borderColor}` }}
			>
				<Box
					w={40}
					h={40}
					fw={700}
					fz="18px"
					c="white"
					component="div"
					ff="var(--mantine-headings-font-family)"
					style={{
						display: "grid",
						borderRadius: "6px",
						placeItems: "center",
						transition: "all 0.2s ease",
						background: `linear-gradient(135deg, ${accentColor} 0%, #E6C9A0 100%)`,
					}}
				>
					R
				</Box>

				<ActionIcon
					size="lg"
					color="gray"
					variant="subtle"
					onClick={props.onToggleCustomizeMode}
					onMouseEnter={() =>
						setHoverStates((prev) => ({ ...prev, settingsButton: true }))
					}
					onMouseLeave={() =>
						setHoverStates((prev) => ({ ...prev, settingsButton: false }))
					}
					style={{
						transition: "all 0.2s ease",
						borderLeft: hoverStates.settingsButton
							? `3px solid ${accentColor}`
							: "3px solid transparent",
						backgroundColor: hoverStates.settingsButton
							? isDark
								? "var(--mantine-color-dark-6)"
								: "var(--mantine-color-stone-1)"
							: "transparent",
					}}
				>
					<Settings
						size={18}
						color={props.isCustomizeMode ? accentColor : "currentColor"}
					/>
				</ActionIcon>
			</Group>

			<Box p="md">
				<TextInput
					radius="sm"
					value={searchQuery}
					placeholder="Search..."
					leftSection={<Search size={16} color={accentColor} />}
					onChange={(e) => handleSearchChange(e.currentTarget.value)}
					styles={{
						input: {
							backgroundColor: isDark
								? "var(--mantine-color-dark-7)"
								: "var(--mantine-color-stone-1)",
							borderColor: borderColor,
							color: textPrimary,
							fontWeight: 500,
							fontSize: "14px",
							transition: "all 0.2s ease",
							"&::placeholder": {
								color: placeholderColor,
							},
							"&:focus": {
								borderColor: accentColor,
								boxShadow: `0 0 0 2px ${accentColor}20`,
							},
							"&:hover:not(:focus)": {
								borderLeftWidth: "3px",
								borderLeftColor: accentColor,
								borderColor: isDark
									? "var(--mantine-color-dark-5)"
									: "var(--mantine-color-stone-4)",
								paddingLeft: "calc(var(--mantine-spacing-md) - 2px)",
							},
						},
					}}
				/>
			</Box>

			<Box
				p="md"
				to="/"
				pt="sm"
				pb="sm"
				td="none"
				component={Link}
				onMouseEnter={() =>
					setHoverStates((prev) => ({ ...prev, homeLink: true }))
				}
				onMouseLeave={() =>
					setHoverStates((prev) => ({ ...prev, homeLink: false }))
				}
				style={{
					transition: "all 0.2s ease",
					borderLeft: "3px solid transparent",
					paddingLeft: "calc(var(--mantine-spacing-md) - 3px)",
					borderLeftColor: hoverStates.homeLink ? accentColor : "transparent",
					backgroundColor: hoverStates.homeLink
						? isDark
							? "var(--mantine-color-dark-7)"
							: "var(--mantine-color-stone-1)"
						: "transparent",
				}}
			>
				<Group gap="xs">
					<Home size={18} color={textPrimary} />
					<Text size="sm" fw={500} c={textPrimary}>
						Home
					</Text>
				</Group>
			</Box>

			<Stack gap={0} style={{ flex: 1, overflow: "auto" }}>
				<Box p="md" pb="xs" pt="md">
					<Text
						fw={600}
						size="xs"
						lts="0.5px"
						tt="uppercase"
						c={placeholderColor}
						ff="var(--mantine-headings-font-family)"
					>
						Facets
					</Text>
				</Box>

				<DndContext
					onDragEnd={handleDragEnd}
					collisionDetection={closestCenter}
				>
					<SortableContext
						strategy={verticalListSortingStrategy}
						items={props.facets.map((f) => f.id)}
					>
						{props.facets.map((facet) => {
							const isExpanded =
								expandedFacets[facet.id] ?? (facet.isExpanded || false);

							return (
								<SortableFacet
									facet={facet}
									key={facet.id}
									icon={facet.icon}
									isExpanded={isExpanded}
									accentColor={accentColor}
									textPrimary={textPrimary}
									onToggleFacet={handleToggleFacet}
									placeholderColor={placeholderColor}
									entitySchemas={facet.entitySchemas}
									isCustomizeMode={props.isCustomizeMode}
								/>
							);
						})}
					</SortableContext>
				</DndContext>

				<Box p="md" pt="lg" style={{ marginTop: "auto" }}>
					<Text
						fw={600}
						size="xs"
						lts="0.5px"
						tt="uppercase"
						c={placeholderColor}
						ff="var(--mantine-headings-font-family)"
					>
						Views
					</Text>
				</Box>

				{props.views.map((view) => {
					return (
						<Box
							to="/"
							p="md"
							pt="sm"
							pb="sm"
							td="none"
							key={view.id}
							component={Link}
							style={{
								transition: "all 0.2s ease",
								borderLeft: "3px solid transparent",
								paddingLeft: "calc(var(--mantine-spacing-md) - 3px)",
								borderLeftColor: hoverStates[view.id]
									? accentColor
									: "transparent",
								backgroundColor: hoverStates[view.id]
									? isDark
										? "var(--mantine-color-dark-7)"
										: "var(--mantine-color-stone-1)"
									: "transparent",
							}}
							onMouseEnter={() =>
								setHoverStates((prev) => ({ ...prev, [view.id]: true }))
							}
							onMouseLeave={() =>
								setHoverStates((prev) => ({ ...prev, [view.id]: false }))
							}
						>
							<Group gap="xs">
								<FacetIcon icon={view.icon} size={18} />
								<Text size="sm" fw={500} c={textPrimary}>
									{view.name}
								</Text>
							</Group>
						</Box>
					);
				})}
			</Stack>
		</Stack>
	);
}
