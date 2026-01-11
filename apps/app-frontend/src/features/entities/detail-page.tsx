import {
	Badge,
	Box,
	Button,
	Center,
	Code,
	Grid,
	Group,
	Loader,
	Paper,
	Stack,
	Text,
	Title,
} from "@mantine/core";
import { Calendar, ExternalLink, Hash } from "lucide-react";
import type { AppEntity } from "~/features/entities/model";
import { useEventsQuery } from "~/features/events/hooks";
import type { EntityDetailProperty } from "./detail";
import { useResolvedEntityImageUrl } from "./image";

function formatShortDate(date: Date) {
	return date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

export function EntityDetailIdentityHeader(props: {
	border: string;
	entity: AppEntity;
	schemaName: string;
	entitySchemaColor: { base: string; muted: string };
}) {
	const imageQuery = useResolvedEntityImageUrl(props.entity);
	const hasImage = !!imageQuery.imageUrl;
	const isLoadingImage =
		props.entity.image?.kind === "s3" &&
		imageQuery.isLoading &&
		!imageQuery.imageUrl;

	return (
		<Box mb="xl">
			<Grid mt="lg">
				<Grid.Col span={{ base: 12, md: 8 }}>
					<Stack gap="md">
						<Badge
							size="md"
							variant="outline"
							styles={{
								root: {
									fontWeight: 500,
									fontFamily: "var(--mantine-headings-font-family)",
								},
							}}
						>
							{props.schemaName}
						</Badge>

						<Title
							fw={600}
							order={1}
							ff="var(--mantine-headings-font-family)"
							style={{
								lineHeight: 1.2,
								fontSize: "clamp(1.75rem, 4vw, 2.5rem)",
							}}
						>
							{props.entity.name}
						</Title>

						<Group gap="lg" wrap="wrap">
							<Group gap={6}>
								<Calendar size={16} strokeWidth={2} />
								<Text size="sm" c="dimmed">
									Created {formatShortDate(props.entity.createdAt)}
								</Text>
							</Group>
							{props.entity.externalId ? (
								<Group gap={6}>
									<ExternalLink size={16} strokeWidth={2} />
									<Text
										size="sm"
										c="dimmed"
										ff="var(--mantine-font-family-monospace)"
									>
										{props.entity.externalId}
									</Text>
								</Group>
							) : null}
						</Group>
					</Stack>
				</Grid.Col>

				<Grid.Col span={{ base: 12, md: 4 }}>
					{hasImage ? (
						<Box
							style={{
								overflow: "hidden",
								aspectRatio: "3 / 4",
								border: `1px solid ${props.border}`,
								borderRadius: "var(--mantine-radius-sm)",
							}}
						>
							<Box
								style={{
									width: "100%",
									height: "100%",
									backgroundSize: "cover",
									backgroundPosition: "center",
									backgroundImage: `url(${imageQuery.imageUrl})`,
								}}
							/>
						</Box>
					) : (
						<Paper
							p="xl"
							radius="sm"
							withBorder
							style={{
								display: "grid",
								placeItems: "center",
								aspectRatio: "3 / 4",
								borderColor: props.entitySchemaColor.base,
								backgroundColor: props.entitySchemaColor.muted,
							}}
						>
							{isLoadingImage ? (
								<Loader size="sm" color="accent" />
							) : (
								<Text c="dimmed" size="sm" fw={500} ta="center">
									No image available
								</Text>
							)}
						</Paper>
					)}
				</Grid.Col>
			</Grid>
		</Box>
	);
}

export function EntityDetailPropertiesSection(props: {
	border: string;
	properties: EntityDetailProperty[];
}) {
	if (props.properties.length === 0) {
		return (
			<Paper p="lg" withBorder radius="sm">
				<Stack gap="xs">
					<Text fw={600} size="sm">
						No properties defined
					</Text>
					<Text c="dimmed" size="sm">
						This entity schema has no properties configured yet.
					</Text>
				</Stack>
			</Paper>
		);
	}

	return (
		<Paper p="lg" withBorder radius="sm">
			<Stack gap="md">
				<Box pb="sm" style={{ borderBottom: `1px solid ${props.border}` }}>
					<Text fw={600} ff="var(--mantine-headings-font-family)" size="md">
						Properties
					</Text>
					<Text c="dimmed" size="sm">
						Schema-defined values for this entity
					</Text>
				</Box>

				<Grid>
					{props.properties.map((property) => (
						<Grid.Col key={property.key} span={{ base: 12, sm: 6 }}>
							<Stack gap={4}>
								<Text
									fw={600}
									size="xs"
									c="dimmed"
									tt="uppercase"
									style={{ letterSpacing: "0.5px" }}
									ff="var(--mantine-headings-font-family)"
								>
									{property.label}
								</Text>
								<Text
									size="sm"
									style={{
										wordBreak: "break-word",
										fontFamily:
											property.type === "number" || property.type === "integer"
												? "var(--mantine-font-family-monospace)"
												: undefined,
									}}
								>
									{property.value}
								</Text>
							</Stack>
						</Grid.Col>
					))}
				</Grid>
			</Stack>
		</Paper>
	);
}

export function EntityDetailEventTimeline(props: {
	border: string;
	entity: AppEntity;
	surfaceHover: string;
	onLogEvent: () => void;
	entitySchemaColor: { base: string; muted: string };
}) {
	const eventsQuery = useEventsQuery(props.entity.id);
	const events = eventsQuery.events;

	if (eventsQuery.isLoading) {
		return (
			<Paper p="lg" withBorder radius="sm">
				<Center py="xl">
					<Loader size="md" />
				</Center>
			</Paper>
		);
	}

	if (eventsQuery.isError) {
		return (
			<Paper p="lg" withBorder radius="sm">
				<Stack gap="md">
					<Text c="red" size="sm">
						Failed to load activity timeline.
					</Text>
					<Button
						size="xs"
						variant="light"
						onClick={() => eventsQuery.refetch()}
					>
						Retry
					</Button>
				</Stack>
			</Paper>
		);
	}

	return (
		<Paper p="lg" withBorder radius="sm">
			<Stack gap="md">
				<Group justify="space-between" align="flex-start">
					<Box>
						<Text fw={600} ff="var(--mantine-headings-font-family)" size="md">
							Activity Timeline
						</Text>
						<Text c="dimmed" size="sm">
							{events.length}{" "}
							{events.length === 1 ? "event logged" : "events logged"}
						</Text>
					</Box>
					<Button size="xs" variant="light" onClick={props.onLogEvent}>
						Log Event
					</Button>
				</Group>

				{events.length === 0 ? (
					<Paper p="xl" withBorder radius="sm">
						<Stack gap="xs" align="center">
							<Text fw={600} size="sm">
								No events yet
							</Text>
							<Text c="dimmed" size="sm" ta="center">
								Start tracking by logging your first event for this entity.
							</Text>
							<Button
								mt="sm"
								size="sm"
								color="accent"
								variant="light"
								onClick={props.onLogEvent}
							>
								Log First Event
							</Button>
						</Stack>
					</Paper>
				) : (
					<Stack gap={0}>
						{events.map((event, idx) => (
							<Box
								p="md"
								key={event.id}
								onMouseLeave={(eventTarget) => {
									eventTarget.currentTarget.style.backgroundColor = "";
								}}
								onMouseEnter={(eventTarget) => {
									eventTarget.currentTarget.style.backgroundColor =
										props.surfaceHover;
								}}
								style={{
									transition: "background-color 0.15s ease",
									borderLeft: `3px solid ${props.entitySchemaColor.base}`,
									borderBottom:
										idx < events.length - 1
											? `1px solid ${props.border}`
											: "none",
								}}
							>
								<Stack gap={6}>
									<Group
										wrap="nowrap"
										align="flex-start"
										justify="space-between"
									>
										<Text
											fw={600}
											size="sm"
											ff="var(--mantine-headings-font-family)"
										>
											{event.eventSchemaName}
										</Text>
										<Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
											{formatShortDate(event.createdAt)}
										</Text>
									</Group>

									{Object.keys(event.properties).length > 0 ? (
										<Code block style={{ fontSize: "0.75rem" }}>
											{Object.entries(event.properties)
												.map(([key, value]) => {
													if (typeof value === "boolean") {
														return `${key}: ${value ? "Yes" : "No"}`;
													}
													if (typeof value === "number") {
														return `${key}: ${value}`;
													}
													if (typeof value === "string") {
														return `${key}: ${value}`;
													}
													return null;
												})
												.filter((value): value is string => value !== null)
												.join("\n")}
										</Code>
									) : null}
								</Stack>
							</Box>
						))}
					</Stack>
				)}
			</Stack>
		</Paper>
	);
}

export function EntityDetailSidebar(props: {
	entity: AppEntity;
	schemaName: string;
	eventCount: number;
	onLogEvent: () => void;
}) {
	return (
		<Stack gap="md">
			<Paper p="md" withBorder radius="sm">
				<Stack gap="md">
					<Text fw={600} ff="var(--mantine-headings-font-family)" size="sm">
						Quick Facts
					</Text>

					<Stack gap="sm">
						<Group gap="xs">
							<Hash size={14} strokeWidth={2} />
							<Text size="xs" c="dimmed">
								Entity ID
							</Text>
						</Group>
						<Text
							size="xs"
							style={{ wordBreak: "break-all" }}
							ff="var(--mantine-font-family-monospace)"
						>
							{props.entity.id}
						</Text>
					</Stack>

					<Box
						h={1}
						style={{ backgroundColor: "var(--mantine-color-default-border)" }}
					/>

					<Stack gap="xs">
						<Text size="xs" c="dimmed">
							Schema
						</Text>
						<Text size="sm" fw={500}>
							{props.schemaName}
						</Text>
					</Stack>

					<Stack gap="xs">
						<Text size="xs" c="dimmed">
							Events Logged
						</Text>
						<Text fw={600} ff="var(--mantine-headings-font-family)" size="lg">
							{props.eventCount}
						</Text>
					</Stack>

					<Stack gap="xs">
						<Text size="xs" c="dimmed">
							Last Updated
						</Text>
						<Text size="sm">{formatShortDate(props.entity.updatedAt)}</Text>
					</Stack>
				</Stack>
			</Paper>

			<Button
				fullWidth
				color="accent"
				variant="light"
				onClick={props.onLogEvent}
			>
				Log Event
			</Button>
		</Stack>
	);
}
