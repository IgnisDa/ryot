import {
	Box,
	Button,
	Grid,
	Group,
	Paper,
	SimpleGrid,
	Stack,
	Text,
} from "@mantine/core";
import { createFileRoute } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Pencil, Plus, Star, Wine } from "lucide-react";
import { EntityCard } from "#/components/EntityCard";
import { StatsCard } from "#/components/StatsCard";
import type { AppEntitySchema } from "#/features/entity-schemas/model";
import { FacetIcon } from "#/features/facets/icons";
import { useColorScheme } from "#/hooks/theme";

export const Route = createFileRoute("/_protected/tracker-overview")({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<TrackerOverview
			facetSlug="whiskey"
			entitySchemas={[]}
			icon="wine"
			onAddEntitySchema={() => {}}
			name="My Whiskey Collection"
			description="A personal journal of single malts, bourbons, and everything in between — tracking tastings, notes, and discoveries over time."
		/>
	);
}

export interface TrackerOverviewProps {
	name: string;
	icon: string;
	facetSlug: string;
	description?: string;
	onAddEntitySchema: () => void;
	entitySchemas: AppEntitySchema[];
}

const DEMO_STATS = [
	{ label: "Total Whiskies", value: 42, change: "+5 this month" },
	{ label: "Tastings", value: 8, change: "This month" },
	{ label: "Avg Rating", value: "88.4", change: "↑ from 86.1" },
	{ label: "Last Active", value: "2h ago", change: undefined },
];

const DEMO_ACTIVITY = [
	{ icon: Wine, time: "2h ago", action: "Tasted Ardbeg 10" },
	{ icon: Plus, time: "3d ago", action: "Added Glenfarclas 21" },
	{
		time: "5d ago",
		icon: Pencil,
		action: "Updated tasting notes for Lagavulin 16",
	},
	{ icon: Plus, time: "1w ago", action: "Added Islay Mist 12" },
	{ icon: Wine, time: "1w ago", action: "Tasted Buffalo Trace" },
];

const DEMO_ENTITIES = [
	{
		name: "Ardbeg 10",
		rating: "92",
		schemaName: "Whisky",
		lastEvent: "Tasted 2h ago",
		image: "https://picsum.photos/seed/ardbeg-scotch/600/440",
	},
	{
		name: "Glenfarclas 21",
		rating: "95",
		schemaName: "Whisky",
		lastEvent: "Added 3 days ago",
		image: "https://picsum.photos/seed/glenfarclas-highland/600/440",
	},
	{
		name: "Buffalo Trace",
		rating: "88",
		schemaName: "Whisky",
		lastEvent: "Tasted last week",
		image: "https://picsum.photos/seed/buffalo-bourbon/600/440",
	},
];

function getTokens(isDark: boolean) {
	return {
		surface: isDark ? "var(--mantine-color-dark-8)" : "white",
		textLink: isDark
			? "var(--mantine-color-dark-1)"
			: "var(--mantine-color-dark-7)",
	};
}

function PageHeader(props: {
	name: string;
	icon: string;
	isDark: boolean;
	accentColor: string;
	description?: string;
}) {
	return (
		<Stack gap="xs">
			<Group gap="sm" align="center">
				<Box
					p="sm"
					style={{
						flexShrink: 0,
						borderRadius: "var(--mantine-radius-md)",
						color: props.accentColor,
						backgroundColor: `color-mix(in srgb, ${props.accentColor} 15%, transparent)`,
					}}
				>
					<FacetIcon size={24} strokeWidth={2} icon={props.icon} />
				</Box>
				<Stack gap={2}>
					<Text
						fw={700}
						size="xl"
						style={{ fontFamily: "Space Grotesk, sans-serif", lineHeight: 1.2 }}
					>
						{props.name}
					</Text>
					{props.description && (
						<Text size="sm" c="dimmed" style={{ maxWidth: 600 }}>
							{props.description}
						</Text>
					)}
				</Stack>
			</Group>
		</Stack>
	);
}

function ActivityFeedItem(props: {
	time: string;
	action: string;
	icon: LucideIcon;
	accentColor: string;
}) {
	const Icon = props.icon;
	return (
		<Group gap="sm" align="flex-start" justify="space-between">
			<Group gap="sm" align="flex-start" style={{ flex: 1 }}>
				<Box
					w={30}
					h={30}
					style={{
						flexShrink: 0,
						borderRadius: "50%",
						display: "grid",
						placeItems: "center",
						backgroundColor: `color-mix(in srgb, ${props.accentColor} 15%, transparent)`,
					}}
				>
					<Icon size={14} color={props.accentColor} />
				</Box>
				<Text size="sm" style={{ flex: 1, paddingTop: 5, lineHeight: 1.5 }}>
					{props.action}
				</Text>
			</Group>
			<Text size="xs" c="dimmed" style={{ flexShrink: 0, paddingTop: 7 }}>
				{props.time}
			</Text>
		</Group>
	);
}

