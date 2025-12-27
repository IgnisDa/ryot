import {
	ActionIcon,
	Badge,
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
	entityName: string;
	accentColor: string;
	providerName: string;
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
						<Group gap={6} wrap="wrap">
							<Text fw={600} size="sm" lineClamp={1}>
								{item.titleProperty.value}
							</Text>
							{status === "done" && (
								<CheckCircle
									size={16}
									strokeWidth={1.5}
									color="var(--mantine-color-green-6)"
								/>
							)}
						</Group>
						<Group gap={6} wrap="wrap">
							<Badge
								size="xs"
								variant="light"
								style={{
									color: props.accentColor,
									backgroundColor: `${props.accentColor}12`,
								}}
							>
								{props.entityName}
							</Badge>
							{item.subtitleProperty?.kind === "number" && (
								<Text size="xs" c="dimmed">
									{item.subtitleProperty.value}
								</Text>
							)}
							<Text size="xs" c="dimmed">
								via {props.providerName}
							</Text>
						</Group>
					</Stack>
				</Group>
				<Box w={32} style={{ flexShrink: 0 }}>
					{status === "loading" && <Loader size="xs" />}
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
	onBack: () => void;
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

	const accentColor = props.entitySchema.accentColor ?? "#8C7560";
	const activeProvider =
		props.entitySchema.searchProviders[selectedProviderIndex];

	return (
		<Modal
			centered
			size="lg"
			opened={props.opened}
			onClose={props.onClose}
			title={
				<Group gap="xs">
					<ActionIcon
						size="sm"
						variant="subtle"
						onClick={props.onBack}
						aria-label="Back to type picker"
					>
						<ChevronLeft size={16} />
					</ActionIcon>
					<Text ff="var(--mantine-headings-font-family)" fw={600} fz="md">
						Add {props.entitySchema.name}
					</Text>
				</Group>
			}
			overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
		>
			<Stack gap="md">
				{props.entitySchema.searchProviders.length > 1 && (
					<SegmentedControl
						fullWidth
						value={String(selectedProviderIndex)}
						onChange={(v) => setSelectedProviderIndex(Number(v))}
						data={props.entitySchema.searchProviders.map((p, i) => ({
							label: p.name,
							value: String(i),
						}))}
					/>
				)}

				<Group>
					<TextInput
						flex={1}
						value={query}
						disabled={isSearching}
						placeholder={`Search for a ${props.entitySchema.name.toLowerCase()}...`}
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
						style={{ color: "white", backgroundColor: accentColor }}
					>
						Search
					</Button>
				</Group>

				{searchError && (
					<Text c="red" size="sm">
						{searchError}
					</Text>
				)}

				{isSearching && (
					<Stack align="center" py="xl">
						<Loader size="sm" color={accentColor} />
						<Text size="sm" c="dimmed">
							Searching...
						</Text>
					</Stack>
				)}

				{results !== null && !isSearching && (
					<Stack gap="xs">
						{results.length === 0 ? (
							<Text c="dimmed" size="sm" ta="center" py="md">
								No results found
							</Text>
						) : (
							<>
								<Group justify="flex-end" align="center" px={2}>
									<Badge
										variant="light"
										style={{
											color: accentColor,
											backgroundColor: `${accentColor}12`,
										}}
									>
										{results.length} result{results.length === 1 ? "" : "s"}
									</Badge>
								</Group>
								<ScrollArea.Autosize mah={460}>
									<Stack gap={6}>
										{results.map((item) => (
											<SearchResultRow
												item={item}
												key={item.identifier}
												accentColor={accentColor}
												onAdd={() => void addItem(item)}
												entityName={props.entitySchema.name}
												errorMessage={addError[item.identifier]}
												providerName={activeProvider?.name ?? ""}
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
