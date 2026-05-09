import { Badge, Box, Group, Paper, Stack, Text, Tooltip } from "@mantine/core";
import { Link } from "@tanstack/react-router";

import { colorMix, GOLD, STONE, type WeekDayView } from "../shared";
import { Artwork } from "./artwork";

interface WeekStripProps {
	border: string;
	textMuted: string;
	days: WeekDayView[];
	accentColor: string;
	textPrimary: string;
	weekTotalEvents: number;
}

export function WeekStrip(props: WeekStripProps) {
	const maxCount = Math.max(...props.days.map((d) => d.count), 1);
	const activeDays = props.days.filter((day) => day.count > 0).length;

	return (
		<Stack gap="md">
			<Group justify="space-between" align="flex-start" gap="sm">
				<Stack gap={4}>
					<Text
						fz={10}
						fw={700}
						tt="uppercase"
						c={props.accentColor}
						style={{ letterSpacing: "1px" }}
						ff="var(--mantine-headings-font-family)"
					>
						Weekly rhythm
					</Text>
					<Text fz="sm" fw={600} c={props.textPrimary} ff="var(--mantine-headings-font-family)">
						You showed up {activeDays} of 7 days.
					</Text>
				</Stack>
				<Text fz="xs" c={props.textMuted}>
					{props.weekTotalEvents} events this week
				</Text>
			</Group>
			<Group gap="xs" justify="space-between">
				{props.days.map((day) => {
					const h = day.count > 0 ? 10 + (day.count / maxCount) * 28 : 6;
					return (
						<Stack key={day.day} gap={4} align="center" style={{ flex: 1 }}>
							<Tooltip label={`${day.count} event${day.count !== 1 ? "s" : ""}`}>
								<Box
									h={h}
									w="100%"
									style={{
										borderRadius: 999,
										transition: "height 0.2s ease",
										backgroundColor: day.count > 0 ? props.accentColor : `${props.border}`,
										opacity: day.count > 0 ? 0.4 + (day.count / maxCount) * 0.6 : 1,
									}}
								/>
							</Tooltip>
							<Text fz={10} c={props.textMuted} ta="center">
								{day.day}
							</Text>
						</Stack>
					);
				})}
			</Group>
		</Stack>
	);
}

interface EventRowProps {
	border: string;
	isLast: boolean;
	textMuted: string;
	textPrimary: string;
	schemaBySlug: Map<string, { accentColor?: string; icon?: string; name?: string }>;
	event: {
		id: string;
		sub?: string;
		date: string;
		time: string;
		title: string;
		action: string;
		entityId: string;
		imageUrl?: string;
		rating: number | null;
		entitySchemaSlug: string;
	};
}

export function EventRow(props: EventRowProps) {
	const schema = props.schemaBySlug.get(props.event.entitySchemaSlug);
	const color = schema?.accentColor ?? STONE;

	return (
		<Group
			py={10}
			gap="sm"
			wrap="nowrap"
			align="flex-start"
			style={{
				paddingLeft: 12,
				borderLeft: `3px solid ${color}`,
				borderBottom: props.isLast ? "none" : `1px solid ${props.border}`,
			}}
		>
			<Artwork
				width={36}
				radius={6}
				height={48}
				color={color}
				title={props.event.title}
				url={props.event.imageUrl}
				icon={schema?.icon ?? "circle"}
			/>
			<Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
				<Link
					className="title-link"
					to="/entities/$entityId"
					params={{ entityId: props.event.entityId }}
				>
					<Text
						fz="sm"
						fw={600}
						lineClamp={1}
						c={props.textPrimary}
						ff="var(--mantine-headings-font-family)"
					>
						{props.event.title}
					</Text>
				</Link>
				<Group gap={6} wrap="wrap">
					<Badge
						size="xs"
						variant="light"
						style={{ backgroundColor: colorMix(color, 0.12), color }}
					>
						{schema?.name ?? "Item"}
					</Badge>
					<Text fz={10} fw={600} c={color}>
						{props.event.action}
					</Text>
					{props.event.sub ? (
						<Text fz={10} c={props.textMuted}>
							&middot; {props.event.sub}
						</Text>
					) : null}
					{props.event.rating !== null && (
						<Text fz={10} ff="var(--mantine-font-family-monospace)" c={GOLD}>
							{"★".repeat(props.event.rating)}
						</Text>
					)}
				</Group>
			</Stack>
			<Text fz={10} c={props.textMuted} style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
				{props.event.time}
			</Text>
		</Group>
	);
}

interface TypeBarProps {
	total: number;
	border: string;
	textMuted: string;
	types: { slug: string; count: number; color: string }[];
}

export function TypeBar(props: TypeBarProps) {
	if (props.total === 0) {
		return (
			<Text fz="sm" c={props.textMuted}>
				No activity recorded yet.
			</Text>
		);
	}
	return (
		<Stack gap={6}>
			<Box h={8} style={{ display: "flex", borderRadius: 4, overflow: "hidden" }}>
				{props.types.map((t) => {
					const pct = (t.count / props.total) * 100;
					return (
						<Tooltip key={t.slug} label={`${t.slug}: ${t.count}`}>
							<Box
								h="100%"
								style={{
									minWidth: 3,
									width: `${pct}%`,
									backgroundColor: t.color,
								}}
							/>
						</Tooltip>
					);
				})}
			</Box>
			<Group gap="sm" wrap="wrap">
				{props.types.slice(0, 6).map((t) => (
					<Group key={t.slug} gap={4}>
						<Box w={8} h={8} style={{ borderRadius: 2, backgroundColor: t.color }} />
						<Text fz={10} c={props.textMuted} tt="capitalize">
							{t.slug} ({t.count})
						</Text>
					</Group>
				))}
				{props.types.length > 6 && (
					<Text fz={10} c={props.textMuted}>
						+{props.types.length - 6} more
					</Text>
				)}
			</Group>
		</Stack>
	);
}

interface StatChipProps {
	label: string;
	color?: string;
	border: string;
	surface: string;
	textMuted: string;
	textPrimary: string;
	value: string | number;
}

export function StatChip(props: StatChipProps) {
	return (
		<Paper
			px="md"
			py="sm"
			radius="sm"
			style={{
				border: `1px solid ${props.border}`,
				borderTop: `3px solid ${props.color ?? STONE}`,
				background: `linear-gradient(180deg, ${colorMix(props.color ?? STONE, 0.08)} 0%, ${props.surface} 100%)`,
			}}
		>
			<Text
				fz={10}
				fw={700}
				tt="uppercase"
				c={props.textMuted}
				style={{ letterSpacing: "0.9px" }}
				ff="var(--mantine-headings-font-family)"
			>
				{props.label}
			</Text>
			<Text
				mt={6}
				fz="xl"
				fw={700}
				lh={1.2}
				c={props.color ?? props.textPrimary}
				ff="var(--mantine-font-family-monospace)"
			>
				{props.value}
			</Text>
			<Text fz={10} c={props.textMuted} fw={500} mt={2}>
				In your library
			</Text>
		</Paper>
	);
}
