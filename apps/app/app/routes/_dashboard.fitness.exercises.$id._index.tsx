import {
	Anchor,
	Box,
	Button,
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
import { useDisclosure } from "@mantine/hooks";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import {
	EntityLot,
	ExerciseDetailsDocument,
	SetLot,
	UserCollectionsListDocument,
	UserExerciseDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { startCase } from "@ryot/ts-utils";
import {
	IconHistoryToggle,
	IconInfoCircle,
	IconTrophy,
	IconUser,
} from "@tabler/icons-react";
import { DateTime } from "luxon";
import { $path } from "remix-routes";
import invariant from "tiny-invariant";
import { match } from "ts-pattern";
import { DisplayExerciseStats } from "~/components/fitness";
import {
	AddEntityToCollectionModal,
	DisplayCollection,
	MediaScrollArea,
} from "~/components/media";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getCoreDetails, getUserPreferences } from "~/lib/graphql.server";
import { getSetColor } from "~/lib/utilities";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
	const exerciseId = params.id;
	invariant(typeof exerciseId === "string", "id must be a string");
	const [
		coreDetails,
		userPreferences,
		{ exerciseDetails },
		{ userExerciseDetails },
		{ userCollectionsList: collections },
	] = await Promise.all([
		getCoreDetails(),
		getUserPreferences(request),
		gqlClient.request(ExerciseDetailsDocument, { exerciseId }),
		gqlClient.request(
			UserExerciseDetailsDocument,
			{ input: { exerciseId } },
			await getAuthorizationHeader(request),
		),
		gqlClient.request(
			UserCollectionsListDocument,
			{},
			await getAuthorizationHeader(request),
		),
	]);
	return json({
		exerciseDetails,
		userExerciseDetails,
		coreDetails,
		userPreferences,
		exerciseId,
		collections,
	});
};

