import {
	Badge,
	Box,
	Button,
	Group,
	Loader,
	Paper,
	Stack,
	Text,
} from "@mantine/core";
import {
	Bookmark,
	CheckCircle,
	FolderPlus,
	History,
	Image as ImageIcon,
	Star,
} from "lucide-react";
import type {
	CollectionDiscoveryState,
	CollectionMembershipFormValues,
} from "~/features/collections";
import type { CollectionsDestination } from "~/features/collections/model";
import { useThemeTokens } from "~/hooks/theme";
import type {
	MediaSearchDoneAction,
	MediaSearchLogDateOption,
} from "./search-modal-media-actions";
import { getMediaDoneActionLabel } from "./search-modal-media-actions";
import {
	SearchResultCollectionPanel,
	SearchResultLogPanel,
	SearchResultReviewPanel,
} from "./search-result-row-panels";
import type { SearchResultItem } from "./use-search";

export type SearchResultRowActionState = {
	rateStars: number;
	rateReview: string;
	logStartedOn: string;
	rateStarsHover: number;
	logCompletedOn: string;
	showSeason: number | "";
	showEpisode: number | "";
	animeEpisode: number | "";
	mangaChapter: number | "";
	mangaVolume: number | "";
	actionError: string | null;
	podcastEpisode: number | "";
	logDate: MediaSearchLogDateOption;
	doneActions: MediaSearchDoneAction[];
	openPanel: "log" | "rate" | "collection" | null;
	pendingAction: "add" | "backlog" | "log" | "rate" | "collection" | null;
};

export const defaultSearchResultRowActionState: SearchResultRowActionState = {
	rateStars: 0,
	logDate: "now",
	rateReview: "",
	showSeason: "",
	mangaVolume: "",
	showEpisode: "",
	openPanel: null,
	doneActions: [],
	animeEpisode: "",
	mangaChapter: "",
	logStartedOn: "",
	rateStarsHover: 0,
	actionError: null,
	podcastEpisode: "",
	logCompletedOn: "",
	pendingAction: null,
};

