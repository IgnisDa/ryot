import { useUserPreferences } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { getSetColor } from "@/lib/utilities";
import {
	Box,
	Container,
	Flex,
	Image,
	List,
	Paper,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import {
	ExerciseDetailsDocument,
	ExerciseLot,
	SetLot,
	type SetStatistic,
	UserExerciseDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	IconHistoryToggle,
	IconInfoCircle,
	IconTrophy,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import Head from "next/head";
import { useRouter } from "next/router";
import type { ReactElement } from "react";
import { match } from "ts-pattern";
import type { NextPageWithLayout } from "../../_app";

const getStats = (lot: ExerciseLot, statistic: SetStatistic) => {
	const [first, second] = match(lot)
		.with(ExerciseLot.DistanceAndDuration, () => [
			`${statistic.duration} km x ${statistic.duration} min`,
			`${statistic.distance / statistic.duration} km/min`,
		])
		.with(ExerciseLot.Duration, () => [`${statistic.duration} min`, ""])
		.with(ExerciseLot.RepsAndWeight, () => [
			`${statistic.weight} kg x ${statistic.reps}`,
			`${statistic.weight * (statistic.reps || 1)} vol`,
		])
		.exhaustive();
	return (
		<>
			<Text fz="sm">{first}</Text>
			{second ? (
				<Text ml="auto" fz="sm">
					{second}
				</Text>
			) : undefined}
		</>
	);
};

const DisplayLifetimeStatistic = (props: {
	// rome-ignore lint/suspicious/noExplicitAny: required here
	val: any;
	unit?: string;
	stat: string;
}) => {
	return parseFloat(props.val) !== 0 ? (
		<Flex mt={6} align={"center"} justify={"space-between"}>
			<Text size="sm">Total {props.stat}</Text>
			<Text size="sm">
				{props.val} {props.unit}
			</Text>
		</Flex>
	) : undefined;
};

const Page: NextPageWithLayout = () => {
	const router = useRouter();
	const exerciseId = parseInt(router.query.id?.toString() || "0");

	const [activeTab, setActiveTab] = useLocalStorage({
		key: "savedActiveExerciseDetailsTab",
		getInitialValueInEffect: false,
		defaultValue: "overview",
	});
	const userPreferences = useUserPreferences();

	const userExerciseDetails = useQuery({
		queryKey: ["userExerciseDetails", exerciseId],
		queryFn: async () => {
			const { userExerciseDetails } = await gqlClient.request(
				UserExerciseDetailsDocument,
				{ exerciseId },
			);
			return userExerciseDetails;
		},
		staleTime: Infinity,
		enabled: !!exerciseId,
	});
	const exerciseDetails = useQuery({
		queryKey: ["creatorDetails", exerciseId],
		queryFn: async () => {
			const { exerciseDetails } = await gqlClient.request(
				ExerciseDetailsDocument,
				{ exerciseId },
			);
			return exerciseDetails;
		},
		staleTime: Infinity,
		enabled: !!exerciseId,
	});

	return exerciseDetails.data && userPreferences.data ? (
		<>
			<Head>
				<title>{exerciseDetails.data.name} | Ryot</title>
			</Head>
			<Container size="xs" px="lg">
				<Stack>
					<Title id="exercise-title">{exerciseDetails.data.name}</Title>
					<Tabs
						value={activeTab}
						onTabChange={(v) => {
							if (v) setActiveTab(v);
						}}
						variant="outline"
					>
						<Tabs.List mb={"xs"}>
							<Tabs.Tab value="overview" icon={<IconInfoCircle size="1rem" />}>
								Overview
							</Tabs.Tab>
							<Tabs.Tab
								value="history"
								icon={<IconHistoryToggle size="1rem" />}
							>
								History
							</Tabs.Tab>
							<Tabs.Tab value="records" icon={<IconTrophy size="1rem" />}>
								Records
							</Tabs.Tab>
						</Tabs.List>

						<Tabs.Panel value="overview">
							<Stack>
								<Flex gap={6}>
									{exerciseDetails.data.attributes.images.map((i) => (
										<Image
											key={i}
											radius={"md"}
											src={i}
											imageProps={{ loading: "lazy" }}
										/>
									))}
								</Flex>
								<Text size="xl" fw="bold">
									Instructions
								</Text>
								<List type="ordered" spacing={"xs"}>
									{exerciseDetails.data.attributes.instructions.map((d) => (
										<List.Item key={d}>{d}</List.Item>
									))}
								</List>
							</Stack>
						</Tabs.Panel>
						<Tabs.Panel value="history">
							{userExerciseDetails.data ? (
								<Stack>
									{userExerciseDetails.data.history.map((h) => (
										<Paper key={h.workoutId} withBorder p="xs">
											<Text fw="bold">{h.workoutName}</Text>
											<Text color="dimmed" fz="sm" mb="xs">
												{DateTime.fromJSDate(h.workoutTime).toLocaleString(
													DateTime.DATETIME_MED_WITH_WEEKDAY,
												)}
											</Text>
											{h.sets.map((s, idx) => (
												<Flex key={`${idx}`} align={"center"}>
													<Text
														fz="sm"
														color={getSetColor(s.lot)}
														mr="md"
														fw="bold"
													>
														{match(s.lot)
															.with(SetLot.Normal, () => idx + 1)
															.otherwise(() => s.lot.at(0))}
													</Text>
													{getStats(exerciseDetails.data.lot, s.statistic)}
												</Flex>
											))}
										</Paper>
									))}
								</Stack>
							) : (
								<Text italic>No history found</Text>
							)}
						</Tabs.Panel>
						<Tabs.Panel value="records">
							{userExerciseDetails.data ? (
								<Stack>
									<Box>
										<Text size="xs" color="dimmed">
											LIFETIME STATS
										</Text>
										<DisplayLifetimeStatistic
											stat="weight"
											unit="KG"
											val={
												userExerciseDetails.data.details.extraInformation
													.lifetimeStats.weight
											}
										/>
										<DisplayLifetimeStatistic
											stat="distance"
											unit="KM"
											val={
												userExerciseDetails.data.details.extraInformation
													.lifetimeStats.distance
											}
										/>
										<DisplayLifetimeStatistic
											stat="duration"
											unit="MIN"
											val={
												userExerciseDetails.data.details.extraInformation
													.lifetimeStats.duration
											}
										/>
										<DisplayLifetimeStatistic
											stat="reps"
											val={
												userExerciseDetails.data.details.extraInformation
													.lifetimeStats.reps
											}
										/>
									</Box>
								</Stack>
							) : (
								<Text italic>No records found</Text>
							)}
						</Tabs.Panel>
					</Tabs>
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
