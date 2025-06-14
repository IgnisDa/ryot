import {
	ActionIcon,
	Box,
	Button,
	Group,
	Loader,
	Select,
	Stack,
	Text,
	Textarea,
	TextInput,
} from "@mantine/core";
import { Star } from "lucide-react";
import type { CollectionDiscoveryState } from "~/features/collections";
import type { MediaSearchLogDateOption } from "./search-modal-media-actions";
import type { SearchResultRowActionState } from "./search-result-row";

const logDateOptions: Array<{
	label: string;
	value: MediaSearchLogDateOption;
}> = [
	{ value: "now", label: "Just now" },
	{ value: "unknown", label: "I don't remember" },
	{ value: "custom", label: "Pick a date & time" },
	{ value: "started", label: "Just started" },
];

export function SearchResultLogPanel(props: {
	border: string;
	textMuted: string;
	accentColor: string;
	onSaveLog: () => void;
	actionState: SearchResultRowActionState;
	onPatchActionState: (patch: Partial<SearchResultRowActionState>) => void;
}) {
	return (
		<Box mt="xs" pt="sm" style={{ borderTop: `1px solid ${props.border}` }}>
			<Text fz="xs" fw={500} c={props.textMuted} mb={6}>
				When?
			</Text>
			<Group gap={4} mb="sm" wrap="wrap">
				{logDateOptions.map((option) => (
					<Button
						key={option.value}
						size="compact-xs"
						onClick={() => props.onPatchActionState({ logDate: option.value })}
						variant={
							props.actionState.logDate === option.value ? "filled" : "subtle"
						}
						style={
							props.actionState.logDate === option.value
								? { backgroundColor: props.accentColor, color: "white" }
								: undefined
						}
					>
						{option.label}
					</Button>
				))}
			</Group>

			{props.actionState.logDate === "custom" ? (
				<Stack gap="xs" mb="sm">
					<TextInput
						size="xs"
						label="Started on"
						type="datetime-local"
						value={props.actionState.logStartedOn}
						onChange={(event) =>
							props.onPatchActionState({
								logStartedOn: event.currentTarget.value,
							})
						}
					/>
					<TextInput
						required
						size="xs"
						label="Completed on"
						type="datetime-local"
						value={props.actionState.logCompletedOn}
						onChange={(event) =>
							props.onPatchActionState({
								logCompletedOn: event.currentTarget.value,
							})
						}
					/>
				</Stack>
			) : null}

			<Group gap="xs">
				<Button
					size="compact-xs"
					onClick={props.onSaveLog}
					style={{ backgroundColor: props.accentColor, color: "white" }}
					disabled={
						props.actionState.logDate === "custom" &&
						!props.actionState.logCompletedOn
					}
				>
					Save
				</Button>
				<Button
					variant="subtle"
					size="compact-xs"
					onClick={() => props.onPatchActionState({ openPanel: null })}
				>
					Cancel
				</Button>
			</Group>
		</Box>
	);
}

