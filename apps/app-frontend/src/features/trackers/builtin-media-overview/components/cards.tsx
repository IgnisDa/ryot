import {
	ActionIcon,
	Badge,
	Box,
	Button,
	Group,
	Paper,
	Progress,
	Stack,
	Text,
	Tooltip,
	UnstyledButton,
} from "@mantine/core";
import { useDebouncedCallback } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { dayjs } from "@ryot/ts-utils";
import { Play, Star } from "lucide-react";
import { useState } from "react";
import { createReviewEventPayload } from "~/features/entities/search-modal-media-actions";
import type { AppEntitySchema } from "~/features/entity-schemas/model";
import { useEventSchemasQuery } from "~/features/event-schemas/hooks";
import { useApiClient } from "~/hooks/api";
import {
	colorMix,
	GOLD,
	getLastActivityLabel,
	getQueueNote,
	type OverviewContinueItem,
	type OverviewRateTheseItem,
	type OverviewUpNextItem,
	STONE,
} from "../shared";
import { Artwork } from "./artwork";

interface ContinueCardProps {
	border: string;
	surface: string;
	textMuted: string;
	textPrimary: string;
	surfaceHover: string;
	onContinue: () => void;
	item: OverviewContinueItem;
	imageUrl: string | undefined;
	schemaBySlug: Map<string, AppEntitySchema>;
}

export function ContinueCard(props: ContinueCardProps) {
	const schema = props.schemaBySlug.get(props.item.entitySchemaSlug);
	const icon = schema?.icon ?? "circle";
	const color = schema?.accentColor ?? STONE;
	const progressLabel = props.item.labels.progress;
	const pct = props.item.progress.progressPercent ?? null;
	const lastActivity = getLastActivityLabel(
		dayjs(props.item.progressAt).toDate(),
	);

	return (
		<Paper
			radius="sm"
			style={{
				overflow: "hidden",
				border: `1px solid ${props.border}`,
				boxShadow: `0 10px 24px ${colorMix(color, 0.08)}`,
				background: `linear-gradient(180deg, ${colorMix(color, 0.08)} 0%, ${props.surface} 34%, ${props.surface} 100%)`,
			}}
			styles={{
				root: {
					transition: "all 0.18s ease",
					"&:hover": {
						transform: "translateY(-2px)",
						background: `linear-gradient(180deg, ${colorMix(color, 0.1)} 0%, ${props.surfaceHover} 30%, ${props.surfaceHover} 100%)`,
					},
				},
			}}
		>
			<Group gap={0} align="stretch" wrap="nowrap">
				<Artwork
					width={84}
					radius={0}
					icon={icon}
					color={color}
					url={props.imageUrl}
					title={props.item.title}
					note={pct !== null ? `${pct}% done` : undefined}
				/>
				<Stack gap={8} p="sm" style={{ flex: 1, minWidth: 0 }}>
					<Group gap={6} wrap="nowrap">
						<Badge
							size="xs"
							variant="light"
							style={{ color, backgroundColor: colorMix(color, 0.12) }}
						>
							{schema?.name ?? "Item"}
						</Badge>
						<Text
							fz={10}
							tt="uppercase"
							c={props.textMuted}
							style={{ letterSpacing: "0.8px" }}
							ff="var(--mantine-headings-font-family)"
						>
							Resume
						</Text>
						<Box style={{ flex: 1 }} />
						<Text fz={10} c={props.textMuted}>
							{lastActivity}
						</Text>
					</Group>

					<Text
						fz="sm"
						fw={600}
						lh={1.3}
						lineClamp={1}
						c={props.textPrimary}
						ff="var(--mantine-headings-font-family)"
					>
						{props.item.title}
					</Text>
					<Text fz="xs" c={props.textMuted} lineClamp={1}>
						{props.item.subtitle.label}
					</Text>

					<Box mt={2}>
						<Group gap={6} mb={4}>
							<Text
								fz={10}
								c={props.textMuted}
								ff="var(--mantine-font-family-monospace)"
							>
								{progressLabel}
							</Text>
							{pct !== null ? (
								<Text
									fz={10}
									fw={600}
									c={color}
									ff="var(--mantine-font-family-monospace)"
								>
									{pct}%
								</Text>
							) : null}
						</Group>
						{pct !== null ? (
							<Progress
								size={5}
								value={pct}
								radius="xl"
								color={color}
								bg={props.border}
							/>
						) : null}
					</Box>

					<Button
						mt={4}
						variant="light"
						size="compact-xs"
						onClick={props.onContinue}
						leftSection={<Play size={10} />}
						style={{
							color,
							border: "none",
							alignSelf: "flex-start",
							backgroundColor: colorMix(color, 0.12),
						}}
					>
						{props.item.labels.cta}
					</Button>
				</Stack>
			</Group>
		</Paper>
	);
}

