import { DisplayExerciseStats } from "@/lib/components/FitnessComponents";
import { APP_ROUTES, LOCAL_STORAGE_KEYS } from "@/lib/constants";
import { useUserPreferences } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { getSetColor } from "@/lib/utilities";
import {
	Anchor,
	Box,
	Container,
	Divider,
	Flex,
	Group,
	Image,
	List,
	Paper,
	ScrollArea,
	SimpleGrid,
	Stack,
	Tabs,
	Text,
	Title,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import {
	ExerciseDetailsDocument,
	SetLot,
	UserExerciseDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { startCase } from "@ryot/ts-utils";
import {
	IconHistoryToggle,
	IconInfoCircle,
	IconTrophy,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import type { ReactElement } from "react";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import type { NextPageWithLayout } from "../../_app";

const DisplayData = (props: { name: string; data: string }) => {
	return (
		<Box>
			<Text ta="center" c="dimmed" tt="capitalize" fz="xs">
				{startCase(props.name)}
			</Text>
			<Text ta="center" fz={{ base: "sm", md: "md" }}>
				{startCase(props.data.toLowerCase())}
			</Text>
		</Box>
	);
};

const DisplayLifetimeStatistic = (props: {
	// biome-ignore lint/suspicious/noExplicitAny: required here
	val: any;
	unit?: string;
	stat: string;
}) => {
	return parseFloat(props.val) !== 0 ? (
		<Flex mt={6} align="center" justify="space-between">
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
		key: LOCAL_STORAGE_KEYS.savedActiveExerciseDetailsTab,
		getInitialValueInEffect: false,
		defaultValue: "overview",
	});
	const userPreferences = useUserPreferences();

	const userExerciseDetails = useQuery({
		queryKey: ["userExerciseDetails", exerciseId],
		queryFn: async () => {
			const { userExerciseDetails } = await gqlClient.request(
				UserExerciseDetailsDocument,
				{ input: { exerciseId } },
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
						onChange={(v) => {
							if (v) setActiveTab(v);
						}}
						variant="outline"
					>
						<Tabs.List mb="xs">
							<Tabs.Tab
								value="overview"
								leftSection={<IconInfoCircle size={16} />}
							>
								Overview
							</Tabs.Tab>
							<Tabs.Tab
								value="history"
								leftSection={<IconHistoryToggle size={16} />}
							>
								History
							</Tabs.Tab>
							<Tabs.Tab value="records" leftSection={<IconTrophy size={16} />}>
								Records
							</Tabs.Tab>
						</Tabs.List>

						<Tabs.Panel value="overview">
							<Stack>
								<ScrollArea>
									<Flex gap={6}>
										{exerciseDetails.data.attributes.images.map((i) => (
											<Image key={i} radius="md" src={i} h="200px" w="248px" />
										))}
									</Flex>
								</ScrollArea>
								<SimpleGrid py="xs" cols={4}>
									{["level", "force", "mechanic", "equipment"].map((f) => (
										<>
											{/* biome-ignore lint/suspicious/noExplicitAny: required here */}
											{(exerciseDetails.data as any)[f] ? (
												<DisplayData
													name={f}
													// biome-ignore lint/suspicious/noExplicitAny: required here
													data={(exerciseDetails.data as any)[f]}
													key={f}
												/>
											) : undefined}
										</>
									))}
								</SimpleGrid>
								{exerciseDetails.data.attributes.muscles.length > 0 ? (
									<>
										<Divider />
										<Group wrap="nowrap">
											<Text c="dimmed" fz="sm">
												Muscles
											</Text>
											<Text fz="sm">
												{exerciseDetails.data.attributes.muscles
													.map((s) => startCase(s.toLowerCase()))
													.join(", ")}
											</Text>
										</Group>
									</>
								) : undefined}
								{exerciseDetails.data.attributes.instructions.length > 0 ? (
									<>
										<Divider />
										<Text size="xl" fw="bold">
											Instructions
										</Text>
										<List type="ordered" spacing="xs">
											{exerciseDetails.data.attributes.instructions.map((d) => (
												<List.Item key={d}>{d}</List.Item>
											))}
										</List>
									</>
								) : undefined}
							</Stack>
						</Tabs.Panel>
						<Tabs.Panel value="history">
							{userExerciseDetails.data ? (
								<Stack>
									{userExerciseDetails.data.history.map((h) => (
										<Paper key={h.workoutId} withBorder p="xs">
											<Anchor
												component={Link}
												href={withQuery(APP_ROUTES.fitness.workoutDetails, {
													id: h.workoutId,
												})}
												fw="bold"
											>
												{h.workoutName}
											</Anchor>
											<Text c="dimmed" fz="sm" mb="xs">
												{DateTime.fromJSDate(h.workoutTime).toLocaleString(
													DateTime.DATETIME_MED_WITH_WEEKDAY,
												)}
											</Text>
											{h.sets.map((s, idx) => (
												<Flex key={`${idx}`} align="center">
													<Text
														fz="sm"
														c={getSetColor(s.lot)}
														mr="md"
														fw="bold"
														ff="monospace"
													>
														{match(s.lot)
															.with(SetLot.Normal, () => idx + 1)
															.otherwise(() => s.lot.at(0))}
													</Text>
													<DisplayExerciseStats
														lot={exerciseDetails.data.lot}
														statistic={s.statistic}
													/>
												</Flex>
											))}
										</Paper>
									))}
								</Stack>
							) : (
								<Text fs="italic">No history found</Text>
							)}
						</Tabs.Panel>
						<Tabs.Panel value="records">
							{userExerciseDetails.data ? (
								<Stack>
									<Box>
										<Text size="xs" c="dimmed">
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
								<Text fs="italic">No records found</Text>
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
