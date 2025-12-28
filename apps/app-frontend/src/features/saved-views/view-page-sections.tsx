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
import { Link } from "@tanstack/react-router";
import { Image as ImageIcon } from "lucide-react";
import { DataTable, type DataTableColumn } from "mantine-datatable";
import type { AppEntity } from "#/features/entities/model";
import { useThemeTokens } from "#/hooks/theme";
import type {
	SavedView,
	ViewLayout,
	ViewRuntimeResponse,
} from "./view-page-utils";
import {
	formatRuntimeValue,
	getRuntimeField,
	isRuntimeField,
} from "./view-page-utils";

function EntityThumbnail(props: {
	label?: string;
	height: number;
	radius?: string;
	iconSize?: number;
	imageUrl?: string;
	width: number | string;
}) {
	const { surfaceHover, textMuted } = useThemeTokens();

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
	items: AppEntity[];
	layout: ViewLayout;
	accentColor: string;
	accentMuted: string;
	displayConfiguration: SavedView["displayConfiguration"];
	meta: ViewRuntimeResponse["meta"];
	imageUrlById: Map<string, string | undefined>;
}) {
	const { isDark, textPrimary, textSecondary } = useThemeTokens();
	if (props.layout === "grid") {
		return (
			<SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="md">
				{props.items.map((item) => {
					const title = item.fields
						? getRuntimeField(item, "title")
						: undefined;
					const badge = item.fields
						? getRuntimeField(item, "badge")
						: undefined;
					const image = item.fields
						? getRuntimeField(item, "image")
						: undefined;
					const subtitle = item.fields
						? getRuntimeField(item, "subtitle")
						: undefined;

					return (
						<Link
							key={item.id}
							to="/entities/$entityId"
							params={{ entityId: item.id }}
							style={{ color: "inherit", textDecoration: "none" }}
						>
							<Card p={0} radius="sm" style={{ overflow: "hidden" }}>
								<EntityThumbnail
									height={220}
									width="100%"
									iconSize={48}
									imageUrl={props.imageUrlById.get(item.id)}
									label={
										isRuntimeField(image) && image.kind !== "image"
											? formatRuntimeValue(image.value)
											: undefined
									}
								/>
								<Stack gap="xs" p="lg">
									<Text
										fw={600}
										size="md"
										lineClamp={2}
										c={textPrimary}
										ff="var(--mantine-headings-font-family)"
									>
										{isRuntimeField(title)
											? formatRuntimeValue(title.value)
											: item.name}
									</Text>
									{isRuntimeField(subtitle) && subtitle.kind !== "null" ? (
										<Text size="sm" c={textSecondary} lineClamp={2}>
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
										{isRuntimeField(badge) && badge.kind !== "null" ? (
											<Badge variant="filled" bg={props.accentColor} c="white">
												{formatRuntimeValue(badge.value)}
											</Badge>
										) : null}
									</Group>
								</Stack>
							</Card>
						</Link>
					);
				})}
			</SimpleGrid>
		);
	}

	if (props.layout === "list") {
		return (
			<Stack gap="sm">
				{props.items.map((item) => {
					const title = item.fields
						? getRuntimeField(item, "title")
						: undefined;
					const badge = item.fields
						? getRuntimeField(item, "badge")
						: undefined;
					const image = item.fields
						? getRuntimeField(item, "image")
						: undefined;
					const subtitle = item.fields
						? getRuntimeField(item, "subtitle")
						: undefined;

					return (
						<Link
							key={item.id}
							to="/entities/$entityId"
							params={{ entityId: item.id }}
							style={{ color: "inherit", textDecoration: "none" }}
						>
							<Paper p="md" withBorder radius="sm">
								<Group justify="space-between" align="flex-start" wrap="nowrap">
									<Group
										gap="md"
										wrap="nowrap"
										style={{ flex: 1, minWidth: 0 }}
									>
										<EntityThumbnail
											width={60}
											height={84}
											iconSize={20}
											imageUrl={props.imageUrlById.get(item.id)}
											label={
												isRuntimeField(image) && image.kind !== "image"
													? formatRuntimeValue(image.value)
													: undefined
											}
										/>
										<Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
											<Text
												fw={600}
												size="md"
												c={textPrimary}
												ff="var(--mantine-headings-font-family)"
											>
												{isRuntimeField(title)
													? formatRuntimeValue(title.value)
													: item.name}
											</Text>
											{isRuntimeField(subtitle) && subtitle.kind !== "null" ? (
												<Text size="sm" c={textSecondary}>
													{formatRuntimeValue(subtitle.value)}
												</Text>
											) : null}
											<Text size="xs" c="dimmed">
												{item.entitySchemaSlug}
											</Text>
										</Stack>
									</Group>
									{isRuntimeField(badge) && badge.kind !== "null" ? (
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
						</Link>
					);
				})}
			</Stack>
		);
	}

	const tableColumns = props.displayConfiguration.table.columns.map(
		(column, index) => ({ key: `column_${index}`, label: column.label }),
	);
	const linkColumnKey = tableColumns.find((column) =>
		props.items.some(
			(item) =>
				item.fields?.find((entry) => entry.key === column.key)?.kind === "text",
		),
	)?.key;

	const dataColumns: DataTableColumn<AppEntity>[] = tableColumns.map(
		(column) => ({
			title: column.label,
			accessor: column.key,
			titleStyle: {
				fontWeight: 600,
				fontSize: "12px",
				letterSpacing: "0.5px",
				color: props.accentColor,
				textTransform: "uppercase",
				fontFamily: "var(--mantine-headings-font-family)",
			},
			render: (item) => {
				const field = item.fields?.find((entry) => entry.key === column.key);

				if (field?.kind === "image") {
					return (
						<EntityThumbnail
							width={40}
							height={54}
							iconSize={16}
							radius="var(--mantine-radius-xs)"
							imageUrl={props.imageUrlById.get(`${item.id}:${field.key}`)}
						/>
					);
				}

				if (column.key === linkColumnKey && field?.kind === "text") {
					return (
						<Link
							to="/entities/$entityId"
							params={{ entityId: item.id }}
							style={{ color: props.accentColor, textDecoration: "none" }}
						>
							<Text size="sm" fw={500} ff="var(--mantine-headings-font-family)">
								{formatRuntimeValue(field?.value)}
							</Text>
						</Link>
					);
				}

				return (
					<Text size="sm" c={textSecondary}>
						{formatRuntimeValue(field?.value)}
					</Text>
				);
			},
		}),
	);

	return (
		<DataTable
			striped
			c={textPrimary}
			withTableBorder
			highlightOnHover
			borderRadius="sm"
			records={props.items}
			columns={dataColumns}
			borderColor={props.accentMuted}
			rowBorderColor={props.accentMuted}
			stripedColor={isDark ? "var(--mantine-color-dark-7)" : "white"}
			highlightOnHoverColor={
				isDark ? "var(--mantine-color-dark-6)" : "var(--mantine-color-stone-0)"
			}
			emptyState={
				<Text size="sm" c={textSecondary}>
					No rows available
				</Text>
			}
		/>
	);
}
