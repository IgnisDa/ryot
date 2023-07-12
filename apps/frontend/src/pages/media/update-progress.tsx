import type { NextPageWithLayout } from "../_app";
import { ROUTES } from "@/lib/constants";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Verb, getVerb } from "@/lib/utilities";
import {
	Alert,
	Autocomplete,
	Button,
	Container,
	Group,
	LoadingOverlay,
	Select,
	Stack,
	Title,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { notifications } from "@mantine/notifications";
import {
	MediaDetailsDocument,
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
import { withQuery } from "ufo";

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const metadataId = parseInt(router.query.item?.toString() || "0");
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

	const mediaDetails = useQuery({
		queryKey: ["details", metadataId],
		queryFn: async () => {
			const { mediaDetails } = await gqlClient.request(MediaDetailsDocument, {
				metadataId: metadataId,
			});
			return mediaDetails;
		},
	});
	const progressUpdate = useMutation({
		mutationFn: async (variables: ProgressUpdateMutationVariables) => {
			if (completeShow) {
				for (const season of mediaDetails.data?.showSpecifics?.seasons || []) {
					for (const episode of season.episodes) {
						await gqlClient.request(ProgressUpdateDocument, {
							input: {
								...variables.input,
								showSeasonNumber: season.seasonNumber,
								showEpisodeNumber: episode.episodeNumber,
							},
						});
					}
				}
				return true;
			}
			if (completePodcast) {
				for (const episode of mediaDetails.data?.podcastSpecifics?.episodes ||
					[]) {
					await gqlClient.request(ProgressUpdateDocument, {
						input: {
							...variables.input,
							podcastEpisodeNumber: episode.number,
						},
					});
				}
				return true;
			}
			if (onlySeason) {
				for (const episode of mediaDetails.data?.showSpecifics?.seasons.find(
					(s) => s.seasonNumber.toString() === selectedShowSeasonNumber,
				)?.episodes || []) {
					await gqlClient.request(ProgressUpdateDocument, {
						input: {
							...variables.input,
							showEpisodeNumber: episode.episodeNumber,
						},
					});
				}
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
					router.push(
						withQuery(ROUTES.media.details, {
							item: metadataId,
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

	return mediaDetails.data && title ? (
		<>
			<Head>
				<title>Update Progress | Ryot</title>
			</Head>
			<Container size={"xs"}>
				<Stack pos={"relative"} p="sm">
					<LoadingOverlay
						visible={progressUpdate.isLoading}
						overlayBlur={2}
						radius={"md"}
					/>
					<Title>{title}</Title>
					{mediaDetails.data.showSpecifics ? (
						<>
							{onlySeason || completeShow ? (
								<Alert color="yellow" icon={<IconAlertCircle size="1rem" />}>
									{onlySeason
										? `This will mark all episodes of season ${selectedShowSeasonNumber} as seen`
										: completeShow
										? "This will mark all episodes for this show as seen"
										: null}
								</Alert>
							) : null}
							{!completeShow ? (
								<>
									<Title order={6}>
										Select season{onlySeason ? "" : " and episode"}
									</Title>
									<Select
										label="Season"
										data={mediaDetails.data.showSpecifics.seasons.map((s) => ({
											label: `${s.seasonNumber}. ${s.name.toString()}`,
											value: s.seasonNumber.toString(),
										}))}
										onChange={setSelectedShowSeasonNumber}
										defaultValue={selectedShowSeasonNumber}
									/>
								</>
							) : null}
							{!onlySeason && selectedShowSeasonNumber ? (
								<Select
									label="Episode"
									data={
										mediaDetails.data.showSpecifics.seasons
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
							) : null}
						</>
					) : null}
					{mediaDetails.data.podcastSpecifics ? (
						completePodcast ? (
							<Alert color="yellow" icon={<IconAlertCircle size="1rem" />}>
								This will mark all episodes for this podcast as seen
							</Alert>
						) : (
							<>
								<Title order={6}>Select episode</Title>
								<Autocomplete
									label="Episode"
									data={mediaDetails.data.podcastSpecifics.episodes.map(
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
					) : null}
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
