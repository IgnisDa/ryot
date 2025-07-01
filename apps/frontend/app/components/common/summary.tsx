import {
	useMantineTheme,
	SimpleGrid,
	Text,
	Flex,
	RingProgress,
	Center,
	Box,
} from "@mantine/core";
import {
	type UserAnalytics,
	MediaLot,
} from "@ryot/generated/graphql/backend/graphql";
import {
	isNumber,
	humanizeDuration,
	formatQuantityWithCompactNotation,
} from "@ryot/ts-utils";
import {
	IconServer,
	IconFriends,
	IconBarbell,
	IconScaleOutline,
} from "@tabler/icons-react";
import { type ReactNode, Fragment } from "react";
import { Link } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { dayjsLib, getMetadataIcon, MediaColors } from "~/lib/common";
import {
	useUserPreferences,
	useUserUnitSystem,
	useGetMantineColors,
} from "~/lib/hooks";
import { displayWeightWithUnit } from "../fitness";

export const DisplaySummarySection = ({
	latestUserSummary,
}: {
	latestUserSummary: UserAnalytics["activities"]["items"][0];
}) => {
	const userPreferences = useUserPreferences();
	const unitSystem = useUserUnitSystem();
	const theme = useMantineTheme();

	return (
		<SimpleGrid
			cols={{ base: 1, sm: 2, md: 3 }}
			style={{ alignItems: "center" }}
			spacing="xs"
		>
			<DisplayStatForMediaType
				lot={MediaLot.Movie}
				data={[
					{
						label: "Movies",
						value: latestUserSummary.movieCount,
						type: "number",
					},
					{
						label: "Runtime",
						value: latestUserSummary.totalMovieDuration,
						type: "duration",
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Music}
				data={[
					{
						label: "Songs",
						value: latestUserSummary.musicCount,
						type: "number",
					},
					{
						label: "Runtime",
						value: latestUserSummary.totalMusicDuration,
						type: "duration",
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Show}
				data={[
					{
						label: "Show episodes",
						value: latestUserSummary.showCount,
						type: "number",
					},
					{
						label: "Runtime",
						value: latestUserSummary.totalShowDuration,
						type: "duration",
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.VideoGame}
				data={[
					{
						label: "Video games",
						value: latestUserSummary.videoGameCount,
						type: "number",
					},
					{
						label: "Runtime",
						value: latestUserSummary.totalVideoGameDuration,
						type: "duration",
						hideIfZero: true,
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.VisualNovel}
				data={[
					{
						label: "Visual Novels",
						value: latestUserSummary.visualNovelCount,
						type: "number",
					},
					{
						label: "Runtime",
						value: latestUserSummary.totalVisualNovelDuration,
						type: "duration",
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.AudioBook}
				data={[
					{
						label: "Audio books",
						value: latestUserSummary.audioBookCount,
						type: "number",
					},
					{
						label: "Runtime",
						value: latestUserSummary.totalAudioBookDuration,
						type: "duration",
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Book}
				data={[
					{
						label: "Books",
						value: latestUserSummary.bookCount,
						type: "number",
					},
					{
						label: "Pages",
						value: latestUserSummary.totalBookPages,
						type: "number",
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Podcast}
				data={[
					{
						label: "Podcasts",
						value: latestUserSummary.podcastCount,
						type: "number",
					},
					{
						label: "Runtime",
						value: latestUserSummary.totalPodcastDuration,
						type: "duration",
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Manga}
				data={[
					{
						label: "Manga",
						value: latestUserSummary.mangaCount,
						type: "number",
					},
				]}
			/>
			<DisplayStatForMediaType
				lot={MediaLot.Anime}
				data={[
					{
						label: "Anime",
						value: latestUserSummary.animeCount,
						type: "number",
					},
				]}
			/>
			{userPreferences.featuresEnabled.media.enabled ? (
				<>
					<ActualDisplayStat
						icon={<IconServer />}
						lot="Metadata stats"
						color={theme.colors.grape[8]}
						data={[
							{
								label: "Media",
								value: latestUserSummary.totalMetadataCount,
								type: "number",
							},
							{
								label: "Reviews",
								value: latestUserSummary.totalMetadataReviewCount,
								type: "number",
								hideIfZero: true,
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
								icon={<IconFriends />}
								lot="People stats"
								color={theme.colors.red[9]}
								data={[
									{
										label: "People Reviewed",
										value: latestUserSummary.totalPersonReviewCount,
										type: "number",
										hideIfZero: true,
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
						icon={<IconBarbell stroke={1.3} />}
						lot="Workouts"
						color={theme.colors.teal[2]}
						data={[
							{
								label: "Workouts",
								value: latestUserSummary.workoutCount,
								type: "number",
							},
							{
								label: "Runtime",
								value: latestUserSummary.totalWorkoutDuration,
								type: "duration",
							},
							{
								label: "Runtime",
								value: displayWeightWithUnit(
									unitSystem,
									latestUserSummary.totalWorkoutWeight,
									true,
								),
								type: "string",
							},
						]}
					/>
				</UnstyledLink>
			) : null}
			{userPreferences.featuresEnabled.fitness.enabled ? (
				<ActualDisplayStat
					icon={<IconScaleOutline stroke={1.3} />}
					lot="Fitness"
					color={theme.colors.yellow[5]}
					data={[
						{
							label: "Measurements",
							value: latestUserSummary.userMeasurementCount,
							type: "number",
							hideIfZero: true,
						},
					]}
				/>
			) : null}
		</SimpleGrid>
	);
};

const ActualDisplayStat = (props: {
	icon: ReactNode;
	lot: string;
	data: Array<{
		type: "duration" | "number" | "string";
		label: string;
		value: number | string;
		hideIfZero?: true;
	}>;
	color?: string;
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
