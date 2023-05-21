import type { NextPageWithLayout } from "../_app";
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
import {
	MediaDetailsDocument,
	ProgressUpdateAction,
	ProgressUpdateDocument,
	type ProgressUpdateMutationVariables,
} from "@ryot/generated/graphql/backend/graphql";
import { IconAlertCircle } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import Head from "next/head";
import { useRouter } from "next/router";
import { type ReactElement, useState } from "react";

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const metadataId = parseInt(router.query.item?.toString() || "0");
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

	const details = useQuery({
		queryKey: ["details", metadataId],
		queryFn: async () => {
			const { mediaDetails } = await gqlClient.request(MediaDetailsDocument, {
				metadataId: metadataId,
			});
			return mediaDetails;
		},
	});
	const progressUpdate = useMutation({
		mutationFn: async (
			variables: ProgressUpdateMutationVariables & { onlySeason: boolean },
		) => {
			if (onlySeason) {
				for (const episode of details.data?.showSpecifics?.seasons.find(
					(s) => s.seasonNumber.toString() === selectedShowSeasonNumber,
				)?.episodes || []) {
					await gqlClient.request(ProgressUpdateDocument, {
						input: {
							...variables.input,
							showEpisodeNumber: episode.episodeNumber,
						},
					});
				}
				return;
			}
			const { progressUpdate } = await gqlClient.request(
				ProgressUpdateDocument,
				variables,
			);
			return progressUpdate;
		},
		onSuccess: () => {
			router.push(`/media?item=${metadataId}`);
		},
	});

	const title = details.data?.title;

	const mutationInput = {
		metadataId: metadataId || 0,
		showEpisodeNumber: Number(selectedShowEpisodeNumber),
		showSeasonNumber: Number(selectedShowSeasonNumber),
		podcastEpisodeNumber: Number(selectedPodcastEpisodeNumber),
	};

	return details.data && title ? (
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
					{details.data.showSpecifics ? (
						<>
							{onlySeason ? (
								<Alert color="yellow" icon={<IconAlertCircle size="1rem" />}>
									This will mark all episodes for Season{" "}
									{selectedShowSeasonNumber} as seen
								</Alert>
							) : null}
							<Title order={6}>
								Select season{onlySeason ? "" : " and episode"}
							</Title>
							<Select
								label="Season"
								data={details.data.showSpecifics.seasons.map((s) => ({
									label: `${s.seasonNumber}. ${s.name.toString()}`,
									value: s.seasonNumber.toString(),
								}))}
								onChange={setSelectedShowSeasonNumber}
								defaultValue={selectedShowSeasonNumber}
							/>
							{!onlySeason && selectedShowSeasonNumber ? (
								<Select
									label="Episode"
									data={
										details.data.showSpecifics.seasons
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
					{details.data.podcastSpecifics ? (
						<>
							<Title order={6}>Select episode</Title>
							<Autocomplete
								label="Episode"
								data={details.data.podcastSpecifics.episodes.map((se) => ({
									label: se.title.toString(),
									value: se.number.toString(),
								}))}
								onChange={setSelectedPodcastEpisodeNumber}
								defaultValue={selectedPodcastEpisodeNumber || undefined}
							/>
						</>
					) : null}
					<Title order={6}>
						When did you {getVerb(Verb.Read, details.data.type)} it?
					</Title>
					<Button
						variant="outline"
						onClick={async () => {
							await progressUpdate.mutateAsync({
								input: { action: ProgressUpdateAction.Now, ...mutationInput },
								onlySeason,
							});
						}}
					>
						Now
					</Button>
					<Button
						variant="outline"
						onClick={async () => {
							await progressUpdate.mutateAsync({
								input: {
									action: ProgressUpdateAction.InThePast,
									...mutationInput,
								},
								onlySeason,
							});
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
											action: ProgressUpdateAction.InThePast,
											date: DateTime.fromJSDate(selectedDate).toISODate(),
											...mutationInput,
										},
										onlySeason,
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
