import { useCoreDetails, useUserPreferences } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import {
	Alert,
	Container,
	Divider,
	Flex,
	Group,
	JsonInput,
	NumberInput,
	Paper,
	Select,
	SimpleGrid,
	Stack,
	Switch,
	Tabs,
	Text,
	Title,
	rem,
} from "@mantine/core";
import { useListState, useLocalStorage } from "@mantine/hooks";
import {
	DashboardElementLot,
	UpdateUserPreferenceDocument,
	type UpdateUserPreferenceMutationVariables,
	UserReviewScale,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, snakeCase, startCase } from "@ryot/ts-utils";
import { IconAlertCircle, IconGripVertical } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import Head from "next/head";
import { Fragment, type ReactElement, useEffect } from "react";
import { match } from "ts-pattern";
import type { NextPageWithLayout } from "../_app";
import classes from "./styles.module.css";

function usePageHooks() {
	const userPreferences = useUserPreferences();
	const coreDetails = useCoreDetails();
	const updateUserPreferences = useMutation({
		mutationFn: async (variables: UpdateUserPreferenceMutationVariables) => {
			const { updateUserPreference } = await gqlClient.request(
				UpdateUserPreferenceDocument,
				variables,
			);
			return updateUserPreference;
		},
		onSuccess: () => {
			userPreferences.refetch();
		},
	});
	return { userPreferences, coreDetails, updateUserPreferences };
}

const EditDashboardElement = (props: {
	lot: DashboardElementLot;
	index: number;
}) => {
	const { userPreferences, coreDetails, updateUserPreferences } =
		usePageHooks();
	const focusedElementIndex = userPreferences.data?.general.dashboard.findIndex(
		(de) => de.section === props.lot,
	);
	const focusedElement =
		typeof focusedElementIndex === "number"
			? userPreferences.data?.general.dashboard[focusedElementIndex]
			: undefined;

	return typeof focusedElementIndex === "number" &&
		focusedElement &&
		userPreferences.data &&
		coreDetails.data ? (
		<Draggable index={props.index} draggableId={props.lot}>
			{(provided, snapshot) => (
				<Paper
					withBorder
					p="xs"
					ref={provided.innerRef}
					{...provided.draggableProps}
					className={clsx({ [classes.itemDragging]: snapshot.isDragging })}
				>
					<Group justify="space-between">
						<Group>
							<div
								{...provided.dragHandleProps}
								style={{
									display: "flex",
									justifyContent: "center",
									height: "100%",
								}}
							>
								<IconGripVertical
									style={{ width: rem(18), height: rem(18) }}
									stroke={1.5}
								/>
							</div>
							<Title order={3}>{changeCase(props.lot)}</Title>
						</Group>
						<Switch
							label="Hidden"
							labelPosition="left"
							defaultChecked={focusedElement.hidden}
							disabled={!coreDetails.data.preferencesChangeAllowed}
							onChange={(ev) => {
								const newValue = ev.currentTarget.checked;
								const newDashboardData = Array.from(
									userPreferences.data.general.dashboard,
								);
								newDashboardData[focusedElementIndex].hidden = newValue;
								updateUserPreferences.mutate({
									input: {
										property: "general.dashboard",
										value: JSON.stringify(newDashboardData),
									},
								});
							}}
						/>
					</Group>
					{typeof focusedElement.numElements === "number" ? (
						<Flex>
							<NumberInput
								label="Number of elements"
								size="xs"
								defaultValue={focusedElement.numElements}
								disabled={!coreDetails.data.preferencesChangeAllowed}
								onChange={(num) => {
									if (typeof num === "number") {
										const newDashboardData = Array.from(
											userPreferences.data.general.dashboard,
										);
										newDashboardData[focusedElementIndex].numElements = num;
										updateUserPreferences.mutate({
											input: {
												property: "general.dashboard",
												value: JSON.stringify(newDashboardData),
											},
										});
									}
								}}
							/>
						</Flex>
					) : undefined}
				</Paper>
			)}
		</Draggable>
	) : undefined;
};

