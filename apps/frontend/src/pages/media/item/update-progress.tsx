import { APP_ROUTES } from "@/lib/constants";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Verb, getVerb } from "@/lib/utilities";
import {
	Alert,
	Autocomplete,
	Button,
	Checkbox,
	Container,
	Group,
	LoadingOverlay,
	Select,
	Stack,
	Title,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import "@mantine/dates/styles.css";
import { notifications } from "@mantine/notifications";
import {
	BulkProgressUpdateDocument,
	MediaAdditionalDetailsDocument,
	MediaMainDetailsDocument,
	MetadataLot,
	ProgressUpdateDocument,
	type ProgressUpdateMutationVariables,
} from "@ryot/generated/graphql/backend/graphql";
import { IconAlertCircle } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import Head from "next/head";
import { useRouter } from "next/router";
import { type ReactElement, useState } from "react";
import invariant from "tiny-invariant";
import { withQuery } from "ufo";
import type { NextPageWithLayout } from "../../_app";

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const metadataId = parseInt(router.query.id?.toString() || "0");
	const completeShow = !!router.query.completeShow;
	const completePodcast = !!router.query.completePodcast;
	const onlySeason = !!router.query.onlySeason;

	const [selectedShowSeasonNumber, setSelectedShowSeasonNumber] = useState<
		string | null
	>(router.query.selectedShowSeasonNumber?.toString() || null);
	const [selectedShowEpisodeNumber, setSelectedShowEpisodeNumber] = useState<
		string | null
	>(router.query.selectedShowEpisodeNumber?.toString() || null);
	const [selectedPodcastEpisodeNumber, setSelectedPodcastEpisodeNumber] =
		useState<string | null>(
			router.query.selectedPodcastEpisodeNumber?.toString() || null,
		);
	const [selectedDate, setSelectedDate] = useState<Date | null>(null);
	const [allSeasonsBefore, setAllSeasonsBefore] = useState(false);

	const mediaDetails = useQuery({
		queryKey: ["details", metadataId],
		queryFn: async () => {
			const { mediaDetails } = await gqlClient.request(
				MediaMainDetailsDocument,
				{
					metadataId: metadataId,
				},
			);
			return mediaDetails;
		},
	});
	const mediaSpecifics = useQuery({
		queryKey: ["details", metadataId],
		queryFn: async () => {
			const { mediaDetails } = await gqlClient.request(
				MediaAdditionalDetailsDocument,
				{
					metadataId: metadataId,
				},
			);
			return mediaDetails;
		},
	});
	const progressUpdate = useMutation({
		mutationFn: async (variables: ProgressUpdateMutationVariables) => {
			const updates = [];
			if (completeShow) {
				for (const season of mediaSpecifics.data?.showSpecifics?.seasons ||
					[]) {
					for (const episode of season.episodes) {
						updates.push({
							...variables.input,
							showSeasonNumber: season.seasonNumber,
							showEpisodeNumber: episode.episodeNumber,
						});
					}
				}
			}
			if (completePodcast) {
				for (const episode of mediaSpecifics.data?.podcastSpecifics?.episodes ||
					[]) {
					updates.push({
						...variables.input,
						podcastEpisodeNumber: episode.number,
					});
				}
			}
			if (onlySeason) {
				const selectedSeason = mediaSpecifics.data?.showSpecifics?.seasons.find(
					(s) => s.seasonNumber.toString() === selectedShowSeasonNumber,
				);
				invariant(selectedSeason, "No season selected");
				if (allSeasonsBefore) {
					for (const season of mediaSpecifics.data?.showSpecifics?.seasons ||
						[]) {
						if (season.seasonNumber > selectedSeason.seasonNumber) break;
						for (const episode of season.episodes || []) {
							updates.push({
								...variables.input,
								showSeasonNumber: season.seasonNumber,
								showEpisodeNumber: episode.episodeNumber,
							});
						}
					}
				} else {
					for (const episode of selectedSeason?.episodes || []) {
						updates.push({
							...variables.input,
							showEpisodeNumber: episode.episodeNumber,
						});
					}
				}
			}
			if (updates.length > 0) {
				await gqlClient.request(BulkProgressUpdateDocument, { input: updates });
				return true;
			}
			if (
				(mediaDetails.data?.lot === MetadataLot.Show &&
					(!selectedShowEpisodeNumber || !selectedShowSeasonNumber)) ||
				(mediaDetails.data?.lot === MetadataLot.Podcast &&
					!selectedPodcastEpisodeNumber)
			) {
				notifications.show({ message: "Please select a season and episode" });
				return false;
			}
			const { progressUpdate } = await gqlClient.request(
				ProgressUpdateDocument,
				variables,
			);
			return progressUpdate;
		},
		onSuccess: (data) => {
			if (data) {
				if (router.query.next) router.push(router.query.next.toString());
				else
					router.replace(
						withQuery(APP_ROUTES.media.individualMediaItem.details, {
							id: metadataId,
						}),
					);
			}
		},
	});

	const title = mediaDetails.data?.title;

	const mutationInput = {
		metadataId: metadataId || 0,
		progress: 100,
		showEpisodeNumber: Number(selectedShowEpisodeNumber),
		showSeasonNumber: Number(selectedShowSeasonNumber),
		podcastEpisodeNumber: Number(selectedPodcastEpisodeNumber),
	};

	return mediaDetails.data && mediaSpecifics.data && title ? (
		<>
			<Head>
				<title>Update Progress | Ryot</title>
			</Head>
			<Container size={"xs"}>
				<Stack pos={"relative"} p="sm">
					<LoadingOverlay
						visible={progressUpdate.isLoading}
						overlayProps={{ blur: 2, radius: "md" }}
					/>
					<Title>{title}</Title>
					{mediaSpecifics.data.showSpecifics ? (
						<>
							{onlySeason || completeShow ? (
								<Alert color="yellow" icon={<IconAlertCircle size="1rem" />}>
									{onlySeason
										? `This will mark all episodes of season ${selectedShowSeasonNumber} as seen`
										: completeShow
										? "This will mark all episodes for this show as seen"
										: undefined}
								</Alert>
							) : undefined}
							{!completeShow ? (
								<>
									<Title order={6}>
										Select season{onlySeason ? "" : " and episode"}
									</Title>
									<Select
										label="Season"
										data={mediaSpecifics.data.showSpecifics.seasons.map(
											(s) => ({
												label: `${s.seasonNumber}. ${s.name.toString()}`,
												value: s.seasonNumber.toString(),
											}),
										)}
										onChange={setSelectedShowSeasonNumber}
										defaultValue={selectedShowSeasonNumber}
									/>
								</>
							) : undefined}
							{onlySeason ? (
								<Checkbox
									label="Mark all seasons before this as seen"
									onChange={(e) => setAllSeasonsBefore(e.target.checked)}
								/>
							) : undefined}
							{!onlySeason && selectedShowSeasonNumber ? (
								<Select
									label="Episode"
									data={
										mediaSpecifics.data.showSpecifics.seasons
											.find(
												(s) =>
													s.seasonNumber === Number(selectedShowSeasonNumber),
											)
											?.episodes.map((e) => ({
												label: `${e.episodeNumber}. ${e.name.toString()}`,
												value: e.episodeNumber.toString(),
											})) || []
									}
									onChange={setSelectedShowEpisodeNumber}
									defaultValue={selectedShowEpisodeNumber}
								/>
							) : undefined}
						</>
					) : undefined}
					{mediaSpecifics.data.podcastSpecifics ? (
						completePodcast ? (
							<Alert color="yellow" icon={<IconAlertCircle size="1rem" />}>
								This will mark all episodes for this podcast as seen
							</Alert>
						) : (
							<>
								<Title order={6}>Select episode</Title>
								<Autocomplete
									label="Episode"
									data={mediaSpecifics.data.podcastSpecifics.episodes.map(
										(se) => ({
											label: se.title.toString(),
											value: se.number.toString(),
										}),
									)}
									onChange={setSelectedPodcastEpisodeNumber}
									defaultValue={selectedPodcastEpisodeNumber || undefined}
								/>
							</>
						)
					) : undefined}
					<Title order={6}>
						When did you {getVerb(Verb.Read, mediaDetails.data.lot)} it?
					</Title>
					<Button
						variant="outline"
						onClick={async () => {
							await progressUpdate.mutateAsync({
								input: {
									...mutationInput,
									date: DateTime.now().toISODate(),
								},
							});
						}}
					>
						Now
					</Button>
					<Button
						variant="outline"
						onClick={async () => {
							await progressUpdate.mutateAsync({ input: mutationInput });
						}}
					>
						I do not remember
					</Button>
					<Group grow>
						<DatePickerInput
							dropdownType="modal"
							maxDate={new Date()}
							onChange={setSelectedDate}
							clearable
						/>
						<Button
							variant="outline"
							disabled={selectedDate === null}
							onClick={async () => {
								if (selectedDate)
									await progressUpdate.mutateAsync({
										input: {
											...mutationInput,
											date: DateTime.fromJSDate(selectedDate).toISODate(),
										},
									});
							}}
						>
							Custom date
						</Button>
					</Group>
				</Stack>
			</Container>
		</>
	) : (
		<LoadingPage />
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