interface BacklogCardProps {
	rank: number;
	border: string;
	surface: string;
	textMuted: string;
	onStart: () => void;
	textPrimary: string;
	surfaceHover: string;
	item: OverviewUpNextItem;
	imageUrl: string | undefined;
	schemaBySlug: Map<string, AppEntitySchema>;
}

export function BacklogCard(props: BacklogCardProps) {
	const schema = props.schemaBySlug.get(props.item.entitySchemaSlug);
	const color = schema?.accentColor ?? STONE;
	const icon = schema?.icon ?? "circle";
	const backlogAt = dayjs(props.item.backlogAt);
	const note = getQueueNote(props.item.entitySchemaSlug, backlogAt, props.rank);

	return (
		<UnstyledButton style={{ flexShrink: 0 }} onClick={props.onStart}>
			<Paper
				w={164}
				radius="sm"
				style={{
					overflow: "hidden",
					border: `1px solid ${props.border}`,
					boxShadow: `0 10px 26px ${colorMix(color, 0.08)}`,
					background: `linear-gradient(180deg, ${colorMix(color, 0.08)} 0%, ${props.surface} 26%, ${props.surface} 100%)`,
				}}
				styles={{
					root: {
						transition: "all 0.18s ease",
						"&:hover": {
							transform: "translateY(-2px)",
							background: `linear-gradient(180deg, ${colorMix(color, 0.1)} 0%, ${props.surfaceHover} 24%, ${props.surfaceHover} 100%)`,
						},
					},
				}}
			>
				<Box p={8} pb={0} style={{ position: "relative" }}>
					<Artwork
						icon={icon}
						height={220}
						color={color}
						note={schema?.name}
						url={props.imageUrl}
						title={props.item.title}
					/>
					<Badge
						size="xs"
						variant="light"
						style={{
							color,
							top: 14,
							left: 14,
							position: "absolute",
							backgroundColor: colorMix(color, 0.12),
						}}
					>
						{schema?.name ?? "Item"}
					</Badge>
				</Box>
				<Stack gap={4} p="sm" pt="xs">
					<Text
						fz={10}
						fw={700}
						c={color}
						tt="uppercase"
						style={{ letterSpacing: "0.9px" }}
						ff="var(--mantine-headings-font-family)"
					>
						{note}
					</Text>
					<Text
						fz="sm"
						fw={600}
						lh={1.3}
						lineClamp={2}
						c={props.textPrimary}
						ff="var(--mantine-headings-font-family)"
					>
						{props.item.title}
					</Text>
					<Text fz={10} c={props.textMuted} lineClamp={1}>
						{props.item.subtitle.label}
					</Text>
					<Text fz={10} c={props.textMuted}>
						Added {getLastActivityLabel(backlogAt.toDate())}
					</Text>
				</Stack>
			</Paper>
		</UnstyledButton>
	);
}

interface RateCardProps {
	border: string;
	surface: string;
	textMuted: string;
	textPrimary: string;
	onRated: () => void;
	surfaceHover: string;
	item: OverviewRateTheseItem;
	imageUrl: string | undefined;
	schemaBySlug: Map<string, AppEntitySchema>;
}

