import { Anchor, Box, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { FilePlus2, NotebookPen, Plus, Shapes } from "lucide-react";
import type { AppSavedView } from "#/features/saved-views/model";
import { TrackerIcon } from "./icons";
import type { AppTracker } from "./model";

export function getTrackerOverviewTokens(isDark: boolean) {
	return {
		surface: isDark ? "var(--mantine-color-dark-8)" : "white",
		textLink: isDark
			? "var(--mantine-color-dark-1)"
			: "var(--mantine-color-dark-7)",
	};
}

export function TrackerOverviewHeader(props: {
	tracker: AppTracker;
	accentColor: string;
}) {
	return (
		<Stack gap="xs">
			<Group gap="sm" align="center">
				<Box
					p="sm"
					style={{
						flexShrink: 0,
						color: props.accentColor,
						borderRadius: "var(--mantine-radius-md)",
						backgroundColor: `color-mix(in srgb, ${props.accentColor} 15%, transparent)`,
					}}
				>
					<TrackerIcon size={24} strokeWidth={2} icon={props.tracker.icon} />
				</Box>
				<Stack gap={2}>
					<Text
						fw={700}
						lh={1.2}
						size="xl"
						ff="var(--mantine-headings-font-family)"
					>
						{props.tracker.name}
					</Text>
					{props.tracker.description && (
						<Text size="sm" c="dimmed" maw={680}>
							{props.tracker.description}
						</Text>
					)}
				</Stack>
			</Group>
		</Stack>
	);
}

export function TrackerOverviewActivityItem(props: {
	time: string;
	action: string;
	entityId: string;
	trackerSlug: string;
	accentColor: string;
	kind: "entity" | "event";
}) {
	const Icon: LucideIcon = props.kind === "event" ? NotebookPen : FilePlus2;

	return (
		<Group gap="sm" align="flex-start" justify="space-between">
			<Group gap="sm" align="flex-start" style={{ flex: 1 }}>
				<Box
					w={30}
					h={30}
					style={{
						flexShrink: 0,
						display: "grid",
						borderRadius: "50%",
						placeItems: "center",
						backgroundColor: `color-mix(in srgb, ${props.accentColor} 15%, transparent)`,
					}}
				>
					<Icon size={14} color={props.accentColor} />
				</Box>
				<Link
					to="/$trackerSlug/$entityId"
					params={{ entityId: props.entityId, trackerSlug: props.trackerSlug }}
				>
					<Anchor component="span" size="sm" pt={5}>
						{props.action}
					</Anchor>
				</Link>
			</Group>
			<Text size="xs" c="dimmed" pt={7} style={{ flexShrink: 0 }}>
				{props.time}
			</Text>
		</Group>
	);
}

export function TrackerOverviewQuickActions(props: {
	isDark: boolean;
	accentColor: string;
	canLogEvent: boolean;
	onLogEvent: () => void;
	onAddSchema: () => void;
	eventActionLabel: string;
	canCreateEntity: boolean;
	entityActionLabel: string;
	onCreateEntity: () => void;
}) {
	const { surface } = getTrackerOverviewTokens(props.isDark);
	const accentBg = `color-mix(in srgb, ${props.accentColor} 12%, transparent)`;

	return (
		<Paper p="md" withBorder radius="md" bg={surface}>
			<Stack gap="sm">
				<Text
					fw={600}
					size="xs"
					c="dimmed"
					tt="uppercase"
					style={{ letterSpacing: "0.8px" }}
				>
					Quick Actions
				</Text>
				<Stack gap="xs">
					<Button
						fullWidth
						size="sm"
						variant="light"
						onClick={props.onCreateEntity}
						disabled={!props.canCreateEntity}
						leftSection={<Plus size={14} />}
						styles={{
							root: { color: props.accentColor, backgroundColor: accentBg },
						}}
					>
						{props.entityActionLabel}
					</Button>
					<Button
						fullWidth
						size="sm"
						variant="light"
						onClick={props.onLogEvent}
						disabled={!props.canLogEvent}
						leftSection={<NotebookPen size={14} />}
						styles={{
							root: { color: props.accentColor, backgroundColor: accentBg },
						}}
					>
						{props.eventActionLabel}
					</Button>
					<Button
						fullWidth
						size="sm"
						c="dark.3"
						variant="subtle"
						onClick={props.onAddSchema}
						leftSection={<Shapes size={14} />}
					>
						New Schema
					</Button>
				</Stack>
			</Stack>
		</Paper>
	);
}

export function TrackerOverviewSavedViews(props: {
	isDark: boolean;
	textLink: string;
	views: AppSavedView[];
}) {
	const { surface } = getTrackerOverviewTokens(props.isDark);

	return (
		<Paper p="md" withBorder radius="md" bg={surface}>
			<Stack gap="sm">
				<Text
					fw={600}
					size="xs"
					c="dimmed"
					tt="uppercase"
					style={{ letterSpacing: "0.8px" }}
				>
					Saved Views
				</Text>
				{props.views.length === 0 ? (
					<Text c="dimmed" size="sm">
						Saved views will appear here once schemas are created.
					</Text>
				) : (
					<Stack gap={4}>
						{props.views.map((view) => (
							<Link
								key={view.id}
								to="/views/$viewId"
								params={{ viewId: view.id }}
								style={{
									color: props.textLink,
									fontSize: "var(--mantine-font-size-sm)",
								}}
							>
								{view.name}
							</Link>
						))}
					</Stack>
				)}
			</Stack>
		</Paper>
	);
}

export function TrackerOverviewEmptyPanel(props: {
	title: string;
	isDark: boolean;
	description: string;
}) {
	const { surface } = getTrackerOverviewTokens(props.isDark);

	return (
		<Paper p="md" withBorder radius="md" bg={surface}>
			<Stack gap={4}>
				<Text fw={500}>{props.title}</Text>
				<Text c="dimmed" size="sm">
					{props.description}
				</Text>
			</Stack>
		</Paper>
	);
}