export function SearchResultReviewPanel(props: {
	actionState: SearchResultRowActionState;
	accentColor: string;
	border: string;
	onPatchActionState: (patch: Partial<SearchResultRowActionState>) => void;
	onSaveReview: () => void;
	textMuted: string;
}) {
	return (
		<Box mt="xs" pt="sm" style={{ borderTop: `1px solid ${props.border}` }}>
			<Text fz="xs" fw={500} c={props.textMuted} mb={6}>
				Rating
			</Text>
			<Group gap={2} mb="sm">
				{[1, 2, 3, 4, 5].map((star) => (
					<ActionIcon
						key={star}
						size="sm"
						variant="transparent"
						onMouseEnter={() =>
							props.onPatchActionState({ rateStarsHover: star })
						}
						onMouseLeave={() => props.onPatchActionState({ rateStarsHover: 0 })}
						onClick={() =>
							props.onPatchActionState({
								rateStars: props.actionState.rateStars === star ? 0 : star,
							})
						}
					>
						<Star
							size={20}
							color={props.accentColor}
							fill={
								star <=
								(props.actionState.rateStarsHover ||
									props.actionState.rateStars)
									? props.accentColor
									: "transparent"
							}
						/>
					</ActionIcon>
				))}
				{props.actionState.rateStars > 0 ? (
					<Text
						fz="sm"
						fw={600}
						c={props.accentColor}
						ff="var(--mantine-font-family-monospace)"
						ml={4}
					>
						{props.actionState.rateStars}/5
					</Text>
				) : null}
			</Group>
			<Textarea
				size="xs"
				mb="sm"
				autosize
				minRows={2}
				maxRows={4}
				placeholder="Write a review (optional)..."
				value={props.actionState.rateReview}
				onChange={(event) =>
					props.onPatchActionState({ rateReview: event.currentTarget.value })
				}
			/>
			<Group gap="xs">
				<Button
					size="compact-xs"
					disabled={!props.actionState.rateStars}
					style={{ backgroundColor: props.accentColor, color: "white" }}
					onClick={props.onSaveReview}
				>
					Save
				</Button>
				<Button
					size="compact-xs"
					variant="subtle"
					onClick={() => props.onPatchActionState({ openPanel: null })}
				>
					Cancel
				</Button>
			</Group>
		</Box>
	);
}

export function SearchResultCollectionPanel(props: {
	border: string;
	textMuted: string;
	actionState: SearchResultRowActionState;
	accentColor: string;
	collectionState: CollectionDiscoveryState;
	collectionsDestination: { type: "view"; viewId: string } | { type: "none" };
	onSaveCollection: () => void;
	onPatchActionState: (patch: Partial<SearchResultRowActionState>) => void;
}) {
	const hasSelectedCollection = props.actionState.selectedCollectionId !== null;

	if (props.collectionState.type === "loading") {
		return (
			<Box mt="xs" pt="sm" style={{ borderTop: `1px solid ${props.border}` }}>
				<Group gap="xs">
					<Loader size="xs" color={props.accentColor} />
					<Text fz="xs" c={props.textMuted}>
						Loading collections...
					</Text>
				</Group>
			</Box>
		);
	}

	if (props.collectionState.type === "empty") {
		return (
			<Box mt="xs" pt="sm" style={{ borderTop: `1px solid ${props.border}` }}>
				<Stack gap="xs">
					<Text fz="xs" c={props.textMuted}>
						No collections available. Create a collection to add this item.
					</Text>
					{props.collectionsDestination.type === "view" ? (
						<Button
							href={`/views/${props.collectionsDestination.viewId}`}
							size="compact-xs"
							variant="subtle"
							component="a"
						>
							Go to Collections
						</Button>
					) : null}
					<Button
						size="compact-xs"
						variant="subtle"
						onClick={() => props.onPatchActionState({ openPanel: null })}
					>
						Close
					</Button>
				</Stack>
			</Box>
		);
	}

	const collections = props.collectionState.collections;

	return (
		<Box mt="xs" pt="sm" style={{ borderTop: `1px solid ${props.border}` }}>
			<Text fz="xs" fw={500} c={props.textMuted} mb={6}>
				Select a collection
			</Text>
			<Select
				size="xs"
				mb="sm"
				data={collections.map((c) => ({ value: c.id, label: c.name }))}
				value={props.actionState.selectedCollectionId ?? null}
				onChange={(value) =>
					props.onPatchActionState({ selectedCollectionId: value })
				}
				placeholder="Choose a collection..."
			/>

			<Group gap="xs">
				<Button
					size="compact-xs"
					disabled={!hasSelectedCollection}
					style={{ backgroundColor: props.accentColor, color: "white" }}
					onClick={props.onSaveCollection}
				>
					Save
				</Button>
				<Button
					size="compact-xs"
					variant="subtle"
					onClick={() => props.onPatchActionState({ openPanel: null })}
				>
					Cancel
				</Button>
			</Group>
		</Box>
	);
}