function withAlpha(hex: string, alpha: number) {
	const raw = hex.replace("#", "");
	const normalized =
		raw.length === 3
			? raw
					.split("")
					.map((char) => `${char}${char}`)
					.join("")
			: raw;
	const r = Number.parseInt(normalized.slice(0, 2), 16);
	const g = Number.parseInt(normalized.slice(2, 4), 16);
	const b = Number.parseInt(normalized.slice(4, 6), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function EntityThumbnail(props: {
	height: number;
	iconSize?: number;
	imageUrl?: string;
	width: number | string;
}) {
	const t = useThemeTokens();

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
			bg={t.surfaceHover}
			style={{
				flexShrink: 0,
				display: "grid",
				overflow: "hidden",
				placeItems: "center",
				borderRadius: "var(--mantine-radius-sm)",
			}}
		>
			<ImageIcon
				strokeWidth={1.5}
				color={t.textMuted}
				size={props.iconSize ?? 24}
			/>
		</Box>
	);
}

function SearchResultActions(props: {
	isWorking: boolean;
	accentColor: string;
	onBacklog: () => void;
	isPersonSchema: boolean;
	canUseLifecycleActions: boolean;
	canUseCollectionAction: boolean;
	actionState: SearchResultRowActionState;
	onTogglePanel: (panel: "log" | "rate" | "collection") => void;
}) {
	return (
		<Group gap={6} wrap="wrap">
			{!props.isPersonSchema && (
				<Button
					size="compact-xs"
					onClick={() => props.onTogglePanel("log")}
					loading={props.actionState.pendingAction === "log"}
					leftSection={<History size={13} strokeWidth={1.5} />}
					disabled={
						!props.canUseLifecycleActions ||
						(props.isWorking && props.actionState.pendingAction !== "log")
					}
					variant={
						props.actionState.openPanel === "log"
							? "filled"
							: props.actionState.doneActions.includes("log")
								? "light"
								: "subtle"
					}
					style={
						props.actionState.openPanel === "log"
							? { backgroundColor: props.accentColor, color: "white" }
							: props.actionState.doneActions.includes("log")
								? {
										backgroundColor: withAlpha(props.accentColor, 0.12),
										color: props.accentColor,
									}
								: undefined
					}
				>
					Log progress
				</Button>
			)}
			{!props.isPersonSchema && (
				<Button
					size="compact-xs"
					onClick={props.onBacklog}
					leftSection={<Bookmark size={13} strokeWidth={1.5} />}
					loading={props.actionState.pendingAction === "backlog"}
					disabled={!props.canUseLifecycleActions || props.isWorking}
					variant={
						props.actionState.doneActions.includes("backlog")
							? "light"
							: "subtle"
					}
					style={
						props.actionState.doneActions.includes("backlog")
							? {
									backgroundColor: withAlpha(props.accentColor, 0.12),
									color: props.accentColor,
								}
							: undefined
					}
				>
					Watchlist
				</Button>
			)}
			<Button
				size="compact-xs"
				onClick={() => props.onTogglePanel("collection")}
				loading={props.actionState.pendingAction === "collection"}
				leftSection={<FolderPlus size={13} strokeWidth={1.5} />}
				disabled={
					!props.canUseCollectionAction ||
					(props.isWorking && props.actionState.pendingAction !== "collection")
				}
				variant={
					props.actionState.openPanel === "collection" ? "filled" : "subtle"
				}
				style={
					props.actionState.openPanel === "collection"
						? { backgroundColor: props.accentColor, color: "white" }
						: undefined
				}
			>
				Collection
			</Button>
			<Button
				size="compact-xs"
				onClick={() => props.onTogglePanel("rate")}
				leftSection={<Star size={13} strokeWidth={1.5} />}
				loading={props.actionState.pendingAction === "rate"}
				disabled={
					!props.canUseLifecycleActions ||
					(props.isWorking && props.actionState.pendingAction !== "rate")
				}
				variant={
					props.actionState.openPanel === "rate"
						? "filled"
						: props.actionState.doneActions.includes("rate")
							? "light"
							: "subtle"
				}
				style={
					props.actionState.openPanel === "rate"
						? { backgroundColor: props.accentColor, color: "white" }
						: props.actionState.doneActions.includes("rate")
							? {
									backgroundColor: withAlpha(props.accentColor, 0.12),
									color: props.accentColor,
								}
							: undefined
				}
			>
				Rate & review
			</Button>
		</Group>
	);
}

export function SearchResultRow(props: {
	onAdd: () => void;
	entityName: string;
	isTracked: boolean;
	isExpanded: boolean;
	accentColor: string;
	providerName: string;
	onBacklog: () => void;
	onSaveLog: () => void;
	item: SearchResultItem;
	isPersonSchema: boolean;
	entitySchemaSlug: string;
	onSaveReview: () => void;
	isLifecycleLoading: boolean;
	onToggleActions: () => void;
	addError: string | undefined;
	canUseCollectionAction: boolean;
	propertyLoadError?: string | null;
	isLoadingEntityProperties?: boolean;
	lifecycleErrorMessage: string | null;
	onRetryCollectionDiscovery: () => void;
	actionState: SearchResultRowActionState;
	collectionState: CollectionDiscoveryState;
	entityProperties?: Record<string, unknown>;
	collectionsDestination: CollectionsDestination;
	onTogglePanel: (panel: "log" | "rate" | "collection") => void;
	addStatus: "idle" | "loading" | "done" | "error" | "partial_error";
	onSaveCollection: (values: CollectionMembershipFormValues) => void;
	onPatchActionState: (patch: Partial<SearchResultRowActionState>) => void;
}) {
	const t = useThemeTokens();
	const imageUrl =
		props.item.imageProperty.kind === "image"
			? (props.item.imageProperty.value?.url ?? undefined)
			: undefined;
	const isTracked = props.isTracked;
	const isBacklogged = props.actionState.doneActions.includes("backlog");
	const canUseLifecycleActions =
		!props.isLifecycleLoading && !props.lifecycleErrorMessage;

	const displayError =
		props.actionState.actionError ??
		(props.addStatus === "error"
			? (props.addError ?? "Failed to add item")
			: null);
	const isWorking = props.actionState.pendingAction !== null;

	return (
		<Paper
			p="sm"
			withBorder
			radius="sm"
			style={{
				background: props.isExpanded
					? `linear-gradient(180deg, ${withAlpha(props.accentColor, 0.08)} 0%, ${t.surface} 100%)`
					: t.surface,
				borderColor: props.isExpanded
					? withAlpha(props.accentColor, 0.42)
					: t.border,
			}}
		>
			<Group gap="md" align="flex-start" wrap="nowrap">
				<EntityThumbnail
					width={48}
					height={68}
					iconSize={16}
					imageUrl={imageUrl}
				/>
				<Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
					<Group gap={6} wrap="wrap">
						<Text fw={600} fz="sm" lineClamp={1} c={t.textPrimary}>
							{props.item.titleProperty.value}
						</Text>
						{isTracked ? (
							<CheckCircle
								size={16}
								strokeWidth={1.5}
								color="var(--mantine-color-green-6)"
							/>
						) : null}
					</Group>
					<Group gap={6} wrap="wrap">
						<Badge
							size="xs"
							variant="light"
							style={{
								color: props.accentColor,
								backgroundColor: withAlpha(props.accentColor, 0.12),
							}}
						>
							{props.entityName}
						</Badge>
						{props.item.subtitleProperty.kind === "number" ? (
							<Text fz="xs" c={t.textMuted}>
								{props.item.subtitleProperty.value}
							</Text>
						) : null}
						<Text fz="xs" c={t.textMuted}>
							via {props.providerName}
						</Text>
					</Group>
					<Group gap="xs" wrap="nowrap" justify="flex-end">
						{!props.isPersonSchema ? (
							<Button
								size="compact-sm"
								onClick={props.onBacklog}
								variant={isBacklogged ? "light" : "filled"}
								loading={props.actionState.pendingAction === "backlog"}
								disabled={
									isBacklogged ||
									(isWorking && props.actionState.pendingAction !== "backlog")
								}
								leftSection={
									props.actionState.pendingAction ===
									"backlog" ? undefined : isBacklogged ? (
										<CheckCircle size={14} />
									) : (
										<Bookmark size={14} />
									)
								}
								style={
									isBacklogged
										? {
												color: "var(--mantine-color-green-7)",
												backgroundColor: "var(--mantine-color-green-0)",
											}
										: { color: "white", backgroundColor: props.accentColor }
								}
							>
								{isBacklogged ? "Queued" : "Queue"}
							</Button>
						) : null}
						<Button
							size="compact-sm"
							disabled={isWorking}
							onClick={props.onToggleActions}
							variant={props.isExpanded ? "light" : "subtle"}
						>
							{props.isExpanded ? "Hide options" : "More options"}
						</Button>
					</Group>
				</Stack>
			</Group>

			{props.actionState.doneActions.length > 0 ? (
				<Group gap={4} mt={8} wrap="wrap">
					{props.actionState.doneActions.map((action) => (
						<Badge
							key={action}
							size="xs"
							variant="light"
							style={{
								backgroundColor: withAlpha(props.accentColor, 0.14),
								color: props.accentColor,
							}}
						>
							{getMediaDoneActionLabel(action, {
								logDate: props.actionState.logDate,
								rateStars: props.actionState.rateStars,
							})}
						</Badge>
					))}
				</Group>
			) : null}

			{props.isExpanded ? (
				<Box mt="sm" pt="sm" style={{ borderTop: `1px solid ${t.border}` }}>
					<Stack gap="sm">
						<Group justify="space-between" align="flex-start" gap="sm">
							<Text
								fz="xs"
								fw={700}
								tt="uppercase"
								c={props.accentColor}
								style={{ letterSpacing: "0.9px" }}
								ff="var(--mantine-headings-font-family)"
							>
								Quick actions
							</Text>
							<Button
								size="compact-xs"
								onClick={props.onAdd}
								disabled={isTracked || isWorking}
								variant={isTracked ? "light" : "subtle"}
							>
								{isTracked ? "Added to library" : "Add to library"}
							</Button>
						</Group>

						<SearchResultActions
							isWorking={isWorking}
							onBacklog={props.onBacklog}
							actionState={props.actionState}
							accentColor={props.accentColor}
							onTogglePanel={props.onTogglePanel}
							isPersonSchema={props.isPersonSchema}
							canUseLifecycleActions={canUseLifecycleActions}
							canUseCollectionAction={props.canUseCollectionAction}
						/>

						{props.isLifecycleLoading ? (
							<Group gap={6}>
								<Loader size="xs" color={props.accentColor} />
								<Text fz="xs" c={t.textMuted}>
									Loading options...
								</Text>
							</Group>
						) : null}
						{props.lifecycleErrorMessage ? (
							<Text fz="xs" c="red">
								{props.lifecycleErrorMessage}
							</Text>
						) : null}

						{props.actionState.openPanel === "log" && canUseLifecycleActions ? (
							<SearchResultLogPanel
								border={t.border}
								textMuted={t.textMuted}
								onSaveLog={props.onSaveLog}
								actionState={props.actionState}
								accentColor={props.accentColor}
								entityProperties={props.entityProperties}
								entitySchemaSlug={props.entitySchemaSlug}
								propertyLoadError={props.propertyLoadError}
								onPatchActionState={props.onPatchActionState}
								isLoadingEntityProperties={props.isLoadingEntityProperties}
							/>
						) : null}

						{props.actionState.openPanel === "rate" &&
						canUseLifecycleActions ? (
							<SearchResultReviewPanel
								border={t.border}
								textMuted={t.textMuted}
								actionState={props.actionState}
								accentColor={props.accentColor}
								onSaveReview={props.onSaveReview}
								onPatchActionState={props.onPatchActionState}
							/>
						) : null}

						{props.actionState.openPanel === "collection" &&
						props.canUseCollectionAction ? (
							<SearchResultCollectionPanel
								border={t.border}
								textMuted={t.textMuted}
								accentColor={props.accentColor}
								collectionState={props.collectionState}
								onSaveCollection={props.onSaveCollection}
								onPatchActionState={props.onPatchActionState}
								collectionsDestination={props.collectionsDestination}
								onRetryCollectionDiscovery={props.onRetryCollectionDiscovery}
								isEnsuringEntity={
									props.actionState.pendingAction === "collection"
								}
							/>
						) : null}
					</Stack>
				</Box>
			) : null}

			{displayError ? (
				<Text c="red" size="xs" mt={8}>
					{displayError}
				</Text>
			) : null}
		</Paper>
	);
}
