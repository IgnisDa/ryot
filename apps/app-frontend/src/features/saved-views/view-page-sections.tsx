import {
	Badge,
	Box,
	Card,
	Group,
	Paper,
	SimpleGrid,
	Stack,
	Text,
} from "@mantine/core";
import { Image as ImageIcon } from "lucide-react";
import { DataTable, type DataTableColumn } from "mantine-datatable";
import type { AppEntity } from "#/features/entities/model";
import type { ViewLayout, ViewRuntimeResponse } from "./view-page-utils";
import { formatRuntimeValue, isRuntimeProperty } from "./view-page-utils";

function EntityThumbnail(props: {
	label?: string;
	height: number;
	isDark: boolean;
	radius?: string;
	iconSize?: number;
	imageUrl?: string;
	width: number | string;
}) {
	const surfaceHover = props.isDark
		? "var(--mantine-color-dark-7)"
		: "var(--mantine-color-stone-1)";
	const textMuted = props.isDark
		? "var(--mantine-color-dark-4)"
		: "var(--mantine-color-stone-5)";

	if (props.imageUrl) {
		return (
			<Box
				h={props.height}
				w={props.width}
				style={{
					flexShrink: 0,
					backgroundSize: "cover",
					backgroundPosition: "center",
					backgroundImage: `url(${props.imageUrl})`,
					borderRadius: props.radius ?? "var(--mantine-radius-sm)",
				}}
			/>
		);
	}

	return (
		<Box
			w={props.width}
			h={props.height}
			bg={surfaceHover}
			style={{
				flexShrink: 0,
				display: "grid",
				overflow: "hidden",
				placeItems: "center",
				borderRadius: props.radius ?? "var(--mantine-radius-sm)",
			}}
		>
			{props.label ? (
				<Text size="xs" c={textMuted} ta="center" px="xs" lineClamp={3}>
					{props.label}
				</Text>
			) : (
				<ImageIcon
					color={textMuted}
					strokeWidth={1.5}
					size={props.iconSize ?? 24}
				/>
			)}
		</Box>
	);
}