const Page: NextPageWithLayout = () => {
	const { userPreferences, coreDetails, updateUserPreferences } =
		usePageHooks();
	const [dashboardElements, dashboardElementsHandlers] = useListState(
		userPreferences.data?.general.dashboard || [],
	);
	const [activeTab, setActiveTab] = useLocalStorage({
		defaultValue: "dashboard",
		key: "savedPreferencesTab",
	});
	useEffect(() => {
		updateUserPreferences.mutate({
			input: {
				property: "general.dashboard",
				value: JSON.stringify(dashboardElements),
			},
		});
	}, [dashboardElements]);

	return userPreferences.data && coreDetails.data ? (
		<>
			<Head>
				<title>Preferences | Ryot</title>
			</Head>
			<Container size="xs">
				<Stack>
					<Title>Preferences</Title>
					{!coreDetails.data.preferencesChangeAllowed ? (
						<Alert
							icon={<IconAlertCircle size="1rem" />}
							variant="outline"
							color="violet"
						>
							Changing preferences is disabled on this instance.
						</Alert>
					) : undefined}
					<Tabs
						value={activeTab}
						onChange={(v) => {
							if (v) setActiveTab(v);
						}}
					>
						<Tabs.List>
							<Tabs.Tab value="dashboard">Dashboard</Tabs.Tab>
							<Tabs.Tab value="general">General</Tabs.Tab>
							<Tabs.Tab value="notifications">Notifications</Tabs.Tab>
							<Tabs.Tab value="fitness">Fitness</Tabs.Tab>
						</Tabs.List>
						<Tabs.Panel value="dashboard" mt="md">
							<Text size="lg" mb="md">
								The different sections on the dashboard
							</Text>
							<DragDropContext
								onDragEnd={({ destination, source }) =>
									dashboardElementsHandlers.reorder({
										from: source.index,
										to: destination?.index || 0,
									})
								}
							>
								<Droppable droppableId="dnd-list">
									{(provided) => (
										<Stack {...provided.droppableProps} ref={provided.innerRef}>
											{dashboardElements.map((de, index) => (
												<EditDashboardElement
													key={de.section}
													lot={de.section}
													index={index}
												/>
											))}
											{provided.placeholder}
										</Stack>
									)}
								</Droppable>
							</DragDropContext>
						</Tabs.Panel>
						<Tabs.Panel value="general" mt="md">
							<Stack>
								<Text>Features that you want to use.</Text>
								{["media", "fitness"].map((facet) => (
									<Fragment key={facet}>
										<Title order={4}>{startCase(facet)}</Title>
										<SimpleGrid cols={2}>
											{Object.entries(
												// biome-ignore lint/suspicious/noExplicitAny: required here
												(userPreferences.data.featuresEnabled as any)[facet],
											).map(([name, isEnabled]) => (
												<Switch
													size="xs"
													key={name}
													label={changeCase(snakeCase(name))}
													// biome-ignore lint/suspicious/noExplicitAny: required here
													checked={isEnabled as any}
													disabled={!coreDetails.data.preferencesChangeAllowed}
													onChange={(ev) => {
														const lot = snakeCase(name);
														updateUserPreferences.mutate({
															input: {
																property: `features_enabled.${facet}.${lot}`,
																value: String(ev.currentTarget.checked),
															},
														});
													}}
												/>
											))}
										</SimpleGrid>
									</Fragment>
								))}
								<Divider />
								<Title order={3} mb={-10}>
									General
								</Title>
								<SimpleGrid cols={2} style={{ alignItems: "center" }}>
									<Select
										size="xs"
										label="Scale used for rating in reviews"
										data={Object.values(UserReviewScale).map((c) => ({
											label: startCase(snakeCase(c)),
											value: c,
										}))}
										defaultValue={userPreferences.data.general.reviewScale}
										disabled={!coreDetails.data.preferencesChangeAllowed}
										onChange={(val) => {
											if (val)
												updateUserPreferences.mutate({
													input: {
														property: "general.review_scale",
														value: val,
													},
												});
										}}
									/>
									<Switch
										size="xs"
										mt="md"
										label={"Whether NSFW will be displayed"}
										checked={userPreferences.data.general.displayNsfw}
										disabled={!coreDetails.data.preferencesChangeAllowed}
										onChange={(ev) => {
											updateUserPreferences.mutate({
												input: {
													property: "general.display_nsfw",
													value: String(ev.currentTarget.checked),
												},
											});
										}}
									/>
								</SimpleGrid>
							</Stack>
						</Tabs.Panel>
						<Tabs.Panel value="notifications" mt="md">
							<Stack>
								<Text>
									The following applies to media in your Watchlist or the ones
									you have monitored explicitly.
								</Text>
								<SimpleGrid cols={2}>
									{Object.entries(userPreferences.data.notifications).map(
										([name, isEnabled]) => (
											<Switch
												key={name}
												size="xs"
												label={match(name)
													.with(
														"episodeNameChanged",
														() => "Name of an episode changes",
													)
													.with(
														"episodeReleased",
														() => "Number of episodes changes",
													)
													.with("statusChanged", () => "Status changes")
													.with(
														"releaseDateChanged",
														() => "Release date changes",
													)
													.with(
														"numberOfSeasonsChanged",
														() => "Number of seasons changes",
													)
													.with(
														"numberOfChaptersOrEpisodesChanged",
														() =>
															"Number of chapters/episodes changes for manga/anime",
													)
													.otherwise(() => undefined)}
												checked={isEnabled}
												disabled={!coreDetails.data.preferencesChangeAllowed}
												onChange={(ev) => {
													updateUserPreferences.mutate({
														input: {
															property: `notifications.${snakeCase(name)}`,
															value: String(ev.currentTarget.checked),
														},
													});
												}}
											/>
										),
									)}
								</SimpleGrid>
							</Stack>
						</Tabs.Panel>
						<Tabs.Panel value="fitness" mt="md">
							<Stack>
								<Text>The default measurements you want to keep track of.</Text>
								<SimpleGrid cols={2}>
									{Object.entries(
										userPreferences.data.fitness.measurements.inbuilt,
									).map(([name, isEnabled]) => (
										<Switch
											size="xs"
											key={name}
											label={changeCase(snakeCase(name))}
											checked={isEnabled}
											disabled={!coreDetails.data.preferencesChangeAllowed}
											onChange={(ev) => {
												updateUserPreferences.mutate({
													input: {
														property: `fitness.measurements.inbuilt.${snakeCase(
															name,
														)}`,
														value: String(ev.currentTarget.checked),
													},
												});
											}}
										/>
									))}
								</SimpleGrid>
								<JsonInput
									label="The custom metrics you want to keep track of"
									description="The name of the attribute along with the data type. Only decimal data type is supported."
									defaultValue={JSON.stringify(
										userPreferences.data.fitness.measurements.custom,
										null,
										4,
									)}
									disabled={!coreDetails.data.preferencesChangeAllowed}
									autosize
									formatOnBlur
									onChange={(v) => {
										updateUserPreferences.mutate({
											input: {
												property: "fitness.measurements.custom.dummy",
												value: v,
											},
										});
									}}
								/>
								<SimpleGrid cols={1}>
									{/*
							// TODO: Introduce this back when we figure out a way to handle units
							<Select
								size="xs"
								label="Unit system to use for measurements"
								data={Object.values(UserUnitSystem).map((c) => startCase(c))}
								defaultValue={userPreferences.data.fitness.exercises.unitSystem}
								disabled={!coreDetails.data.preferencesChangeAllowed}
								onChange={(val) => {
									if (val)
										updateUserEnabledFeatures.mutate({
											input: {
												property: "fitness.exercises.unit_system",
												value: val,
											},
										});
								}}
							/>
							*/}
									<NumberInput
										size="xs"
										label="The number of elements to save in your exercise history"
										defaultValue={
											userPreferences.data.fitness.exercises.saveHistory
										}
										disabled={!coreDetails.data.preferencesChangeAllowed}
										onChange={(num) => {
											if (num)
												updateUserPreferences.mutate({
													input: {
														property: "fitness.exercises.save_history",
														value: String(num),
													},
												});
										}}
									/>
								</SimpleGrid>
							</Stack>
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
