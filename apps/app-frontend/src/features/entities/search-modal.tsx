import {
	ActionIcon,
	Box,
	Button,
	Group,
	Loader,
	Modal,
	Paper,
	ScrollArea,
	SegmentedControl,
	Stack,
	Text,
	TextInput,
} from "@mantine/core";
import {
	CheckCircle,
	ChevronLeft,
	ChevronRight,
	Image as ImageIcon,
	Plus,
	Search,
} from "lucide-react";
import type { AppEntitySchema } from "#/features/entity-schemas/model";
import { useThemeTokens } from "#/hooks/theme";
import type { SearchResultItem } from "./use-search";
import { useEntitySearch } from "./use-search";

function EntityThumbnail(props: {
	height: number;
	iconSize?: number;
	imageUrl?: string;
	width: number | string;
}) {
	const { surfaceHover, textMuted } = useThemeTokens();

	if (props.imageUrl) {
		return (
			<Box
				w={props.width}
				h={props.height}
				style={{
					flexShrink: 0,
					backgroundSize: "cover",
					backgroundPosition: "center",
					borderRadius: "var(--mantine-radius-sm)",
					backgroundImage: `url(${props.imageUrl})`,
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
				borderRadius: "var(--mantine-radius-sm)",
			}}
		>
			<ImageIcon
				color={textMuted}
				strokeWidth={1.5}
				size={props.iconSize ?? 24}
			/>
		</Box>
	);
}

function SearchResultRow(props: {
	onAdd: () => void;
	item: SearchResultItem;
	errorMessage: string | undefined;
	status: "idle" | "loading" | "done" | "error";
}) {
	const { item, status } = props;
	const imageUrl =
		item.imageProperty?.kind === "image"
			? (item.imageProperty.value?.url ?? undefined)
			: undefined;

	return (
		<Paper p="sm" withBorder radius="sm">
			<Group justify="space-between" align="center" wrap="nowrap">
				<Group gap="md" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
					<EntityThumbnail
						width={48}
						height={68}
						iconSize={16}
						imageUrl={imageUrl}
					/>
					<Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
						<Text fw={500} size="sm" lineClamp={1}>
							{item.titleProperty.value}
						</Text>
						{item.subtitleProperty?.kind === "number" && (
							<Text size="xs" c="dimmed">
								{item.subtitleProperty.value}
							</Text>
						)}
					</Stack>
				</Group>
				<Box w={32} style={{ flexShrink: 0 }}>
					{status === "loading" && <Loader size="xs" />}
					{status === "done" && (
						<CheckCircle
							size={18}
							strokeWidth={1.5}
							color="var(--mantine-color-green-6)"
						/>
					)}
					{status === "error" && (
						<Text c="red" size="xs" title={props.errorMessage}>
							!
						</Text>
					)}
					{status === "idle" && (
						<ActionIcon variant="subtle" onClick={props.onAdd} aria-label="Add">
							<Plus size={16} strokeWidth={1.5} />
						</ActionIcon>
					)}
				</Box>
			</Group>
			{status === "error" && props.errorMessage && (
				<Text c="red" size="xs" mt={4}>
					{props.errorMessage}
				</Text>
			)}
		</Paper>
	);
}

export function SearchEntityModal(props: {
	opened: boolean;
	onClose: () => void;
	onEntityAdded: () => void;
	entitySchema: AppEntitySchema;
}) {
	const {
		page,
		query,
		search,
		results,
		addItem,
		setQuery,
		addError,
		nextPage,
		goToPage,
		addStatus,
		isSearching,
		searchError,
		selectedProviderIndex,
		setSelectedProviderIndex,
	} = useEntitySearch({
		entitySchema: props.entitySchema,
		onEntityAdded: props.onEntityAdded,
	});

	return (
		<Modal
			centered
			size="xl"
			opened={props.opened}
			onClose={props.onClose}
			title={`Add ${props.entitySchema.name}`}
			overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
		>
			<Stack gap="md">
				{props.entitySchema.searchProviders.length > 1 && (
					<SegmentedControl
						fullWidth
						value={String(selectedProviderIndex)}
						onChange={(v) => setSelectedProviderIndex(Number(v))}
						data={props.entitySchema.searchProviders.map((p, i) => ({
							value: String(i),
							label: p.name,
						}))}
					/>
				)}

				<Group>
					<TextInput
						flex={1}
						value={query}
						disabled={isSearching}
						placeholder="Search..."
						onChange={(e) => setQuery(e.currentTarget.value)}
						leftSection={<Search size={16} strokeWidth={1.5} />}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								search();
							}
						}}
					/>
					<Button
						onClick={search}
						loading={isSearching}
						disabled={!query.trim()}
					>
						Search
					</Button>
				</Group>

				{searchError && (
					<Text c="red" size="sm">
						{searchError}
					</Text>
				)}

				{results !== null && (
					<Stack gap="xs">
						{results.length === 0 ? (
							<Text c="dimmed" size="sm" ta="center" py="md">
								No results found
							</Text>
						) : (
							<>
								<ScrollArea.Autosize mah={400}>
									<Stack gap={4}>
										{results.map((item) => (
											<SearchResultRow
												item={item}
												key={item.identifier}
												onAdd={() => void addItem(item)}
												errorMessage={addError[item.identifier]}
												status={addStatus[item.identifier] ?? "idle"}
											/>
										))}
									</Stack>
								</ScrollArea.Autosize>

								{(page > 1 || nextPage !== null) && (
									<Group justify="center" gap="xs">
										<Button
											size="xs"
											variant="subtle"
											disabled={page <= 1 || isSearching}
											leftSection={<ChevronLeft size={14} />}
											onClick={() => goToPage(page - 1)}
										>
											Prev
										</Button>
										<Text size="xs" c="dimmed">
											Page {page}
										</Text>
										<Button
											size="xs"
											variant="subtle"
											rightSection={<ChevronRight size={14} />}
											onClick={() => goToPage(page + 1)}
											disabled={nextPage === null || isSearching}
										>
											Next
										</Button>
									</Group>
								)}
							</>
						)}
					</Stack>
				)}
			</Stack>
		</Modal>
	);
}
