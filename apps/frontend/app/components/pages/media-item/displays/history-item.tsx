import {
	ActionIcon,
	Anchor,
	Flex,
	SimpleGrid,
	Stack,
	Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	changeCase,
	humanizeDuration,
	isInteger,
	isNumber,
	isString,
} from "@ryot/ts-utils";
import { IconBubble, IconEdit, IconX } from "@tabler/icons-react";
import type { HumanizeDurationOptions } from "humanize-duration-ts";
import { Fragment, type ReactNode, type RefObject } from "react";
import { Form } from "react-router";
import type { VirtuosoHandle } from "react-virtuoso";
import { withQuery } from "ufo";
import { PRO_REQUIRED_MESSAGE } from "~/lib/shared/constants";
import { dayjsLib } from "~/lib/shared/date-utils";
import { useConfirmSubmit, useCoreDetails } from "~/lib/shared/hooks";
import { refreshEntityDetails } from "~/lib/shared/query-factory";
import { openConfirmationModal } from "~/lib/shared/ui-utils";
import { EditHistoryItemModal } from "../modals/edit-history-modal";
import type { History, MetadataDetails, UserMetadataDetails } from "../types";

export const HistoryItem = (props: {
	index: number;
	history: History;
	setTab: (tab: string) => void;
	metadataDetails: MetadataDetails;
	userMetadataDetails: UserMetadataDetails;
	podcastVirtuosoRef: RefObject<VirtuosoHandle>;
	reviewsVirtuosoRef: RefObject<VirtuosoHandle>;
}) => {
	const coreDetails = useCoreDetails();
	const submit = useConfirmSubmit();
	const [opened, { open, close }] = useDisclosure(false);
	const showExtraInformation = props.history.showExtraInformation
		? props.metadataDetails.showSpecifics?.seasons
				.find(
					(s) => s.seasonNumber === props.history.showExtraInformation?.season,
				)
				?.episodes.find(
					(e) =>
						e.episodeNumber === props.history.showExtraInformation?.episode,
				)
		: null;
	const scrollToVirtuosoElement = (
		ref: RefObject<VirtuosoHandle>,
		tab: string,
		index?: number,
	) => {
		if (!coreDetails.isServerKeyValidated) {
			notifications.show({
				color: "red",
				message: PRO_REQUIRED_MESSAGE,
			});
			return;
		}
		props.setTab(tab);
		if (!isNumber(index)) return;
		setTimeout(() => {
			const current = ref.current;
			current?.scrollToIndex({ index, behavior: "smooth", align: "start" });
		}, 500);
	};
	const displayShowExtraInformation = showExtraInformation
		? `S${props.history.showExtraInformation?.season}-E${props.history.showExtraInformation?.episode}: ${showExtraInformation.name}`
		: null;
	const podcastExtraInformation = props.history.podcastExtraInformation
		? props.metadataDetails.podcastSpecifics?.episodes.find(
				(e) => e.number === props.history.podcastExtraInformation?.episode,
			)
		: null;
	const displayPodcastExtraInformation = podcastExtraInformation ? (
		<Anchor
			onClick={() =>
				scrollToVirtuosoElement(
					props.podcastVirtuosoRef,
					"podcastEpisodes",
					props.metadataDetails.podcastSpecifics?.episodes.findIndex(
						(e) => e.number === podcastExtraInformation.number,
					),
				)
			}
		>
			EP-{props.history.podcastExtraInformation?.episode}:{" "}
			{podcastExtraInformation.title}
		</Anchor>
	) : null;
	const displayAnimeExtraInformation = isNumber(
		props.history.animeExtraInformation?.episode,
	)
		? `EP-${props.history.animeExtraInformation.episode}`
		: null;
	const displayMangaExtraInformation = (() => {
		const { chapter, volume } = props.history.mangaExtraInformation || {};

		if (chapter != null) {
			const chapterNum = isString(chapter)
				? Number.parseFloat(chapter)
				: chapter;

			if (!Number.isNaN(chapterNum)) {
				const isWholeNumber = isInteger(chapterNum);
				return `CH-${isWholeNumber ? Math.floor(chapterNum) : chapterNum}`;
			}
		}

		if (isNumber(volume)) return `VOL-${volume}`;

		return null;
	})();
	const watchedOnInformation = props.history.providerWatchedOn;

	const filteredDisplayInformation = [
		watchedOnInformation,
		displayShowExtraInformation,
		displayPodcastExtraInformation,
		displayAnimeExtraInformation,
		displayMangaExtraInformation,
	].filter((s) => s !== null);
	const displayAllInformation =
		filteredDisplayInformation.length > 0
			? filteredDisplayInformation
					.map<ReactNode>((s, i) => <Fragment key={i.toString()}>{s}</Fragment>)
					.reduce((prev, curr) => [prev, " • ", curr])
			: null;

	const timeSpentInMilliseconds =
		(props.history.manualTimeSpent
			? Number(props.history.manualTimeSpent)
			: 0) * 1000;
	const units = ["mo", "d", "h"] as HumanizeDurationOptions["units"];
	const isLessThanAnHour =
		timeSpentInMilliseconds < dayjsLib.duration(1, "hour").asMilliseconds();
	if (isLessThanAnHour) units?.push("m");

	return (
		<>
			<Flex
				mb="sm"
				key={props.history.id}
				data-seen-id={props.history.id}
				gap={{ base: "xs", md: "lg", xl: "xl" }}
				mt={props.index === 0 ? undefined : "sm"}
				data-seen-num-times-updated={props.history.numTimesUpdated}
			>
				<Flex direction="column" justify="center">
					<Form
						replace
						method="POST"
						action={withQuery(".", { intent: "deleteSeenItem" })}
					>
						<input hidden name="seenId" defaultValue={props.history.id} />
						<ActionIcon
							color="red"
							type="submit"
							onClick={(e) => {
								const form = e.currentTarget.form;
								e.preventDefault();
								openConfirmationModal(
									"Are you sure you want to delete this record from history?",
									() => {
										submit(form);
										refreshEntityDetails(props.metadataDetails.id);
									},
								);
							}}
						>
							<IconX size={20} />
						</ActionIcon>
					</Form>
					<ActionIcon color="blue" onClick={open}>
						<IconEdit size={20} />
					</ActionIcon>
				</Flex>
				<Stack gap={4}>
					<Flex gap="lg" align="center">
						<Text fw="bold">
							{changeCase(props.history.state)}{" "}
							{props.history.progress !== "100"
								? `(${Number(props.history.progress).toFixed(2)}%)`
								: null}
						</Text>
						{props.history.reviewId ? (
							<ActionIcon
								size="xs"
								color="blue"
								onClick={() => {
									scrollToVirtuosoElement(
										props.reviewsVirtuosoRef,
										"reviews",
										props.userMetadataDetails.reviews.findIndex(
											(r) => r.id === props.history.reviewId,
										),
									);
								}}
							>
								<IconBubble />
							</ActionIcon>
						) : null}
						{displayAllInformation ? (
							<Text c="dimmed" size="sm" lineClamp={1}>
								{displayAllInformation}
							</Text>
						) : null}
					</Flex>
					<SimpleGrid
						spacing="md"
						verticalSpacing={2}
						cols={{ base: 1, md: 2 }}
					>
						<Flex gap="xs">
							<Text size="sm">Started:</Text>
							<Text size="sm" fw="bold">
								{props.history.startedOn
									? dayjsLib(props.history.startedOn).format("L")
									: "N/A"}
							</Text>
						</Flex>
						<Flex gap="xs">
							<Text size="sm">Ended:</Text>
							<Text size="sm" fw="bold">
								{props.history.finishedOn
									? dayjsLib(props.history.finishedOn).format("L")
									: "N/A"}
							</Text>
						</Flex>
						{timeSpentInMilliseconds ? (
							<Flex gap="xs">
								<Text size="sm">Time:</Text>
								<Text size="sm" fw="bold">
									{humanizeDuration(timeSpentInMilliseconds, {
										round: true,
										units,
									})}
								</Text>
							</Flex>
						) : null}
						<Flex gap="xs">
							<Text size="sm">Updated:</Text>
							<Text size="sm" fw="bold">
								{dayjsLib(props.history.lastUpdatedOn).format("L")}
							</Text>
						</Flex>
					</SimpleGrid>
				</Stack>
			</Flex>
			<EditHistoryItemModal
				opened={opened}
				onClose={close}
				seen={props.history}
				metadataDetails={props.metadataDetails}
				userMetadataDetails={props.userMetadataDetails}
			/>
		</>
	);
};