function ActivityFeed(props: { isDark: boolean; accentColor: string }) {
	const { surface } = getTokens(props.isDark);
	return (
		<Paper p="md" withBorder radius="md" bg={surface}>
			<Stack gap="md">
				<Text
					fw={600}
					size="xs"
					tt="uppercase"
					c="dimmed"
					style={{ letterSpacing: "0.8px" }}
				>
					Recent Activity
				</Text>
				<Stack gap="sm">
					{DEMO_ACTIVITY.map((item) => (
						<ActivityFeedItem
							key={item.action}
							icon={item.icon}
							time={item.time}
							action={item.action}
							accentColor={props.accentColor}
						/>
					))}
				</Stack>
			</Stack>
		</Paper>
	);
}

function RecentEntitiesGrid(props: { isDark: boolean; accentColor: string }) {
	const facetColor = {
		base: props.accentColor,
		muted: `color-mix(in srgb, ${props.accentColor} 15%, transparent)`,
	};
	return (
		<Stack gap="sm">
			<Text
				fw={600}
				size="xs"
				tt="uppercase"
				c="dimmed"
				style={{ letterSpacing: "0.8px" }}
			>
				Recently Added
			</Text>
			<SimpleGrid cols={2} spacing="sm">
				{DEMO_ENTITIES.map((entity) => (
					<EntityCard
						key={entity.name}
						isDark={props.isDark}
						name={entity.name}
						image={entity.image}
						rating={entity.rating}
						facetColor={facetColor}
						lastEvent={entity.lastEvent}
						schemaName={entity.schemaName}
					/>
				))}
			</SimpleGrid>
		</Stack>
	);
}

function QuickActionsPanel(props: { isDark: boolean; accentColor: string }) {
	const { surface } = getTokens(props.isDark);
	const accentBg = `color-mix(in srgb, ${props.accentColor} 12%, transparent)`;
	return (
		<Paper p="md" withBorder radius="md" bg={surface}>
			<Stack gap="sm">
				<Text
					fw={600}
					size="xs"
					tt="uppercase"
					c="dimmed"
					style={{ letterSpacing: "0.8px" }}
				>
					Quick Actions
				</Text>
				<Stack gap="xs">
					<Button
						fullWidth
						size="sm"
						variant="light"
						onClick={() => {}}
						leftSection={<Plus size={14} />}
						styles={{
							root: {
								color: props.accentColor,
								backgroundColor: accentBg,
							},
						}}
					>
						Add Whiskey
					</Button>
					<Button
						fullWidth
						size="sm"
						variant="light"
						onClick={() => {}}
						leftSection={<Wine size={14} />}
						styles={{
							root: {
								color: props.accentColor,
								backgroundColor: accentBg,
							},
						}}
					>
						Log Tasting
					</Button>
					<Button
						fullWidth
						size="sm"
						variant="subtle"
						onClick={() => {}}
						leftSection={<Star size={14} />}
						style={{ color: "var(--mantine-color-dark-3)" }}
					>
						New Schema
					</Button>
				</Stack>
			</Stack>
		</Paper>
	);
}

function SchemaSummaryPanel(props: {
	isDark: boolean;
	entitySchemas: AppEntitySchema[];
}) {
	const { surface } = getTokens(props.isDark);
	if (props.entitySchemas.length === 0) return null;
	return (
		<Paper p="md" withBorder radius="md" bg={surface}>
			<Stack gap="sm">
				<Text
					fw={600}
					size="xs"
					tt="uppercase"
					c="dimmed"
					style={{ letterSpacing: "0.8px" }}
				>
					Schemas
				</Text>
				<Stack gap="xs">
					{props.entitySchemas.map((schema) => {
						const propCount = Object.keys(schema.propertiesSchema).length;
						return (
							<Group key={schema.id} align="center" justify="space-between">
								<Group gap="xs" align="center">
									<FacetIcon size={14} icon={schema.icon} />
									<Text size="sm">{schema.name}</Text>
								</Group>
								<Text size="xs" c="dimmed">
									{propCount}p
								</Text>
							</Group>
						);
					})}
				</Stack>
			</Stack>
		</Paper>
	);
}