export function SavedViewResults(props: {
	isDark: boolean;
	items: AppEntity[];
	layout: ViewLayout;
	accentColor: string;
	accentMuted: string;
	textPrimary: string;
	textSecondary: string;
	meta: ViewRuntimeResponse["meta"];
	imageUrlById: Map<string, string | undefined>;
}) {
	if (props.layout === "grid") {
		return (
			<SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="md">
				{props.items.map((item) => {
					const title = item.resolvedProperties?.titleProperty;
					const subtitle = item.resolvedProperties?.subtitleProperty;
					const badge = item.resolvedProperties?.badgeProperty;
					const image = item.resolvedProperties?.imageProperty;
					return (
						<Card
							p={0}
							radius="sm"
							key={item.id}
							style={{ overflow: "hidden" }}
						>
							<EntityThumbnail
								height={220}
								width="100%"
								iconSize={48}
								isDark={props.isDark}
								imageUrl={props.imageUrlById.get(item.id)}
								label={
									isRuntimeProperty(image) && image.kind !== "image"
										? formatRuntimeValue(image.value)
										: undefined
								}
							/>
							<Stack gap="xs" p="lg">
								<Text
									fw={600}
									size="md"
									lineClamp={2}
									c={props.textPrimary}
									ff="var(--mantine-headings-font-family)"
								>
									{isRuntimeProperty(title)
										? formatRuntimeValue(title.value)
										: item.name}
								</Text>
								{isRuntimeProperty(subtitle) && subtitle.kind !== "null" ? (
									<Text size="sm" c={props.textSecondary} lineClamp={2}>
										{formatRuntimeValue(subtitle.value)}
									</Text>
								) : null}
								<Group justify="space-between" align="center">
									<Badge
										variant="light"
										c={props.accentColor}
										bg={props.accentMuted}
									>
										{item.entitySchemaSlug ?? "Entity"}
									</Badge>
									{isRuntimeProperty(badge) && badge.kind !== "null" ? (
										<Badge variant="filled" bg={props.accentColor} c="white">
											{formatRuntimeValue(badge.value)}
										</Badge>
									) : null}
								</Group>
							</Stack>
						</Card>
					);
				})}
			</SimpleGrid>
		);
	}

	if (props.layout === "list") {
		return (
			<Stack gap="sm">
				{props.items.map((item) => {
					const title = item.resolvedProperties?.titleProperty;
					const badge = item.resolvedProperties?.badgeProperty;
					const image = item.resolvedProperties?.imageProperty;
					const subtitle = item.resolvedProperties?.subtitleProperty;
					return (
						<Paper key={item.id} p="md" withBorder radius="sm">
							<Group justify="space-between" align="flex-start" wrap="nowrap">
								<Group gap="md" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
									<EntityThumbnail
										width={60}
										height={84}
										iconSize={20}
										isDark={props.isDark}
										imageUrl={props.imageUrlById.get(item.id)}
										label={
											isRuntimeProperty(image) && image.kind !== "image"
												? formatRuntimeValue(image.value)
												: undefined
										}
									/>
									<Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
										<Text
											fw={600}
											size="md"
											c={props.textPrimary}
											ff="var(--mantine-headings-font-family)"
										>
											{isRuntimeProperty(title)
												? formatRuntimeValue(title.value)
												: item.name}
										</Text>
										{isRuntimeProperty(subtitle) && subtitle.kind !== "null" ? (
											<Text size="sm" c={props.textSecondary}>
												{formatRuntimeValue(subtitle.value)}
											</Text>
										) : null}
										<Text size="xs" c="dimmed">
											{item.entitySchemaSlug}
										</Text>
									</Stack>
								</Group>
								{isRuntimeProperty(badge) && badge.kind !== "null" ? (
									<Badge
										c="white"
										size="lg"
										variant="filled"
										bg={props.accentColor}
									>
										{formatRuntimeValue(badge.value)}
									</Badge>
								) : null}
							</Group>
						</Paper>
					);
				})}
			</Stack>
		);
	}

	const tableColumns = "table" in props.meta ? props.meta.table.columns : [];
	const dataColumns: DataTableColumn<AppEntity>[] = tableColumns.map(
		(column) => ({
			title: column.label,
			accessor: column.key,
			titleStyle: {
				fontSize: "12px",
				fontWeight: 600,
				letterSpacing: "0.5px",
				color: props.accentColor,
				textTransform: "uppercase",
				fontFamily: "var(--mantine-headings-font-family)",
			},
			render: (item) => {
				const cell = item.cells?.find((entry) => entry.key === column.key);

				if (cell?.kind === "image") {
					return (
						<EntityThumbnail
							width={40}
							height={54}
							iconSize={16}
							isDark={props.isDark}
							radius="var(--mantine-radius-xs)"
							imageUrl={props.imageUrlById.get(`${item.id}:${cell.key}`)}
						/>
					);
				}

				return (
					<Text size="sm" c={props.textSecondary}>
						{formatRuntimeValue(cell?.value)}
					</Text>
				);
			},
		}),
	);

	return (
		<DataTable
			striped
			withTableBorder
			highlightOnHover
			borderRadius="sm"
			c={props.textPrimary}
			records={props.items}
			columns={dataColumns}
			borderColor={props.accentMuted}
			rowBorderColor={props.accentMuted}
			stripedColor={props.isDark ? "var(--mantine-color-dark-7)" : "white"}
			emptyState={
				<Text size="sm" c={props.textSecondary}>
					No rows available
				</Text>
			}
			highlightOnHoverColor={
				props.isDark
					? "var(--mantine-color-dark-6)"
					: "var(--mantine-color-stone-0)"
			}
		/>
	);
}
