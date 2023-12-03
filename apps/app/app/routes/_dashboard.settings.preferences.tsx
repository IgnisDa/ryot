import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import {
	ActionIcon,
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
import { useListState } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
	DashboardElementLot,
	UserReviewScale,
	UserUnitSystem,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, snakeCase, startCase } from "@ryot/ts-utils";
import {
	IconAlertCircle,
	IconBellRinging,
	IconGripVertical,
	IconRotate360,
} from "@tabler/icons-react";
import clsx from "clsx";
import { Fragment } from "react";
import { match } from "ts-pattern";
import { getCoreDetails, getUserPreferences } from "~/lib/graphql.server";
import classes from "~/styles/preferences.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const [coreDetails, userPreferences] = await Promise.all([
		getCoreDetails(),
		getUserPreferences(request),
	]);
	return json({ coreDetails, userPreferences });
};

export const meta: MetaFunction = () => {
	return [{ title: "Preference | Ryot" }];
};

const notificationContent = {
	title: "Invalid action",
	color: "red",
	message: "Changing preferences is disabled on this instance.",
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [dashboardElements, dashboardElementsHandlers] = useListState(
		loaderData.userPreferences.general.dashboard,
	);

	return (
		<Container size="xs">
			<Stack>
				<Group justify="space-between">
					<Title>Preferences</Title>
					<ActionIcon
						color="red"
						variant="outline"
						onClick={async () => {
							const yes = confirm(
								"This will reset all your preferences to default. Are you sure you want to continue?",
							);
							if (loaderData.coreDetails.preferencesChangeAllowed) {
								if (yes) {
									await updateUserPreferences.mutateAsync({
										input: {
											property: "",
											value: "",
										},
									});
									router.reload();
								}
							} else notifications.show(notificationContent);
						}}
					>
						<IconRotate360 size={20} />
					</ActionIcon>
				</Group>
				{!loaderData.coreDetails.preferencesChangeAllowed ? (
					<Alert
						icon={<IconAlertCircle size={16} />}
						variant="outline"
						color="violet"
					>
						{notificationContent.message}
					</Alert>
				) : undefined}
				<Tabs defaultValue="dashboard">
					<Tabs.List>
						<Tabs.Tab value="dashboard">Dashboard</Tabs.Tab>
						<Tabs.Tab value="general">General</Tabs.Tab>
						<Tabs.Tab value="notifications">Notifications</Tabs.Tab>
						<Tabs.Tab value="fitness">Fitness</Tabs.Tab>
					</Tabs.List>
					<Tabs.Panel value="dashboard" mt="md">
						<Text mb="md">The different sections on the dashboard.</Text>
						<DragDropContext
							onDragEnd={({ destination, source }) => {
								if (loaderData.coreDetails.preferencesChangeAllowed)
									dashboardElementsHandlers.reorder({
										from: source.index,
										to: destination?.index || 0,
									});
								else notifications.show(notificationContent);
							}}
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
											(loaderData.userPreferences.featuresEnabled as any)[
												facet
											],
										).map(([name, isEnabled]) => (
											<Switch
												size="xs"
												key={name}
												label={changeCase(snakeCase(name))}
												// biome-ignore lint/suspicious/noExplicitAny: required here
												checked={isEnabled as any}
												disabled={
													!loaderData.coreDetails.preferencesChangeAllowed
												}
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
									defaultValue={loaderData.userPreferences.general.reviewScale}
									disabled={!loaderData.coreDetails.preferencesChangeAllowed}
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
									label="Whether NSFW will be displayed"
									checked={loaderData.userPreferences.general.displayNsfw}
									disabled={!loaderData.coreDetails.preferencesChangeAllowed}
									onChange={(ev) => {
										updateUserPreferences.mutate({
											input: {
												property: "general.display_nsfw",
												value: String(ev.currentTarget.checked),
											},
										});
									}}
								/>
								<Switch
									size="xs"
									mt="md"
									label="Disable yank integrations"
									checked={
										loaderData.userPreferences.general.disableYankIntegrations
									}
									disabled={!loaderData.coreDetails.preferencesChangeAllowed}
									onChange={(ev) => {
										updateUserPreferences.mutate({
											input: {
												property: "general.disable_yank_integrations",
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
								{Object.entries(loaderData.userPreferences.notifications).map(
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
													"episodeImagesChanged",
													() => "Images for an episode changes",
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
											disabled={
												!loaderData.coreDetails.preferencesChangeAllowed
											}
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
							<SimpleGrid
								cols={{ base: 1, md: 2 }}
								style={{ alignItems: "center" }}
							>
								<NumberInput
									size="xs"
									label="The default rest timer to use during exercises. Leave empty for no default."
									defaultValue={
										loaderData.userPreferences.fitness.exercises.defaultTimer ||
										undefined
									}
									disabled={!loaderData.coreDetails.preferencesChangeAllowed}
									onChange={(num) => {
										updateUserPreferences.mutate({
											input: {
												property: "fitness.exercises.default_timer",
												value: String(num),
											},
										});
									}}
								/>
								<NumberInput
									size="xs"
									label="The number of elements to save in your exercise history."
									defaultValue={
										loaderData.userPreferences.fitness.exercises.saveHistory
									}
									disabled={!loaderData.coreDetails.preferencesChangeAllowed}
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
								<Group wrap="nowrap">
									<ActionIcon
										onClick={async () => {
											if (Notification.permission !== "granted") {
												await Notification.requestPermission();
												router.reload();
											}
										}}
										color={
											typeof window !== "undefined" &&
											Notification.permission === "granted"
												? "green"
												: "red"
										}
									>
										<IconBellRinging />
									</ActionIcon>
									<Text size="xs">
										Show me notifications related to the current workout
									</Text>
								</Group>
								<Select
									size="xs"
									label="Unit system to use for measurements"
									data={Object.values(UserUnitSystem).map((c) => ({
										value: c.toLowerCase(),
										label: startCase(c.toLowerCase()),
									}))}
									defaultValue={loaderData.userPreferences.fitness.exercises.unitSystem.toLowerCase()}
									disabled={!loaderData.coreDetails.preferencesChangeAllowed}
									onChange={(val) => {
										if (val)
											updateUserPreferences.mutate({
												input: {
													property: "fitness.exercises.unit_system",
													value: val,
												},
											});
									}}
								/>
							</SimpleGrid>
							<Text>The default measurements you want to keep track of.</Text>
							<SimpleGrid cols={2}>
								{Object.entries(
									loaderData.userPreferences.fitness.measurements.inbuilt,
								).map(([name, isEnabled]) => (
									<Switch
										size="xs"
										key={name}
										label={changeCase(snakeCase(name))}
										checked={isEnabled}
										disabled={!loaderData.coreDetails.preferencesChangeAllowed}
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
									loaderData.userPreferences.fitness.measurements.custom,
									null,
									4,
								)}
								disabled={!loaderData.coreDetails.preferencesChangeAllowed}
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
						</Stack>
					</Tabs.Panel>
				</Tabs>
			</Stack>
		</Container>
	);
}

const EditDashboardElement = (props: {
	lot: DashboardElementLot;
	index: number;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const focusedElementIndex =
		loaderData.userPreferences.general.dashboard.findIndex(
			(de) => de.section === props.lot,
		);
	const focusedElement =
		loaderData.userPreferences.general.dashboard[focusedElementIndex];

	return (
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
									cursor: "grab",
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
							disabled={!loaderData.coreDetails.preferencesChangeAllowed}
							onChange={(ev) => {
								const newValue = ev.currentTarget.checked;
								const newDashboardData = Array.from(
									loaderData.userPreferences.general.dashboard,
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
								disabled={!loaderData.coreDetails.preferencesChangeAllowed}
								onChange={(num) => {
									if (typeof num === "number") {
										const newDashboardData = Array.from(
											loaderData.userPreferences.general.dashboard,
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
	);
};