function SavedViewsPanel(props: { isDark: boolean }) {
	const { surface, textLink } = getTokens(props.isDark);
	return (
		<Paper p="md" withBorder radius="md" bg={surface}>
			<Stack gap="sm">
				<Text
					fw={600}
					size="xs"
					tt="uppercase"
					c="dimmed"
					style={{ letterSpacing: "0.8px" }}
				>
					Saved Views
				</Text>
				<Stack gap={4}>
					{["Browse all", "By distillery", "Favorites"].map((view) => (
						<Text
							key={view}
							size="sm"
							style={{ cursor: "pointer", color: textLink }}
						>
							{view}
						</Text>
					))}
				</Stack>
			</Stack>
		</Paper>
	);
}

function SchemaFooterCards(props: {
	isDark: boolean;
	entitySchemas: AppEntitySchema[];
	onAddEntitySchema: () => void;
}) {
	const { surface } = getTokens(props.isDark);
	if (props.entitySchemas.length === 0) return null;
	return (
		<Stack gap="md">
			<Text
				fw={600}
				size="xs"
				tt="uppercase"
				c="dimmed"
				style={{ letterSpacing: "0.8px" }}
			>
				Entity Schemas
			</Text>
			{props.entitySchemas.map((schema) => {
				const propCount = Object.keys(schema.propertiesSchema).length;
				return (
					<Paper p="md" key={schema.id} withBorder radius="md" bg={surface}>
						<Group align="center" justify="space-between">
							<Group gap="sm" align="center">
								<Box
									p="xs"
									style={{
										color: schema.accentColor,
										borderRadius: "var(--mantine-radius-md)",
										backgroundColor: `color-mix(in srgb, ${schema.accentColor} 15%, transparent)`,
									}}
								>
									<FacetIcon size={18} strokeWidth={2} icon={schema.icon} />
								</Box>
								<Stack gap={2}>
									<Text fw={600}>{schema.name}</Text>
									<Text size="xs" c="dimmed">
										{propCount} {propCount === 1 ? "property" : "properties"}
									</Text>
								</Stack>
							</Group>
							<Group gap="xs">
								<Button size="xs" variant="light" onClick={() => {}}>
									View Entities
								</Button>
								<Button size="xs" variant="light" onClick={() => {}}>
									Add {schema.name}
								</Button>
							</Group>
						</Group>
					</Paper>
				);
			})}
			<Paper
				p="md"
				withBorder
				radius="md"
				bg={surface}
				style={{ textAlign: "center" }}
			>
				<Stack gap="sm" align="center">
					<Text size="sm" c="dimmed">
						Need to track another type of entity?
					</Text>
					<Button size="sm" variant="light" onClick={props.onAddEntitySchema}>
						Add another entity schema
					</Button>
				</Stack>
			</Paper>
		</Stack>
	);
}

export function TrackerOverview(props: TrackerOverviewProps) {
	const colorScheme = useColorScheme();
	const isDark = colorScheme === "dark";
	const accentColor = props.entitySchemas[0]?.accentColor ?? "#D4A574";
	return (
		<Stack gap="xl">
			<PageHeader
				isDark={isDark}
				icon={props.icon}
				name={props.name}
				accentColor={accentColor}
				description={props.description}
			/>
			<SimpleGrid cols={{ base: 1, xs: 2, sm: 4 }} spacing="sm">
				{DEMO_STATS.map((stat) => (
					<StatsCard
						isDark={isDark}
						key={stat.label}
						color={accentColor}
						label={stat.label}
						value={stat.value}
						change={stat.change}
					/>
				))}
			</SimpleGrid>

			<Grid>
				<Grid.Col span={{ base: 12, md: 8 }}>
					<Stack gap="md">
						<ActivityFeed isDark={isDark} accentColor={accentColor} />
						<RecentEntitiesGrid isDark={isDark} accentColor={accentColor} />
					</Stack>
				</Grid.Col>
				<Grid.Col span={{ base: 12, md: 4 }}>
					<Stack gap="md">
						<QuickActionsPanel isDark={isDark} accentColor={accentColor} />
						<SchemaSummaryPanel
							isDark={isDark}
							entitySchemas={props.entitySchemas}
						/>
						<SavedViewsPanel isDark={isDark} />
					</Stack>
				</Grid.Col>
			</Grid>

			<SchemaFooterCards
				isDark={isDark}
				entitySchemas={props.entitySchemas}
				onAddEntitySchema={props.onAddEntitySchema}
			/>
		</Stack>
	);
}