export function RateCard(props: RateCardProps) {
	const [hovered, setHovered] = useState(0);
	const [selected, setSelected] = useState(0);
	const apiClient = useApiClient();
	const createEvents = apiClient.useMutation("post", "/events");
	const schema = props.schemaBySlug.get(props.item.entitySchemaSlug);
	const entitySchemaId = schema?.id ?? "";
	const eventSchemasQuery = useEventSchemasQuery(
		entitySchemaId,
		!!entitySchemaId,
	);
	const color = schema?.accentColor ?? STONE;
	const icon = schema?.icon ?? "circle";
	const completedDate = getLastActivityLabel(
		dayjs(props.item.completedAt).toDate(),
	);

	const saveRating = useDebouncedCallback(async (stars: number) => {
		try {
			await createEvents.mutateAsync({
				body: createReviewEventPayload({
					rating: stars,
					entityId: props.item.id,
					eventSchemas: eventSchemasQuery.eventSchemas,
				}),
			});
			props.onRated();
		} catch {
			notifications.show({
				color: "red",
				title: "Could not save rating",
				message: `Failed to rate "${props.item.title}". Please try again.`,
			});
		}
	}, 1000);

	return (
		<Paper
			radius="sm"
			style={{
				overflow: "hidden",
				border: `1px solid ${props.border}`,
				boxShadow: `0 10px 26px ${colorMix(GOLD, 0.08)}`,
				background: `linear-gradient(180deg, ${colorMix(GOLD, 0.09)} 0%, ${props.surface} 34%, ${props.surface} 100%)`,
			}}
			styles={{
				root: {
					transition: "all 0.18s ease",
					"&:hover": {
						transform: "translateY(-2px)",
						background: `linear-gradient(180deg, ${colorMix(GOLD, 0.11)} 0%, ${props.surfaceHover} 34%, ${props.surfaceHover} 100%)`,
					},
				},
			}}
		>
			<Box h={3} bg={GOLD} />
			<Group gap="sm" wrap="nowrap" p="sm">
				<Artwork
					width={64}
					radius={8}
					height={86}
					icon={icon}
					color={color}
					url={props.imageUrl}
					title={props.item.title}
				/>
				<Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
					<Group gap={6}>
						<Badge
							size="xs"
							variant="light"
							style={{ backgroundColor: colorMix(color, 0.12), color }}
						>
							{schema?.name ?? "Item"}
						</Badge>
						<Text fz={10} c={props.textMuted}>
							{completedDate}
						</Text>
					</Group>
					<Text
						fz="sm"
						fw={600}
						lineClamp={1}
						c={props.textPrimary}
						ff="var(--mantine-headings-font-family)"
					>
						{props.item.title}
					</Text>
					<Text fz="xs" c={props.textMuted}>
						{props.item.subtitle.label}
					</Text>
					<Group
						mt={2}
						px={6}
						py={5}
						gap={4}
						style={{
							borderRadius: 999,
							alignSelf: "flex-start",
							backgroundColor: colorMix(GOLD, 0.08),
						}}
					>
						{[1, 2, 3, 4, 5].map((star) => (
							<Tooltip key={star} label={`${star} star${star > 1 ? "s" : ""}`}>
								<ActionIcon
									size="sm"
									variant="transparent"
									disabled={createEvents.isPending}
									onMouseLeave={() => setHovered(0)}
									onMouseEnter={() => setHovered(star)}
									onClick={() => {
										setSelected(star);
										void saveRating(star);
									}}
								>
									<Star
										size={18}
										color={GOLD}
										fill={star <= (hovered || selected) ? GOLD : "transparent"}
									/>
								</ActionIcon>
							</Tooltip>
						))}
						{selected > 0 && (
							<Text
								ml={2}
								fz={10}
								fw={600}
								c={GOLD}
								ff="var(--mantine-font-family-monospace)"
							>
								{selected}/5
							</Text>
						)}
					</Group>
				</Stack>
			</Group>
		</Paper>
	);
}
