import {
	Box,
	Center,
	Flex,
	RingProgress,
	SimpleGrid,
	Text,
	Tooltip,
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
import { getMetadataIcon, MediaColors } from "~/lib/shared/media-utils";
import { displayWeightWithUnit } from "../fitness/utils";

export const DisplaySummarySection = (props: {
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
						value: props.latestUserSummary.movieCount,
					},
					{
						type: "duration",
						label: "Runtime",
						value: props.latestUserSummary.totalMovieDuration,
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Music}
				data={[
					{
						label: "Songs",
						type: "number",
						value: props.latestUserSummary.musicCount,
					},
					{
						label: "Runtime",
						type: "duration",
						value: props.latestUserSummary.totalMusicDuration,
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Show}
				data={[
					{
						type: "number",
						label: "Show episodes",
						value: props.latestUserSummary.showCount,
					},
					{
						label: "Runtime",
						type: "duration",
						value: props.latestUserSummary.totalShowDuration,
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.VideoGame}
				data={[
					{
						type: "number",
						label: "Video games",
						value: props.latestUserSummary.videoGameCount,
					},
					{
						label: "Runtime",
						type: "duration",
						hideIfZero: true,
						value: props.latestUserSummary.totalVideoGameDuration,
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.VisualNovel}
				data={[
					{
						type: "number",
						label: "Visual Novels",
						value: props.latestUserSummary.visualNovelCount,
					},
					{
						label: "Runtime",
						type: "duration",
						value: props.latestUserSummary.totalVisualNovelDuration,
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.AudioBook}
				data={[
					{
						type: "number",
						label: "Audio books",
						value: props.latestUserSummary.audioBookCount,
					},
					{
						label: "Runtime",
						type: "duration",
						value: props.latestUserSummary.totalAudioBookDuration,
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Book}
				data={[
					{
						label: "Books",
						type: "number",
						value: props.latestUserSummary.bookCount,
					},
					{
						label: "Pages",
						type: "number",
						value: props.latestUserSummary.totalBookPages,
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Podcast}
				data={[
					{
						type: "number",
						label: "Podcasts",
						value: props.latestUserSummary.podcastCount,
					},
					{
						label: "Runtime",
						type: "duration",
						value: props.latestUserSummary.totalPodcastDuration,
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Manga}
				data={[
					{
						label: "Manga",
						type: "number",
						value: props.latestUserSummary.mangaCount,
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Anime}
				data={[
					{
						label: "Anime",
						type: "number",
						value: props.latestUserSummary.animeCount,
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
								value: props.latestUserSummary.totalMetadataCount,
							},
							{
								type: "number",
								label: "Reviews",
								hideIfZero: true,
								value: props.latestUserSummary.totalMetadataReviewCount,
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
										value: props.latestUserSummary.totalPersonReviewCount,
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
								value: props.latestUserSummary.workoutCount,
							},
							{
								label: "Runtime",
								type: "duration",
								value: props.latestUserSummary.totalWorkoutDuration,
							},
							{
								type: "string",
								label: "Runtime",
								value: displayWeightWithUnit(
									unitSystem,
									props.latestUserSummary.totalWorkoutWeight,
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
								value: props.latestUserSummary.userMeasurementCount,
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
		label: string;
		hideIfZero?: true;
		value: number | string;
		type: "duration" | "number" | "string";
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
				{props.data.map((d, idx) => {
					const numDisplay = match(d.type)
						.with("string", () => d.value)
						.with("duration", () =>
							humanizeDuration(
								dayjsLib.duration(Number(d.value), "minutes").asMilliseconds(),
								{ round: true, largest: 3 },
							),
						)
						.with("number", () =>
							formatQuantityWithCompactNotation(Number(d.value)),
						)
						.exhaustive();
					return (
						<Fragment key={idx.toString()}>
							{isNumber(d.type) && d.value === 0 && d.hideIfZero ? undefined : (
								<Box mx="xs">
									<Tooltip
										label={`${d.value} ${d.type === "duration" ? "minutes" : ""}`}
									>
										<Text
											display="inline"
											fz={{ base: "md", md: "sm", xl: "md" }}
											fw={d.label !== "Runtime" ? "bold" : undefined}
										>
											{numDisplay}
										</Text>
									</Tooltip>
									<Text
										ml="4px"
										display="inline"
										fz={{ base: "md", md: "sm", xl: "md" }}
									>
										{d.label !== "Runtime" ? d.label : undefined}
									</Text>
								</Box>
							)}
						</Fragment>
					);
				})}
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
				icon={icon}
				data={props.data}
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
