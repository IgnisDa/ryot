import {
	Alert,
	Autocomplete,
	Button,
	Checkbox,
	Container,
	Group,
	Select,
	Stack,
	Title,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import "@mantine/dates/styles.css";
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
	json,
} from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
	DeployBulkProgressUpdateDocument,
	MediaAdditionalDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { formatDateToNaiveDate } from "@ryot/ts-utils";
import { IconAlertCircle } from "@tabler/icons-react";
import { DateTime } from "luxon";
import { useState } from "react";
import { $path } from "remix-routes";
import { safeRedirect } from "remix-utils/safe-redirect";
import invariant from "tiny-invariant";
import { z } from "zod";
import { zx } from "zodix";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { createToastHeaders, redirectWithToast } from "~/lib/toast.server";
import { Verb, getVerb } from "~/lib/utilities";
import { ShowAndPodcastSchema, processSubmission } from "~/lib/utils";

const commonSchema = z.object({
	onlySeason: zx.BoolAsString.optional(),
	completeShow: zx.BoolAsString.optional(),
	completePodcast: zx.BoolAsString.optional(),
	redirectTo: z.string().optional(),
});

const searchParamsSchema = z
	.object({
		title: z.string(),
		isShow: zx.BoolAsString.optional(),
		isPodcast: zx.BoolAsString.optional(),
	})
	.merge(commonSchema)
	.merge(ShowAndPodcastSchema);

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const id = params.id ? Number(params.id) : undefined;
	invariant(id, "No ID provided");
	let extraDetails = null;
	if (query.isShow || query.isPodcast) {
		const { mediaDetails } = await gqlClient.request(
			MediaAdditionalDetailsDocument,
			{ metadataId: id },
		);
		extraDetails = mediaDetails;
	}
	return json({ query, id, extraDetails });
};

export const meta: MetaFunction = ({ data }) => {
	return [
		{
			title: `Update progress for ${
				// biome-ignore lint/suspicious/noExplicitAny:
				(data as any).query.title
			} | Ryot`,
		},
	];
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.formData();
	const query = zx.parseQuery(request, commonSchema);
	const submission = processSubmission(formData, actionSchema);
	const variables = {
		metadataId: submission.metadataId,
		progress: 100,
		date: submission.date,
		showEpisodeNumber: submission.showEpisodeNumber,
		showSeasonNumber: submission.showSeasonNumber,
		podcastEpisodeNumber: submission.podcastEpisodeNumber,
	};
	let needsFinalUpdate = true;
	const updates = [];
	const showSpecifics = showSpecificsSchema.parse(
		JSON.parse(submission.showSpecifics || "[]"),
	);
	const podcastSpecifics = podcastSpecificsSchema.parse(
		JSON.parse(submission.podcastSpecifics || "[]"),
	);
	if (query.completeShow) {
		for (const season of showSpecifics) {
			for (const episode of season.episodes) {
				updates.push({
					...variables,
					showSeasonNumber: season.seasonNumber,
					showEpisodeNumber: episode,
				});
			}
		}
		needsFinalUpdate = true;
	}
	if (query.completePodcast) {
		for (const episode of podcastSpecifics) {
			updates.push({
				...variables,
				podcastEpisodeNumber: episode.episodeNumber,
			});
		}
		needsFinalUpdate = true;
	}
	if (query.onlySeason) {
		const selectedSeason = showSpecifics.find(
			(s) => s.seasonNumber === submission.showSeasonNumber,
		);
		invariant(selectedSeason, "No season selected");
		needsFinalUpdate = true;
		if (submission.allSeasonsBefore) {
			for (const season of showSpecifics) {
				if (season.seasonNumber > selectedSeason.seasonNumber) break;
				for (const episode of season.episodes || []) {
					updates.push({
						...variables,
						showSeasonNumber: season.seasonNumber,
						showEpisodeNumber: episode,
					});
				}
			}
		} else {
			for (const episode of selectedSeason.episodes || []) {
				updates.push({
					...variables,
					showEpisodeNumber: episode,
				});
			}
		}
	}
	if (needsFinalUpdate) updates.push(variables);
	const { deployBulkProgressUpdate } = await gqlClient.request(
		DeployBulkProgressUpdateDocument,
		{ input: updates },
		await getAuthorizationHeader(request),
	);
	if (deployBulkProgressUpdate) {
		return redirectWithToast(
			query.redirectTo
				? safeRedirect(query.redirectTo)
				: $path("/media/item/:id", { id: submission.metadataId }),
			{ message: "Progress has been updated" },
		);
	} else
		return json(
			{},
			{
				headers: await createToastHeaders({
					type: "error",
					message: "Something went wrong",
				}),
			},
		);
};

const actionSchema = z
	.object({
		metadataId: zx.IntAsString,
		date: z.string().optional(),
		showSpecifics: z.string().optional(),
		allSeasonsBefore: zx.CheckboxAsString.optional(),
		podcastSpecifics: z.string().optional(),
	})
	.merge(ShowAndPodcastSchema);

