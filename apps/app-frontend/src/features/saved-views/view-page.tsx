import {
	ActionIcon,
	Badge,
	Box,
	Button,
	Container,
	Drawer,
	Group,
	Pagination,
	Paper,
	SegmentedControl,
	Stack,
	Text,
} from "@mantine/core";
import { useDisclosure, useLocalStorage } from "@mantine/hooks";
import {
	Copy,
	FolderPlus,
	Info,
	LayoutGrid,
	List,
	Table2,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "~/components/PageStates";
import { useResolvedImageUrls } from "~/features/entities/image";
import {
	type AppEntityImage,
	toAppEntity,
	toAppEntityImage,
} from "~/features/entities/model";
import { TrackerIcon } from "~/features/trackers/icons";
import { useApiClient } from "~/hooks/api";
import { useThemeTokens } from "~/hooks/theme";
import type { ApiGetResponseData } from "~/lib/api/types";
import { STORAGE_KEYS } from "~/lib/storage-keys";
import { getAccentMuted } from "~/lib/theme";
import { SavedViewDrawerContent } from "./components/saved-view-drawer-content";
import { SavedViewResults } from "./view-page-sections";
import {
	createDisabledQueryEngineRequest,
	createQueryEngineRequest,
	getPageLimit,
	getRuntimeField,
	isRuntimeField,
} from "./view-page-utils";

type ViewLayout =
	keyof ApiGetResponseData<"/saved-views/{viewSlug}">["displayConfiguration"];

const isViewLayout = (value: string): value is ViewLayout => {
	return ["grid", "list", "table"].includes(value);
};

export function SavedViewPage(props: {
	viewSlug: string;
	isCloning?: boolean;
	isDeleting?: boolean;
	actionError?: string | null;
	isCreatingCollection: boolean;
	onCreateCollection: () => void;
	onClone: () => void | Promise<void>;
	onDelete: () => void | Promise<void>;
}) {
	const apiClient = useApiClient();
	const { surface, textPrimary, textSecondary } = useThemeTokens();
	const [drawerOpened, drawer] = useDisclosure(false);
	const [layout, setLayout] = useLocalStorage<ViewLayout>({
		key: `${STORAGE_KEYS.viewLayout}:${props.viewSlug}`,
		defaultValue: "grid",
	});
	const [page, setPage] = useState(1);

	const savedViewQuery = apiClient.useQuery("get", "/saved-views/{viewSlug}", {
		params: { path: { viewSlug: props.viewSlug } },
	});
	const savedView = savedViewQuery.data?.data;
	const runtimeRequest = useMemo(
		() =>
			savedView
				? createQueryEngineRequest({
						view: savedView,
						layout,
						page,
						limit: getPageLimit(layout),
					})
				: createDisabledQueryEngineRequest(),
		[savedView, layout, page],
	);
	const runtimeQuery = apiClient.useQuery(
		"post",
		"/query-engine/execute",
		{ body: runtimeRequest },
		{ enabled: !!savedView },
	);

	const items = (runtimeQuery.data?.data.items ?? []).map(toAppEntity);
	const meta = runtimeQuery.data?.data.meta;
	const imageEntries = useMemo(() => {
		const entries: Array<{ id: string; image: AppEntityImage }> = [];
		for (const item of items) {
			if (layout === "table") {
				for (const field of item.fields ?? []) {
					if (field.kind === "image") {
						entries.push({
							id: `${item.id}:${field.key}`,
							image: toAppEntityImage(field.value),
						});
					}
				}
				continue;
			}

			const imageField = item.fields
				? getRuntimeField(item, "image")
				: undefined;
			if (isRuntimeField(imageField) && imageField.kind === "image") {
				entries.push({
					id: item.id,
					image: toAppEntityImage(imageField.value),
				});
			}
		}
		return entries;
	}, [items, layout]);
	const imageUrls = useResolvedImageUrls(imageEntries);

	useEffect(() => {
		setPage(1);
	}, [layout, props.viewSlug, setPage]);

	if (savedViewQuery.isLoading) {
		return <LoadingState />;
	}
	if (savedViewQuery.isError) {
		return (
			<ErrorState
				title="Failed to load view"
				onRetry={() => savedViewQuery.refetch()}
				description="We could not load this saved view right now."
			/>
		);
	}
	if (!savedView) {
		return (
			<ErrorState
				title="View not found"
				description="This saved view does not exist or is no longer available."
			/>
		);
	}
	if (runtimeQuery.isLoading) {
		return <LoadingState />;
	}
	if (runtimeQuery.isError || !meta) {
		return (
			<ErrorState
				title="Failed to load results"
				onRetry={() => runtimeQuery.refetch()}
				description="We could not render this view right now."
			/>
		);
	}

	const accentColor = savedView.accentColor;
	const accentMuted = getAccentMuted(accentColor);
	const schemaSummary = savedView.queryDefinition.entitySchemaSlugs.join(", ");
	const pageSummary =
		meta.pagination.totalPages > 0
			? `Page ${meta.pagination.page} of ${meta.pagination.totalPages}`
			: "No pages";

	return (
		<Container size="xl" py="xl">
			<Stack gap="xl">
				<Paper
					p="lg"
					withBorder
					radius="sm"
					bg={surface}
					style={{ borderTop: `3px solid ${accentColor}` }}
				>
					<Group justify="space-between" align="flex-start" gap="md">
						<Stack gap={6} style={{ flex: 1 }}>
							<Group gap="sm">
								<Box
									w={36}
									h={36}
									c={accentColor}
									bg={accentMuted}
									style={{
										display: "grid",
										placeItems: "center",
										borderRadius: "var(--mantine-radius-sm)",
									}}
								>
									<TrackerIcon icon={savedView.icon} size={18} />
								</Box>
								<Text
									fw={700}
									lh={1.1}
									size="1.5rem"
									c={textPrimary}
									ff="var(--mantine-headings-font-family)"
								>
									{savedView.name}
								</Text>
								{savedView.isBuiltin ? (
									<Badge
										size="sm"
										variant="light"
										c={accentColor}
										bg={accentMuted}
									>
										Built-in
									</Badge>
								) : null}
							</Group>
							<Text size="sm" c={textSecondary}>
								Browsing {schemaSummary || "selected schemas"}
							</Text>
							<Group gap="xs">
								<Badge variant="filled" bg={accentColor} c="white">
									{meta.pagination.total} results
								</Badge>
								<Text size="xs" c="dimmed">
									{pageSummary}
								</Text>
							</Group>
						</Stack>
						<Group gap="xs">
							{savedView.name === "Collections" && props.onCreateCollection ? (
								<Button
									size="sm"
									variant="light"
									onClick={props.onCreateCollection}
									loading={props.isCreatingCollection}
									leftSection={<FolderPlus size={14} />}
								>
									New collection
								</Button>
							) : null}
							<Button
								size="sm"
								variant="light"
								loading={props.isCloning}
								leftSection={<Copy size={14} />}
								onClick={() => void props.onClone()}
							>
								Clone
							</Button>
							{!savedView.isBuiltin ? (
								<Button
									size="sm"
									color="red"
									variant="light"
									loading={props.isDeleting}
									leftSection={<Trash2 size={14} />}
									onClick={() => void props.onDelete()}
								>
									Delete
								</Button>
							) : null}
							<SegmentedControl
								value={layout}
								onChange={(value) => {
									if (isViewLayout(value)) {
										setLayout(value);
									}
								}}
								data={[
									{ label: <LayoutGrid size={14} />, value: "grid" },
									{ label: <List size={14} />, value: "list" },
									{ label: <Table2 size={14} />, value: "table" },
								]}
							/>
							<ActionIcon
								size="lg"
								variant="light"
								onClick={drawer.open}
								style={{ backgroundColor: accentMuted, color: accentColor }}
							>
								<Info size={18} />
							</ActionIcon>
						</Group>
					</Group>
					{props.actionError ? (
						<Text size="sm" c="red">
							{props.actionError}
						</Text>
					) : null}
				</Paper>

				{items.length === 0 ? (
					<EmptyState
						accentColor={accentColor}
						accentMuted={accentMuted}
						description="There are no entities matching this view yet."
					/>
				) : (
					<SavedViewResults
						meta={meta}
						items={items}
						layout={layout}
						accentColor={accentColor}
						accentMuted={accentMuted}
						imageUrlById={imageUrls.imageUrlByEntityId}
						displayConfiguration={savedView.displayConfiguration}
					/>
				)}

				{meta.pagination.totalPages > 1 ? (
					<Paper p="md" withBorder radius="sm" bg={surface}>
						<Group justify="space-between" align="center">
							<Text size="sm" c="dimmed">
								Page {meta.pagination.page} of {meta.pagination.totalPages}
							</Text>
							<Pagination
								size="sm"
								siblings={1}
								boundaries={1}
								color="accent"
								onChange={setPage}
								value={meta.pagination.page}
								total={meta.pagination.totalPages}
							/>
						</Group>
					</Paper>
				) : null}

				<Drawer
					size="md"
					position="right"
					title="View details"
					opened={drawerOpened}
					onClose={drawer.close}
					styles={{
						body: { backgroundColor: surface },
						header: { backgroundColor: surface },
						content: { backgroundColor: surface },
					}}
				>
					<SavedViewDrawerContent
						view={savedView}
						onClone={props.onClone}
						isCloning={props.isCloning ?? false}
					/>
				</Drawer>
			</Stack>
		</Container>
	);
}
