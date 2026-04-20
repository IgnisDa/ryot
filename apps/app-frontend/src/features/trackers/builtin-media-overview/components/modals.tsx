import { Button, Group, NumberInput, Stack } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useState } from "react";
import {
	getOptionalInteger,
	getOptionalNumber,
	getPodcastEpisodes,
	getShowSeasons,
} from "~/features/entities/episodic-entity-utils";
import { useEntityQuery } from "~/features/entities/hooks";
import {
	createLogEventPayload,
	createProgressEventPayload,
	type EpisodicEntitySchemaSlug,
	isEpisodicMediaEntitySchemaSlug,
	type MediaSearchLogDateOption,
} from "~/features/entities/search-modal-media-actions";
import {
	defaultSearchResultRowActionState,
	type SearchResultRowActionState,
} from "~/features/entities/search-result-row";
import {
	EpisodicProgressFields,
	SearchResultLogPanel,
} from "~/features/entities/search-result-row-panels";
import { useEventSchemasQuery } from "~/features/event-schemas/hooks";
import { useApiClient } from "~/hooks/api";
import { useThemeTokens } from "~/hooks/theme";

interface ContinueLoggingModalContentProps {
	modalId: string;
	entityId: string;
	accentColor: string;
	onSaved: () => void;
	entitySchemaId: string;
	entitySchemaSlug: string;
	initialPercent: number | null;
}

export function ContinueLoggingModalContent(
	props: ContinueLoggingModalContentProps,
) {
	const apiClient = useApiClient();
	const entityQuery = useEntityQuery(props.entityId, true);
	const [progressPercent, setProgressPercent] = useState<number | string>(
		props.initialPercent ?? "",
	);
	const [actionState, setActionState] = useState<SearchResultRowActionState>(
		defaultSearchResultRowActionState,
	);
	const createEvents = apiClient.useMutation("post", "/events");
	const eventSchemasQuery = useEventSchemasQuery(
		props.entitySchemaId,
		!!props.entitySchemaId,
	);
	const episodicFieldProps = getEpisodicFieldProps(
		isEpisodicMediaEntitySchemaSlug(props.entitySchemaSlug)
			? props.entitySchemaSlug
			: null,
		actionState,
		entityQuery.entity?.properties as Record<string, unknown> | undefined,
	);

	const isValid =
		typeof progressPercent === "number" &&
		progressPercent > 0 &&
		progressPercent <= 100 &&
		(isEpisodicMediaEntitySchemaSlug(props.entitySchemaSlug) ||
			progressPercent !== props.initialPercent) &&
		hasRequiredSelection(props.entitySchemaSlug, actionState);

	const handleSave = async () => {
		try {
			const payload = createProgressEventPayload({
				entityId: props.entityId,
				progressPercent: progressPercent as number,
				showSeason:
					actionState.showSeason === "" ? undefined : actionState.showSeason,
				showEpisode:
					actionState.showEpisode === "" ? undefined : actionState.showEpisode,
				animeEpisode:
					actionState.animeEpisode === ""
						? undefined
						: actionState.animeEpisode,
				mangaChapter:
					actionState.mangaChapter === ""
						? undefined
						: actionState.mangaChapter,
				mangaVolume:
					actionState.mangaVolume === "" ? undefined : actionState.mangaVolume,
				podcastEpisode:
					actionState.podcastEpisode === ""
						? undefined
						: actionState.podcastEpisode,
				eventSchemas: eventSchemasQuery.eventSchemas,
			});
			await createEvents.mutateAsync({ body: payload });
			modals.close(props.modalId);
			props.onSaved();
		} catch (error) {
			notifications.show({
				color: "red",
				title: "Could not log progress",
				message: error instanceof Error ? error.message : "Please try again.",
			});
		}
	};

	return (
		<Stack gap="sm">
			{entityQuery.isError ? (
				<Button variant="subtle" size="compact-xs" disabled color="red">
					Could not load episode details.
				</Button>
			) : null}
			{episodicFieldProps ? (
				entityQuery.isLoading ? null : (
					<EpisodicProgressFields
						textMuted="dimmed"
						actionState={actionState}
						onPatchActionState={(patch) =>
							setActionState((current) => ({ ...current, ...patch }))
						}
						{...episodicFieldProps}
					/>
				)
			) : null}
			<NumberInput
				min={1}
				step={1}
				max={100}
				size="xs"
				suffix="%"
				label="Progress"
				value={progressPercent}
				onChange={setProgressPercent}
				description="Enter your current progress (1–100%)"
				styles={{
					input: { fontFamily: "var(--mantine-font-family-monospace)" },
				}}
			/>
			<Group gap="xs">
				<Button
					size="compact-xs"
					loading={createEvents.isPending}
					onClick={() => void handleSave()}
					style={{ backgroundColor: props.accentColor, color: "white" }}
					disabled={!isValid || createEvents.isPending || entityQuery.isError}
				>
					Save
				</Button>
				<Button
					variant="subtle"
					size="compact-xs"
					onClick={() => modals.close(props.modalId)}
				>
					Cancel
				</Button>
			</Group>
		</Stack>
	);
}

interface StartLoggingModalContentProps {
	modalId: string;
	entityId: string;
	accentColor: string;
	onSaved: () => void;
	entitySchemaId: string;
	entitySchemaSlug: string;
}