const showSpecificsSchema = z.array(
	z.object({ seasonNumber: z.number(), episodes: z.array(z.number()) }),
);

const podcastSpecificsSchema = z.array(z.object({ episodeNumber: z.number() }));

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [selectedDate, setSelectedDate] = useState<Date | null>(null);

	return (
		<Container size="xs">
			<Form method="post">
				<input hidden name="metadataId" defaultValue={loaderData.id} />
				{loaderData.query.showEpisodeNumber ? (
					<input
						hidden
						name="showEpisodeNumber"
						defaultValue={loaderData.query.showEpisodeNumber.toString()}
					/>
				) : undefined}
				{loaderData.query.showSeasonNumber ? (
					<input
						hidden
						name="showSeasonNumber"
						defaultValue={loaderData.query.showSeasonNumber.toString()}
					/>
				) : undefined}
				{loaderData.query.podcastEpisodeNumber ? (
					<input
						hidden
						name="podcastEpisodeNumber"
						defaultValue={loaderData.query.podcastEpisodeNumber?.toString()}
					/>
				) : undefined}
				{loaderData.extraDetails?.showSpecifics ? (
					<input
						hidden
						name="showSpecifics"
						defaultValue={JSON.stringify(
							loaderData.extraDetails.showSpecifics.seasons.map((s) => ({
								seasonNumber: s.seasonNumber,
								episodes: s.episodes.map((e) => e.episodeNumber),
							})),
						)}
					/>
				) : undefined}
				{loaderData.extraDetails?.podcastSpecifics ? (
					<input
						hidden
						name="podcastSpecifics"
						defaultValue={JSON.stringify(
							loaderData.extraDetails.podcastSpecifics.episodes.map((e) => ({
								episodeNumber: e.number,
							})),
						)}
					/>
				) : undefined}
				<Stack p="sm">
					<Title>{loaderData.query.title}</Title>
					{loaderData.extraDetails?.showSpecifics ? (
						<>
							{loaderData.query.onlySeason || loaderData.query.completeShow ? (
								<Alert color="yellow" icon={<IconAlertCircle size={16} />}>
									{loaderData.query.onlySeason
										? `This will mark all episodes of season ${loaderData.query.showSeasonNumber} as seen`
										: loaderData.query.completeShow
										? "This will mark all episodes for this show as seen"
										: undefined}
								</Alert>
							) : undefined}
							{!loaderData.query.completeShow ? (
								<>
									<Title order={6}>
										Select season
										{loaderData.query.onlySeason ? "" : " and episode"}
									</Title>
									<Select
										label="Season"
										data={loaderData.extraDetails.showSpecifics.seasons.map(
											(s) => ({
												label: `${s.seasonNumber}. ${s.name.toString()}`,
												value: s.seasonNumber.toString(),
											}),
										)}
										defaultValue={loaderData.query.showSeasonNumber?.toString()}
									/>
								</>
							) : undefined}
							{loaderData.query.onlySeason ? (
								<Checkbox
									label="Mark all seasons before this as seen"
									name="allSeasonsBefore"
								/>
							) : undefined}
							{!loaderData.query.onlySeason &&
							loaderData.query.showSeasonNumber ? (
								<Select
									label="Episode"
									data={
										loaderData.extraDetails.showSpecifics.seasons
											.find(
												(s) =>
													s.seasonNumber ===
													Number(loaderData.query.showSeasonNumber),
											)
											?.episodes.map((e) => ({
												label: `${e.episodeNumber}. ${e.name.toString()}`,
												value: e.episodeNumber.toString(),
											})) || []
									}
									defaultValue={loaderData.query.showEpisodeNumber?.toString()}
								/>
							) : undefined}
						</>
					) : undefined}
					{loaderData.extraDetails?.podcastSpecifics ? (
						loaderData.query.completePodcast ? (
							<Alert color="yellow" icon={<IconAlertCircle size={16} />}>
								This will mark all episodes for this podcast as seen
							</Alert>
						) : (
							<>
								<Title order={6}>Select episode</Title>
								<Autocomplete
									label="Episode"
									data={loaderData.extraDetails.podcastSpecifics.episodes.map(
										(se) => ({
											label: se.title.toString(),
											value: se.number.toString(),
										}),
									)}
									defaultValue={loaderData.query.podcastEpisodeNumber?.toString()}
								/>
							</>
						)
					) : undefined}
					{loaderData.extraDetails?.lot ? (
						<Title order={6}>
							When did you {getVerb(Verb.Read, loaderData.extraDetails.lot)} it?
						</Title>
					) : undefined}
					<Button
						variant="outline"
						type="submit"
						name="date"
						value={DateTime.now().toISODate() || ""}
					>
						Now
					</Button>
					<Button variant="outline" type="submit">
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
							type="submit"
							name="date"
							value={
								selectedDate ? formatDateToNaiveDate(selectedDate) : undefined
							}
						>
							Custom date
						</Button>
					</Group>
				</Stack>
			</Form>
		</Container>
	);
}
