import { useCoreDetails, useUserPreferences } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import {
	Alert,
	Container,
	Divider,
	JsonInput,
	NumberInput,
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
	UpdateUserPreferenceDocument,
	type UpdateUserPreferenceMutationVariables,
	UserReviewScale,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, snakeCase, startCase } from "@ryot/ts-utils";
import { IconAlertCircle, IconGripVertical } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import clsx from "clsx";
import Head from "next/head";
import { Fragment, type ReactElement } from "react";
import { match } from "ts-pattern";
import type { NextPageWithLayout } from "../_app";
import classes from "./styles.module.css";

const data = [
	{ position: 6, mass: 12.011, symbol: "C", name: "Carbon" },
	{ position: 7, mass: 14.007, symbol: "N", name: "Nitrogen" },
	{ position: 39, mass: 88.906, symbol: "Y", name: "Yttrium" },
	{ position: 56, mass: 137.33, symbol: "Ba", name: "Barium" },
	{ position: 58, mass: 140.12, symbol: "Ce", name: "Cerium" },
];

const Page: NextPageWithLayout = () => {
	const userPreferences = useUserPreferences();
	const coreDetails = useCoreDetails();
	const [activeTab, setActiveTab] = useLocalStorage({
		defaultValue: "dashboard",
		key: "savedPreferencesTab",
	});
	const [state, handlers] = useListState(data);

	const updateUserEnabledFeatures = useMutation({
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

	const items = state.map((item, index) => (
		<Draggable key={item.symbol} index={index} draggableId={item.symbol}>
			{(provided, snapshot) => (
				<div
					className={clsx(classes.item, {
						[classes.itemDragging]: snapshot.isDragging,
					})}
					ref={provided.innerRef}
					{...provided.draggableProps}
				>
					<div {...provided.dragHandleProps} className={classes.dragHandle}>
						<IconGripVertical
							style={{ width: rem(18), height: rem(18) }}
							stroke={1.5}
						/>
					</div>
					<Text className={classes.symbol}>{item.symbol}</Text>
					<div>
						<Text>{item.name}</Text>
						<Text c="dimmed" size="sm">
							Position: {item.position} • Mass: {item.mass}
						</Text>
					</div>
				</div>
			)}
		</Draggable>
	));

	return userPreferences.data && coreDetails.data ? (
		<>
			<Head>
				<title>Preferences | Ryot</title>
			</Head>
			<Container size="xs">
				<Title>Preferences</Title>
				{!coreDetails.data.preferencesChangeAllowed ? (
					<Alert
						mt="md"
						p="xs"
						icon={<IconAlertCircle size="1rem" />}
						variant="outline"
						color="violet"
					>
						Changing preferences is disabled on this instance.
					</Alert>
				) : undefined}
				<Tabs
					mt="md"
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
						<DragDropContext
							onDragEnd={({ destination, source }) =>
								handlers.reorder({
									from: source.index,
									to: destination?.index || 0,
								})
							}
						>
							<Droppable droppableId="dnd-list" direction="vertical">
								{(provided) => (
									<div {...provided.droppableProps} ref={provided.innerRef}>
										{items}
										{provided.placeholder}
									</div>
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
													updateUserEnabledFeatures.mutate({
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
											updateUserEnabledFeatures.mutate({
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
										updateUserEnabledFeatures.mutate({
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
								The following applies to media in your Watchlist or the ones you
								have monitored explicitly.
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
												updateUserEnabledFeatures.mutate({
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
											updateUserEnabledFeatures.mutate({
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
									updateUserEnabledFeatures.mutate({
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
											updateUserEnabledFeatures.mutate({
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