export const meta: MetaFunction = ({ data }) => {
	return [
		{
			title: `${
				// biome-ignore lint/suspicious/noExplicitAny:
				(data as any).exerciseDetails.id
			} | Ryot`,
		},
	];
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [
		collectionModalOpened,
		{ open: collectionModalOpen, close: collectionModalClose },
	] = useDisclosure(false);

	return (
		<Container size="xs" px="lg">
			<Stack>
				<Title id="exercise-title">{loaderData.exerciseDetails.id}</Title>
				{loaderData.userExerciseDetails.collections.length > 0 ? (
					<Group id="entity-collections">
						{loaderData.userExerciseDetails.collections.map((col) => (
							<DisplayCollection
								col={col}
								entityId={loaderData.exerciseDetails.id}
								entityLot={EntityLot.Exercise}
								key={col.id}
							/>
						))}
					</Group>
				) : undefined}
				<Tabs variant="outline" defaultValue="overview">
					<Tabs.List mb="xs">
						<Tabs.Tab
							value="overview"
							leftSection={<IconInfoCircle size={16} />}
						>
							Overview
						</Tabs.Tab>
						{loaderData.userExerciseDetails.history ? (
							<Tabs.Tab
								value="history"
								leftSection={<IconHistoryToggle size={16} />}
							>
								History
							</Tabs.Tab>
						) : undefined}
						{loaderData.userExerciseDetails.details ? (
							<Tabs.Tab value="records" leftSection={<IconTrophy size={16} />}>
								Records
							</Tabs.Tab>
						) : undefined}
						<Tabs.Tab value="actions" leftSection={<IconUser size={16} />}>
							Actions
						</Tabs.Tab>
					</Tabs.List>
					<Tabs.Panel value="overview">
						<Stack>
							<ScrollArea>
								<Flex gap={6}>
									{loaderData.exerciseDetails.attributes.images.map((i) => (
										<Image key={i} radius="md" src={i} h="200px" w="248px" />
									))}
								</Flex>
							</ScrollArea>
							<SimpleGrid py="xs" cols={4}>
								{["level", "force", "mechanic", "equipment"].map((f) => (
									<>
										{/* biome-ignore lint/suspicious/noExplicitAny: required here */}
										{(loaderData.exerciseDetails as any)[f] ? (
											<DisplayData
												name={f}
												// biome-ignore lint/suspicious/noExplicitAny: required here
												data={(loaderData.exerciseDetails as any)[f]}
												key={f}
											/>
										) : undefined}
									</>
								))}
							</SimpleGrid>
							{loaderData.exerciseDetails.muscles.length > 0 ? (
								<>
									<Divider />
									<Group wrap="nowrap">
										<Text c="dimmed" fz="sm">
											Muscles
										</Text>
										<Text fz="sm">
											{loaderData.exerciseDetails.muscles
												.map((s) => startCase(s.toLowerCase()))
												.join(", ")}
										</Text>
									</Group>
								</>
							) : undefined}
							{loaderData.exerciseDetails.attributes.instructions.length > 0 ? (
								<>
									<Divider />
									<Text size="xl" fw="bold">
										Instructions
									</Text>
									<List type="ordered" spacing="xs">
										{loaderData.exerciseDetails.attributes.instructions.map(
											(d) => (
												<List.Item key={d}>{d}</List.Item>
											),
										)}
									</List>
								</>
							) : undefined}
						</Stack>
					</Tabs.Panel>
					{loaderData.userExerciseDetails.history ? (
						<Tabs.Panel value="history">
							<Stack>
								{loaderData.userExerciseDetails.history.map((h) => (
									<Paper key={h.workoutId} withBorder p="xs">
										<Anchor
											component={Link}
											to={$path("/fitness/workouts/:id", {
												id: h.workoutId,
											})}
											fw="bold"
										>
											{h.workoutName}
										</Anchor>
										<Text c="dimmed" fz="sm" mb="xs">
											{DateTime.fromISO(h.workoutTime).toLocaleString(
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
													lot={loaderData.exerciseDetails.lot}
													statistic={s.statistic}
												/>
											</Flex>
										))}
									</Paper>
								))}
							</Stack>
						</Tabs.Panel>
					) : undefined}
					{loaderData.userExerciseDetails.details?.exerciseExtraInformation ? (
						<Tabs.Panel value="records">
							<Stack>
								<Box>
									<Text size="xs" c="dimmed">
										LIFETIME STATS
									</Text>
									<DisplayLifetimeStatistic
										stat="weight"
										unit="KG"
										val={
											loaderData.userExerciseDetails.details
												.exerciseExtraInformation.lifetimeStats.weight
										}
									/>
									<DisplayLifetimeStatistic
										stat="distance"
										unit="KM"
										val={
											loaderData.userExerciseDetails.details
												.exerciseExtraInformation.lifetimeStats.distance
										}
									/>
									<DisplayLifetimeStatistic
										stat="duration"
										unit="MIN"
										val={
											loaderData.userExerciseDetails.details
												.exerciseExtraInformation.lifetimeStats.duration
										}
									/>
									<DisplayLifetimeStatistic
										stat="reps"
										val={
											loaderData.userExerciseDetails.details
												.exerciseExtraInformation.lifetimeStats.reps
										}
									/>
									<DisplayLifetimeStatistic
										stat="times done"
										val={
											loaderData.userExerciseDetails.details.numTimesInteracted
										}
									/>
								</Box>
								<Text c="teal" ta="center" size="sm" mt="xl">
									This section is still WIP
								</Text>
							</Stack>
						</Tabs.Panel>
					) : undefined}
					<Tabs.Panel value="actions">
						<MediaScrollArea coreDetails={loaderData.coreDetails}>
							<SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
								<Button variant="outline" onClick={collectionModalOpen}>
									Add to collection
								</Button>
								<AddEntityToCollectionModal
									onClose={collectionModalClose}
									opened={collectionModalOpened}
									entityId={loaderData.exerciseDetails.id}
									entityLot={EntityLot.Exercise}
									collections={loaderData.collections.map((c) => c.name)}
								/>
							</SimpleGrid>
						</MediaScrollArea>
					</Tabs.Panel>
				</Tabs>
			</Stack>
		</Container>
	);
}

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
				{Number(props.val).toFixed(2)} {props.unit}
			</Text>
		</Flex>
	) : undefined;
};
