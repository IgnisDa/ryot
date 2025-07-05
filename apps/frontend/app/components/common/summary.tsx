import {
	Box,
	Center,
	Flex,
	RingProgress,
	SimpleGrid,
	Text,
	useMantineTheme,
} from "@mantine/core";
import {
	MediaLot,
	type UserAnalytics,
} from "@ryot/generated/graphql/backend/graphql";
import {
	formatQuantityWithCompactNotation,
	humanizeDuration,
	isNumber,
} from "@ryot/ts-utils";
import {
	IconBarbell,
	IconFriends,
	IconScaleOutline,
	IconServer,
} from "@tabler/icons-react";
import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { dayjsLib } from "~/lib/shared/date-utils";
import {
	useGetMantineColors,
	useUserPreferences,
	useUserUnitSystem,
} from "~/lib/shared/hooks";
import { MediaColors, getMetadataIcon } from "~/lib/shared/media-utils";
import { displayWeightWithUnit } from "../fitness";

export const DisplaySummarySection = ({
	latestUserSummary,
}: {
	latestUserSummary: UserAnalytics["activities"]["items"][number];
}) => {
	const userPreferences = useUserPreferences();
	const unitSystem = useUserUnitSystem();
	const theme = useMantineTheme();

	return (
		<SimpleGrid
			spacing="xs"
			cols={{ base: 1, sm: 2, md: 3 }}
			style={{ alignItems: "center" }}
		>
			<DisplayStatForMediaType
				lot={MediaLot.Movie}
				data={[
					{
						type: "number",
						label: "Movies",
						value: latestUserSummary.movieCount,
					},
					{
						type: "duration",
						label: "Runtime",
						value: latestUserSummary.totalMovieDuration,
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Music}
				data={[
					{
						label: "Songs",
						type: "number",
						value: latestUserSummary.musicCount,
					},
					{
						label: "Runtime",
						type: "duration",
						value: latestUserSummary.totalMusicDuration,
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Show}
				data={[
					{
						type: "number",
						label: "Show episodes",
						value: latestUserSummary.showCount,
					},
					{
						label: "Runtime",
						type: "duration",
						value: latestUserSummary.totalShowDuration,
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.VideoGame}
				data={[
					{
						type: "number",
						label: "Video games",
						value: latestUserSummary.videoGameCount,
					},
					{
						label: "Runtime",
						type: "duration",
						hideIfZero: true,
						value: latestUserSummary.totalVideoGameDuration,
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.VisualNovel}
				data={[
					{
						type: "number",
						label: "Visual Novels",
						value: latestUserSummary.visualNovelCount,
					},
					{
						label: "Runtime",
						type: "duration",
						value: latestUserSummary.totalVisualNovelDuration,
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.AudioBook}
				data={[
					{
						type: "number",
						label: "Audio books",
						value: latestUserSummary.audioBookCount,
					},
					{
						label: "Runtime",
						type: "duration",
						value: latestUserSummary.totalAudioBookDuration,
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Book}
				data={[
					{
						label: "Books",
						type: "number",
						value: latestUserSummary.bookCount,
					},
					{
						label: "Pages",
						type: "number",
						value: latestUserSummary.totalBookPages,
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Podcast}
				data={[
					{
						type: "number",
						label: "Podcasts",
						value: latestUserSummary.podcastCount,
					},
					{
						label: "Runtime",
						type: "duration",
						value: latestUserSummary.totalPodcastDuration,
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Manga}
				data={[
					{
						label: "Manga",
						type: "number",
						value: latestUserSummary.mangaCount,
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Anime}
				data={[
					{
						label: "Anime",
						type: "number",
						value: latestUserSummary.animeCount,
					},
				]}
			/>
			{userPreferences.featuresEnabled.media.enabled ? (
				<>
					<ActualDisplayStat
						lot="Metadata stats"
						icon={<IconServer />}
						color={theme.colors.grape[8]}
						data={[
							{
								label: "Media",
								type: "number",
								value: latestUserSummary.totalMetadataCount,
							},
							{
								type: "number",
								label: "Reviews",
								hideIfZero: true,
								value: latestUserSummary.totalMetadataReviewCount,
							},
						]}
					/>
					{userPreferences.featuresEnabled.media.people ? (
						<UnstyledLink
							to={$path("/media/people/:action", {
								action: "list",
							})}
						>
							<ActualDisplayStat
								lot="People stats"
								icon={<IconFriends />}
								color={theme.colors.red[9]}
								data={[
									{
										type: "number",
										hideIfZero: true,
										label: "People Reviewed",
										value: latestUserSummary.totalPersonReviewCount,
									},
								]}
							/>
						</UnstyledLink>
					) : null}
				</>
			) : null}
			{userPreferences.featuresEnabled.fitness.enabled ? (
				<UnstyledLink
					to={$path("/fitness/:entity/list", {
						entity: "workouts",
					})}
				>
					<ActualDisplayStat
						lot="Workouts"
						color={theme.colors.teal[2]}
						icon={<IconBarbell stroke={1.3} />}
						data={[
							{
								type: "number",
								label: "Workouts",
								value: latestUserSummary.workoutCount,
							},
							{
								label: "Runtime",
								type: "duration",
								value: latestUserSummary.totalWorkoutDuration,
							},
							{
								type: "string",
								label: "Runtime",
								value: displayWeightWithUnit(
									unitSystem,
									latestUserSummary.totalWorkoutWeight,
									true,
								),
							},
						]}
					/>
				</UnstyledLink>
			) : null}
			{userPreferences.featuresEnabled.fitness.enabled ? (
				<UnstyledLink to={$path("/fitness/measurements/list")}>
					<ActualDisplayStat
						lot="Fitness"
						color={theme.colors.yellow[5]}
						icon={<IconScaleOutline stroke={1.3} />}
						data={[
							{
								type: "number",
								hideIfZero: true,
								label: "Measurements",
								value: latestUserSummary.userMeasurementCount,
							},
						]}
					/>
				</UnstyledLink>
			) : null}
		</SimpleGrid>
	);
};

const ActualDisplayStat = (props: {
	lot: string;
	color?: string;
	icon: ReactNode;
	data: Array<{
		type: "duration" | "number" | "string";
		label: string;
		value: number | string;
		hideIfZero?: true;
	}>;
}) => {
	const colors = useGetMantineColors();

	return (
		<Flex align="center">
			<RingProgress
				size={60}
				thickness={4}
				sections={[]}
				label={<Center>{props.icon}</Center>}
				rootColor={props.color ?? colors[11]}
			/>
			<Flex wrap="wrap" ml="xs">
				{props.data.map((d, idx) => (
					<Fragment key={idx.toString()}>
						{isNumber(d.type) && d.value === 0 && d.hideIfZero ? undefined : (
							<Box mx="xs" data-stat-stringified={JSON.stringify(d)}>
								<Text
									fw={d.label !== "Runtime" ? "bold" : undefined}
									display="inline"
									fz={{ base: "md", md: "sm", xl: "md" }}
								>
									{match(d.type)
										.with("string", () => d.value)
										.with("duration", () =>
											humanizeDuration(
												dayjsLib
													.duration(Number(d.value), "minutes")
													.asMilliseconds(),
												{
													round: true,
													largest: 3,
												},
											),
										)
										.with("number", () =>
											formatQuantityWithCompactNotation(Number(d.value)),
										)
										.exhaustive()}
								</Text>
								<Text
									display="inline"
									ml="4px"
									fz={{ base: "md", md: "sm", xl: "md" }}
								>
									{d.label === "Runtime" ? "" : d.label}
								</Text>
							</Box>
						)}
					</Fragment>
				))}
			</Flex>
		</Flex>
	);
};

const DisplayStatForMediaType = (props: {
	lot: MediaLot;
	data: Array<{
		label: string;
		value: number;
		hideIfZero?: true;
		type: "duration" | "number";
	}>;
}) => {
	const userPreferences = useUserPreferences();
	const isEnabled = userPreferences.featuresEnabled.media.specific.includes(
		props.lot,
	);
	const Icon = getMetadataIcon(props.lot);
	const icon = <Icon size={24} stroke={1.5} />;

	return isEnabled && userPreferences.featuresEnabled.media.enabled ? (
		<UnstyledLink
			to={$path("/media/:action/:lot", {
				action: "list",
				lot: props.lot.toLowerCase(),
			})}
		>
			<ActualDisplayStat
				data={props.data}
				icon={icon}
				lot={props.lot.toString()}
				color={MediaColors[props.lot]}
			/>
		</UnstyledLink>
	) : null;
};

const UnstyledLink = (props: { children: ReactNode; to: string }) => {
	return (
		<Link to={props.to} style={{ all: "unset", cursor: "pointer" }}>
			{props.children}
		</Link>
	);
};
