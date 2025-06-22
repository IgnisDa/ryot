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
import type { AppEntity } from "~/features/entities/model";
import { useThemeTokens } from "~/hooks/theme";
import type { ApiGetResponseData, ApiPostResponseData } from "~/lib/api/types";
import {
	formatRuntimeValue,
	getRuntimeField,
	isRuntimeField,
} from "./view-page-utils";

type ViewLayout =
	keyof ApiGetResponseData<"/saved-views/{viewSlug}">["displayConfiguration"];
type SavedViewDisplayConfiguration =
	ApiGetResponseData<"/saved-views/{viewSlug}">["displayConfiguration"];
type QueryEngineMeta = ApiPostResponseData<"/query-engine/execute">["meta"];

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
	meta: QueryEngineMeta;
	imageUrlById: Map<string, string | undefined>;
	displayConfiguration: SavedViewDisplayConfiguration;
}) {
	const { isDark, textPrimary, textSecondary } = useThemeTokens();

	if (props.layout === "grid") {
		return (
			<SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="sm">
				{props.items.map((item) => {
					const title = item.fields
						? getRuntimeField(item, "title")
						: undefined;
					const image = item.fields
						? getRuntimeField(item, "image")
						: undefined;
					const callout = item.fields
						? getRuntimeField(item, "callout")
						: undefined;
					const primarySubtitle = item.fields
						? getRuntimeField(item, "primarySubtitle")
						: undefined;
					const secondarySubtitle = item.fields
						? getRuntimeField(item, "secondarySubtitle")
						: undefined;
					const entitySchemaSlugField = item.fields
						? getRuntimeField(item, "entitySchemaSlug")
						: undefined;

					return (
						<Link
							key={item.id}
							to="/entities/$entityId"
							params={{ entityId: item.id }}
							style={{ color: "inherit", textDecoration: "none" }}
						>
							<Card
								p={0}
								radius="sm"
								pos="relative"
								style={{ overflow: "hidden" }}
							>
								<EntityThumbnail
									height={300}
									width="100%"
									iconSize={48}
									imageUrl={props.imageUrlById.get(item.id)}
									label={
										isRuntimeField(image) && image.kind !== "image"
											? formatRuntimeValue(image.value)
											: undefined
									}
								/>
								<Group
									gap={4}
									pos="absolute"
									top={8}
									left={8}
									right={8}
									wrap="nowrap"
									align="flex-start"
									justify="space-between"
								>
									<Badge size="xs" c="white" bg="rgba(0,0,0,0.55)">
										{entitySchemaSlugField
											? formatRuntimeValue(entitySchemaSlugField.value)
											: "entity"}
									</Badge>
									{isRuntimeField(callout) && callout.kind === "number" ? (
										<Badge size="xs" c="white" bg={props.accentColor}>
											★ {formatRuntimeValue(callout.value)}
										</Badge>
									) : null}
								</Group>
								<Box
									pos="absolute"
									bottom={0}
									left={0}
									right={0}
									pt={64}
									pb="md"
									px="md"
									style={{
										background:
											"linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 60%, transparent 100%)",
									}}
								>
									<Stack gap={2}>
										{isRuntimeField(primarySubtitle) &&
										primarySubtitle.kind !== "null" ? (
											<Text size="xs" c="gray.4">
												{formatRuntimeValue(primarySubtitle.value)}
											</Text>
										) : null}
										{isRuntimeField(secondarySubtitle) &&
										secondarySubtitle.kind !== "null" ? (
											<Text size="xs" c="gray.5">
												{formatRuntimeValue(secondarySubtitle.value)}
											</Text>
										) : null}
										<Text
											fw={700}
											size="sm"
											c="white"
											lineClamp={2}
											ff="var(--mantine-headings-font-family)"
										>
											{isRuntimeField(title)
												? formatRuntimeValue(title.value)
												: item.name}
										</Text>
									</Stack>
								</Box>
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
					const image = item.fields
						? getRuntimeField(item, "image")
						: undefined;
					const callout = item.fields
						? getRuntimeField(item, "callout")
						: undefined;
					const primarySubtitle = item.fields
						? getRuntimeField(item, "primarySubtitle")
						: undefined;
					const secondarySubtitle = item.fields
						? getRuntimeField(item, "secondarySubtitle")
						: undefined;
					const entitySchemaSlugField = item.fields
						? getRuntimeField(item, "entitySchemaSlug")
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
											{isRuntimeField(primarySubtitle) &&
											primarySubtitle.kind !== "null" ? (
												<Text size="sm" c={textSecondary}>
													{formatRuntimeValue(primarySubtitle.value)}
												</Text>
											) : null}
											{isRuntimeField(secondarySubtitle) &&
											secondarySubtitle.kind !== "null" ? (
												<Text size="xs" c="dimmed">
													{formatRuntimeValue(secondarySubtitle.value)}
												</Text>
											) : null}
											<Text size="xs" c="dimmed">
												{entitySchemaSlugField
													? formatRuntimeValue(entitySchemaSlugField.value)
													: "entity"}
											</Text>
										</Stack>
									</Group>
									{isRuntimeField(callout) && callout.kind !== "null" ? (
										<Badge
											c="white"
											size="lg"
											variant="filled"
											bg={props.accentColor}
										>
											{formatRuntimeValue(callout.value)}
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
