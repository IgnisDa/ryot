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
	Plus,
	Star,
} from "lucide-react";
import type { CollectionDiscoveryState } from "~/features/collections";
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
	actionError: string | null;
	openPanel: "log" | "rate" | "collection" | null;
	logDate: MediaSearchLogDateOption;
	doneActions: MediaSearchDoneAction[];
	selectedCollectionId: string | null;
	collectionProperties: Record<string, unknown>;
	pendingAction: "add" | "backlog" | "log" | "rate" | "collection" | null;
	collectionError: string | null;
};

export const defaultSearchResultRowActionState: SearchResultRowActionState = {
	rateStars: 0,
	logDate: "now",
	rateReview: "",
	openPanel: null,
	doneActions: [],
	logStartedOn: "",
	rateStarsHover: 0,
	actionError: null,
	logCompletedOn: "",
	pendingAction: null,
	selectedCollectionId: null,
	collectionProperties: {},
	collectionError: null,
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
	canUseLifecycleActions: boolean;
	actionState: SearchResultRowActionState;
	onTogglePanel: (panel: "log" | "rate" | "collection") => void;
	canUseCollectionAction: boolean;
}) {
	return (
		<Group gap={6} wrap="wrap">
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
			<Button
				size="compact-xs"
				onClick={props.onBacklog}
				leftSection={<Bookmark size={13} strokeWidth={1.5} />}
				loading={props.actionState.pendingAction === "backlog"}
				disabled={!props.canUseLifecycleActions || props.isWorking}
				variant={
					props.actionState.doneActions.includes("backlog") ? "light" : "subtle"
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
					props.actionState.openPanel === "collection"
						? "filled"
						: props.actionState.doneActions.includes("collection")
							? "light"
							: "subtle"
				}
				style={
					props.actionState.openPanel === "collection"
						? { backgroundColor: props.accentColor, color: "white" }
						: props.actionState.doneActions.includes("collection")
							? {
									backgroundColor: withAlpha(props.accentColor, 0.12),
									color: props.accentColor,
								}
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
	isExpanded: boolean;
	accentColor: string;
	providerName: string;
	onBacklog: () => void;
	onSaveLog: () => void;
	item: SearchResultItem;
	onSaveReview: () => void;
	isLifecycleLoading: boolean;
	onToggleActions: () => void;
	addError: string | undefined;
	primaryAction: "add" | "backlog";
	lifecycleErrorMessage: string | null;
	actionState: SearchResultRowActionState;
	onTogglePanel: (panel: "log" | "rate" | "collection") => void;
	addStatus: "idle" | "loading" | "done" | "error" | "partial_error";
	onSaveCollection: () => void;
	canUseCollectionAction: boolean;
	collectionState: CollectionDiscoveryState;
	collectionsDestination: CollectionsDestination;
	onPatchActionState: (patch: Partial<SearchResultRowActionState>) => void;
}) {
	const t = useThemeTokens();
	const imageUrl =
		props.item.imageProperty.kind === "image"
			? (props.item.imageProperty.value?.url ?? undefined)
			: undefined;
	const isTracked = props.actionState.doneActions.includes("track");
	const isBacklogged = props.actionState.doneActions.includes("backlog");
	const isQueueMode = props.primaryAction === "backlog";
	const canUseLifecycleActions =
		!props.isLifecycleLoading && !props.lifecycleErrorMessage;

	const effectiveAddStatus: typeof props.addStatus =
		props.addStatus === "done" && props.actionState.collectionError
			? "partial_error"
			: props.addStatus;

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
			<Group justify="space-between" align="center" wrap="nowrap">
				<Group gap="md" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
					<EntityThumbnail
						width={48}
						height={68}
						iconSize={16}
						imageUrl={imageUrl}
					/>
					<Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
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
					</Stack>
				</Group>
				<Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
					{isQueueMode ? (
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
											backgroundColor: "var(--mantine-color-green-0)",
											color: "var(--mantine-color-green-7)",
										}
									: {
											backgroundColor: props.accentColor,
											color: "white",
										}
							}
						>
							{isBacklogged ? "Queued" : "Queue"}
						</Button>
					) : (
						<Button
							size="compact-sm"
							onClick={props.onAdd}
							variant={
								effectiveAddStatus === "partial_error"
									? "light"
									: isTracked
										? "light"
										: "filled"
							}
							loading={props.actionState.pendingAction === "add"}
							disabled={
								(isTracked && effectiveAddStatus !== "partial_error") ||
								(isWorking && props.actionState.pendingAction !== "add")
							}
							leftSection={
								props.actionState.pendingAction ===
								"add" ? undefined : isTracked ? (
									<CheckCircle size={14} />
								) : (
									<Plus size={14} />
								)
							}
							style={
								isTracked && effectiveAddStatus !== "partial_error"
									? {
											backgroundColor: "var(--mantine-color-green-0)",
											color: "var(--mantine-color-green-7)",
										}
									: {
											backgroundColor: props.accentColor,
											color: "white",
										}
							}
						>
							{isTracked ? "Added" : "Add"}
						</Button>
					)}
					<Button
						size="compact-sm"
						disabled={isWorking}
						onClick={props.onToggleActions}
						variant={props.isExpanded ? "light" : "subtle"}
					>
						{props.isExpanded ? "Hide options" : "More options"}
					</Button>
				</Group>
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
					{effectiveAddStatus === "partial_error" ? (
						<Badge
							size="xs"
							variant="light"
							color="orange"
							style={{
								backgroundColor: "var(--mantine-color-orange-0)",
								color: "var(--mantine-color-orange-7)",
							}}
						>
							Collection failed
						</Badge>
					) : null}
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
								onPatchActionState={props.onPatchActionState}
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
								actionState={props.actionState}
								accentColor={props.accentColor}
								collectionState={props.collectionState}
								collectionsDestination={props.collectionsDestination}
								onSaveCollection={props.onSaveCollection}
								onPatchActionState={props.onPatchActionState}
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