export function StartLoggingModalContent(props: StartLoggingModalContentProps) {
	const t = useThemeTokens();
	const apiClient = useApiClient();
	const entityQuery = useEntityQuery(props.entityId, true);
	const [logDate, setLogDate] = useState<MediaSearchLogDateOption>("now");
	const [logStartedOn, setLogStartedOn] = useState("");
	const [logCompletedOn, setLogCompletedOn] = useState("");
	const [episodicState, setEpisodicState] =
		useState<SearchResultRowActionState>(defaultSearchResultRowActionState);
	const createEvents = apiClient.useMutation("post", "/events");
	const eventSchemasQuery = useEventSchemasQuery(
		props.entitySchemaId,
		!!props.entitySchemaId,
	);

	const actionState: SearchResultRowActionState = {
		...defaultSearchResultRowActionState,
		...episodicState,
		logDate,
		logStartedOn,
		logCompletedOn,
		openPanel: "log",
	};

	const handlePatchActionState = (
		patch: Partial<SearchResultRowActionState>,
	) => {
		if (patch.logDate !== undefined) {
			setLogDate(patch.logDate);
		}
		if (patch.logStartedOn !== undefined) {
			setLogStartedOn(patch.logStartedOn);
		}
		if (patch.logCompletedOn !== undefined) {
			setLogCompletedOn(patch.logCompletedOn);
		}
		setEpisodicState((current) => ({ ...current, ...patch }));
		if ("openPanel" in patch && patch.openPanel === null) {
			modals.close(props.modalId);
		}
	};

	const handleSave = async () => {
		try {
			const payload = createLogEventPayload({
				logDate,
				startedOn: logStartedOn,
				entityId: props.entityId,
				completedOn: logCompletedOn,
				entitySchemaSlug: props.entitySchemaSlug,
				eventSchemas: eventSchemasQuery.eventSchemas,
				showSeason:
					actionState.showSeason === "" ? undefined : actionState.showSeason,
				showEpisode:
					actionState.showEpisode === "" ? undefined : actionState.showEpisode,
				animeEpisode:
					actionState.animeEpisode === ""
						? undefined
						: actionState.animeEpisode,
				mangaChapter:
					actionState.mangaChapter === ""
						? undefined
						: actionState.mangaChapter,
				mangaVolume:
					actionState.mangaVolume === "" ? undefined : actionState.mangaVolume,
				podcastEpisode:
					actionState.podcastEpisode === ""
						? undefined
						: actionState.podcastEpisode,
			});
			await createEvents.mutateAsync({ body: payload });
			modals.close(props.modalId);
			props.onSaved();
		} catch (error) {
			notifications.show({
				color: "red",
				title: "Could not log progress",
				message: error instanceof Error ? error.message : "Please try again.",
			});
		}
	};

	return (
		<SearchResultLogPanel
			border={t.border}
			textMuted={t.textMuted}
			actionState={actionState}
			accentColor={props.accentColor}
			onSaveLog={() => void handleSave()}
			entitySchemaSlug={props.entitySchemaSlug}
			onPatchActionState={handlePatchActionState}
			isLoadingEntityProperties={entityQuery.isLoading}
			entityProperties={
				entityQuery.entity?.properties as Record<string, unknown> | undefined
			}
			propertyLoadError={
				entityQuery.isError ? "Could not load episode details." : null
			}
		/>
	);
}

function getEpisodicFieldProps(
	entitySchemaSlug: EpisodicEntitySchemaSlug | null,
	actionState: SearchResultRowActionState,
	entityProperties?: Record<string, unknown>,
) {
	if (!entitySchemaSlug || !entityProperties) {
		return null;
	}
	const showSeasons = getShowSeasons(entityProperties);
	const selectedShowSeason = showSeasons.find(
		(season) => season.seasonNumber === actionState.showSeason,
	);
	const podcastEpisodes = getPodcastEpisodes(entityProperties);
	return {
		entitySchemaSlug,
		mangaVolumeLimit: getOptionalInteger(entityProperties.volumes),
		mangaChapterLimit: getOptionalNumber(entityProperties.chapters),
		animeEpisodeLimit: getOptionalInteger(entityProperties.episodes),
		showSeasonOptions: showSeasons.map((season) => ({
			value: season.seasonNumber.toString(),
			label: `${season.seasonNumber}. ${season.name}`,
		})),
		showEpisodeOptions: (selectedShowSeason?.episodes ?? []).map((episode) => ({
			value: episode.number.toString(),
			label: `${episode.number}. ${episode.label}`,
		})),
		podcastEpisodeOptions: podcastEpisodes.map((episode) => ({
			value: episode.number.toString(),
			label: `${episode.number}. ${episode.label}`,
		})),
	};
}

function hasRequiredSelection(
	entitySchemaSlug: string,
	actionState: SearchResultRowActionState,
) {
	if (entitySchemaSlug === "show") {
		return actionState.showSeason !== "" && actionState.showEpisode !== "";
	}
	if (entitySchemaSlug === "anime") {
		return actionState.animeEpisode !== "";
	}
	if (entitySchemaSlug === "manga") {
		return actionState.mangaChapter !== "";
	}
	if (entitySchemaSlug === "podcast") {
		return actionState.podcastEpisode !== "";
	}
	return true;
}
