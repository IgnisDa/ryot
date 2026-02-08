import {
	ActionIcon,
	Box,
	Button,
	Group,
	Loader,
	NumberInput,
	Select,
	Stack,
	Text,
	Textarea,
	TextInput,
} from "@mantine/core";
import { Star } from "lucide-react";
import {
	buildCollectionSelectionPatch,
	buildDefaultMembershipFormValues,
	buildMembershipFormSchema,
	type CollectionDiscoveryState,
	type CollectionMembershipFormValues,
	getMembershipPropertyEntries,
	getSelectedCollection,
} from "~/features/collections";
import { GeneratedPropertyField } from "~/features/generated-property-fields";
import { useAppForm } from "~/hooks/forms";
import {
	getOptionalInteger,
	getOptionalNumber,
	getPodcastEpisodes,
	getShowSeasons,
} from "./episodic-entity-utils";
import {
	type EpisodicEntitySchemaSlug,
	isEpisodicMediaEntitySchemaSlug,
	type MediaSearchLogDateOption,
} from "./search-modal-media-actions";
import type { SearchResultRowActionState } from "./search-result-row";

export type { EpisodicEntitySchemaSlug };

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
	entitySchemaSlug: string;
	propertyLoadError?: string | null;
	isLoadingEntityProperties?: boolean;
	actionState: SearchResultRowActionState;
	entityProperties?: Record<string, unknown>;
	onPatchActionState: (patch: Partial<SearchResultRowActionState>) => void;
}) {
	const isEpisodic = isEpisodicMediaEntitySchemaSlug(props.entitySchemaSlug);
	const episodicEntitySchemaSlug = isEpisodic ? props.entitySchemaSlug : null;
	const showSeasons = getShowSeasons(props.entityProperties);
	const selectedShowSeason = showSeasons.find(
		(season) => season.seasonNumber === props.actionState.showSeason,
	);
	const showSeasonOptions = showSeasons.map((season) => ({
		value: season.seasonNumber.toString(),
		label: `${season.seasonNumber}. ${season.name}`,
	}));
	const showEpisodeOptions = selectedShowSeason?.episodes.map((episode) => ({
		value: episode.number.toString(),
		label: `${episode.number}. ${episode.label}`,
	}));
	const podcastEpisodeOptions = getPodcastEpisodes(props.entityProperties).map(
		(episode) => ({
			value: episode.number.toString(),
			label: `${episode.number}. ${episode.label}`,
		}),
	);
	const animeEpisodeLimit = getOptionalInteger(
		props.entityProperties?.episodes,
	);
	const mangaChapterLimit = getOptionalNumber(props.entityProperties?.chapters);
	const mangaVolumeLimit = getOptionalInteger(props.entityProperties?.volumes);
	const isDisabled = props.isLoadingEntityProperties;
	const requiresSelection =
		isEpisodic &&
		!hasRequiredEpisodicSelection(props.entitySchemaSlug, props.actionState);

	return (
		<Box mt="xs" pt="sm" style={{ borderTop: `1px solid ${props.border}` }}>
			{props.propertyLoadError ? (
				<Text fz="xs" c="red" mb="sm">
					{props.propertyLoadError}
				</Text>
			) : null}
			{episodicEntitySchemaSlug ? (
				props.isLoadingEntityProperties ? (
					<Group gap="xs" mb="sm">
						<Loader size="xs" color={props.accentColor} />
						<Text fz="xs" c={props.textMuted}>
							Loading episode details...
						</Text>
					</Group>
				) : props.entityProperties ? (
					<EpisodicProgressFields
						textMuted={props.textMuted}
						actionState={props.actionState}
						mangaVolumeLimit={mangaVolumeLimit}
						showSeasonOptions={showSeasonOptions}
						animeEpisodeLimit={animeEpisodeLimit}
						mangaChapterLimit={mangaChapterLimit}
						podcastEpisodeOptions={podcastEpisodeOptions}
						showEpisodeOptions={showEpisodeOptions ?? []}
						onPatchActionState={props.onPatchActionState}
						entitySchemaSlug={
							episodicEntitySchemaSlug as EpisodicEntitySchemaSlug
						}
					/>
				) : null
			) : null}

			<Text fz="xs" fw={500} c={props.textMuted} mb={6}>
				When?
			</Text>
			<Group gap={4} mb="sm" wrap="wrap">
				{logDateOptions
					.filter((option) => (option.value === "custom" ? !isEpisodic : true))
					.map((option) => (
						<Button
							size="compact-xs"
							key={option.value}
							onClick={() =>
								props.onPatchActionState({ logDate: option.value })
							}
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
						(props.actionState.logDate === "custom" &&
							!props.actionState.logCompletedOn) ||
						requiresSelection ||
						!!props.propertyLoadError ||
						isDisabled
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

export function EpisodicProgressFields(props: {
	textMuted: string;
	mangaVolumeLimit: number | undefined;
	animeEpisodeLimit: number | undefined;
	mangaChapterLimit: number | undefined;
	actionState: SearchResultRowActionState;
	entitySchemaSlug: EpisodicEntitySchemaSlug;
	showSeasonOptions: Array<{ value: string; label: string }>;
	showEpisodeOptions: Array<{ value: string; label: string }>;
	podcastEpisodeOptions: Array<{ value: string; label: string }>;
	onPatchActionState: (patch: Partial<SearchResultRowActionState>) => void;
}) {
	return (
		<Stack gap="xs" mb="sm">
			<Text fz="xs" fw={500} c={props.textMuted}>
				What did you log?
			</Text>
			{props.entitySchemaSlug === "show" ? (
				<>
					<Select
						required
						size="xs"
						searchable
						limit={50}
						label="Season"
						data={props.showSeasonOptions}
						value={toSelectValue(props.actionState.showSeason)}
						onChange={(value) =>
							props.onPatchActionState({
								showSeason: value ? Number(value) : "",
								showEpisode: "",
							})
						}
					/>
					<Select
						required
						size="xs"
						searchable
						limit={50}
						label="Episode"
						data={props.showEpisodeOptions}
						value={toSelectValue(props.actionState.showEpisode)}
						disabled={props.actionState.showSeason === ""}
						onChange={(value) =>
							props.onPatchActionState({
								showEpisode: value ? Number(value) : "",
							})
						}
					/>
				</>
			) : null}
			{props.entitySchemaSlug === "podcast" ? (
				<Select
					required
					size="xs"
					searchable
					limit={50}
					label="Episode"
					data={props.podcastEpisodeOptions}
					value={toSelectValue(props.actionState.podcastEpisode)}
					onChange={(value) =>
						props.onPatchActionState({
							podcastEpisode: value ? Number(value) : "",
						})
					}
				/>
			) : null}
			{props.entitySchemaSlug === "anime" ? (
				<NumberInput
					min={1}
					required
					size="xs"
					hideControls
					label="Episode"
					allowDecimal={false}
					value={props.actionState.animeEpisode}
					max={props.animeEpisodeLimit}
					onChange={(value) =>
						props.onPatchActionState({
							animeEpisode: toNumberInputValue(value),
						})
					}
				/>
			) : null}
			{props.entitySchemaSlug === "manga" ? (
				<>
					<NumberInput
						min={1}
						required
						size="xs"
						hideControls
						label="Chapter"
						max={props.mangaChapterLimit}
						value={props.actionState.mangaChapter}
						onChange={(value) =>
							props.onPatchActionState({
								mangaChapter: toNumberInputValue(value),
							})
						}
					/>
					<NumberInput
						min={1}
						size="xs"
						hideControls
						allowDecimal={false}
						label="Volume (optional)"
						max={props.mangaVolumeLimit}
						value={props.actionState.mangaVolume}
						onChange={(value) =>
							props.onPatchActionState({
								mangaVolume: toNumberInputValue(value),
							})
						}
					/>
				</>
			) : null}
		</Stack>
	);
}

function hasRequiredEpisodicSelection(
	entitySchemaSlug: string,
	actionState: SearchResultRowActionState,
) {
	if (!isEpisodicMediaEntitySchemaSlug(entitySchemaSlug)) {
		return true;
	}
	if (entitySchemaSlug === "show") {
		return actionState.showSeason !== "" && actionState.showEpisode !== "";
	}
	if (entitySchemaSlug === "anime") {
		return actionState.animeEpisode !== "";
	}
	if (entitySchemaSlug === "manga") {
		return actionState.mangaChapter !== "";
	}
	return actionState.podcastEpisode !== "";
}

function toSelectValue(value: number | "") {
	return value === "" ? null : value.toString();
}

function toNumberInputValue(value: string | number) {
	if (typeof value === "number") {
		return Number.isNaN(value) ? "" : value;
	}
	if (value.trim() === "") {
		return "";
	}
	const numericValue = Number(value);
	return Number.isNaN(numericValue) ? "" : numericValue;
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
	accentColor: string;
	isEnsuringEntity: boolean;
	onRetryCollectionDiscovery: () => void;
	collectionState: CollectionDiscoveryState;
	onPatchActionState: (patch: Partial<SearchResultRowActionState>) => void;
	collectionsDestination: { type: "view"; viewId: string } | { type: "none" };
	onSaveCollection: (
		values: CollectionMembershipFormValues,
	) => Promise<void> | void;
}) {
	const isDisabled = props.isEnsuringEntity;
	const collections =
		props.collectionState.type === "collections"
			? props.collectionState.collections
			: [];
	const defaultCollection = getSelectedCollection(collections);
	const form = useAppForm({
		defaultValues: buildDefaultMembershipFormValues(defaultCollection),
		validators: {
			onChange: buildMembershipFormSchema(collections) as never,
		},
		onSubmit: async ({ value }) => await props.onSaveCollection(value),
	});

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

	if (props.collectionState.type === "error") {
		return (
			<Box mt="xs" pt="sm" style={{ borderTop: `1px solid ${props.border}` }}>
				<Stack gap="xs">
					<Text fz="xs" c="red">
						Could not load collections.
					</Text>
					<Group gap="xs">
						<Button
							variant="subtle"
							size="compact-xs"
							onClick={props.onRetryCollectionDiscovery}
						>
							Retry
						</Button>
						<Button
							variant="subtle"
							size="compact-xs"
							onClick={() => props.onPatchActionState({ openPanel: null })}
						>
							Close
						</Button>
					</Group>
				</Stack>
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

	return (
		<Box mt="xs" pt="sm" style={{ borderTop: `1px solid ${props.border}` }}>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void form.handleSubmit();
				}}
			>
				<form.AppForm>
					<form.Subscribe selector={(state) => state.values}>
						{(values) => {
							const selectedCollection = collections.find(
								(collection) => collection.id === values.collectionId,
							);
							const propertyEntries = getMembershipPropertyEntries(
								selectedCollection?.membershipPropertiesSchema,
							);
							const validationResult =
								buildMembershipFormSchema(collections).safeParse(values);
							const validationMessage = validationResult.success
								? null
								: (validationResult.error.issues[0]?.message ??
									"Collection details are invalid.");
							const canSave = !isDisabled && validationResult.success;

							return (
								<>
									<Text fz="xs" fw={500} c={props.textMuted} mb={6}>
										Select a collection
									</Text>
									<form.AppField
										name="collectionId"
										listeners={{
											onChange: ({ value }) => {
												const nextCollection = collections.find(
													(collection) => collection.id === value,
												);
												const nextValues = buildCollectionSelectionPatch(
													nextCollection,
													{
														collectionId: value,
														properties: form.state.values.properties,
													},
												);

												form.setFieldValue("properties", nextValues.properties);
												if (nextValues.collectionId !== value) {
													form.setFieldValue(
														"collectionId",
														nextValues.collectionId,
													);
												}
											},
										}}
									>
										{(field) => (
											<Stack gap={4} mb="sm">
												<Select
													size="xs"
													disabled={isDisabled}
													onBlur={field.handleBlur}
													value={field.state.value || null}
													placeholder="Choose a collection..."
													onChange={(value) => field.handleChange(value ?? "")}
													data={collections.map((c) => ({
														value: c.id,
														label: c.name,
													}))}
												/>
												{!field.state.meta.isValid ? (
													<Text c="red" size="xs">
														{field.state.meta.errors.map(String).join(", ")}
													</Text>
												) : null}
											</Stack>
										)}
									</form.AppField>

									{selectedCollection && propertyEntries.length > 0 ? (
										<Stack gap="xs" mb="sm">
											{propertyEntries.map(({ key, definition }) => (
												<GeneratedPropertyField
													key={key}
													form={form}
													propertyKey={key}
													disabled={isDisabled}
													propertyDef={definition}
												/>
											))}
										</Stack>
									) : null}

									{values.collectionId && validationMessage ? (
										<Text c="red" fz="xs" mb="sm">
											{validationMessage}
										</Text>
									) : null}

									<Group gap="xs">
										<Button
											type="submit"
											size="compact-xs"
											disabled={!canSave}
											loading={props.isEnsuringEntity}
											style={{
												color: "white",
												backgroundColor: props.accentColor,
											}}
										>
											Save
										</Button>
										<Button
											type="button"
											variant="subtle"
											size="compact-xs"
											disabled={isDisabled}
											onClick={() =>
												props.onPatchActionState({ openPanel: null })
											}
										>
											Cancel
										</Button>
									</Group>
								</>
							);
						}}
					</form.Subscribe>
				</form.AppForm>
			</form>
		</Box>
	);
}
