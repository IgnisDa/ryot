import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import {
	ActionIcon,
	Affix,
	Alert,
	Button,
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
	TagsInput,
	Text,
	Title,
	Tooltip,
	rem,
} from "@mantine/core";
import { useListState } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { unstable_defineAction, unstable_defineLoader } from "@remix-run/node";
import type { MetaArgs_SingleFetch } from "@remix-run/react";
import { Form, useLoaderData } from "@remix-run/react";
import {
	type DashboardElementLot,
	MediaStateChanged,
	UpdateUserPreferenceDocument,
	UserReviewScale,
	UserUnitSystem,
} from "@ryot/generated/graphql/backend/graphql";
import {
	camelCase,
	changeCase,
	isNumber,
	snakeCase,
	startCase,
} from "@ryot/ts-utils";
import { IconCheckbox } from "@tabler/icons-react";
import {
	IconAlertCircle,
	IconBellRinging,
	IconGripVertical,
	IconRotate360,
} from "@tabler/icons-react";
import clsx from "clsx";
import { Fragment, useState } from "react";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { confirmWrapper } from "~/components/confirmation";
import { queryClient, queryFactory } from "~/lib/generals";
import { useConfirmSubmit, useUserPreferences } from "~/lib/hooks";
import {
	createToastHeaders,
	isWorkoutActive,
	redirectIfNotAuthenticatedOrUpdated,
	serverGqlService,
} from "~/lib/utilities.server";
import classes from "~/styles/preferences.module.css";

const searchSchema = z.object({
	defaultTab: z.string().default("dashboard").optional(),
});

export const loader = unstable_defineLoader(async ({ request }) => {
	const query = zx.parseQuery(request, searchSchema);
	const workoutInProgress = isWorkoutActive(request);
	return { query, workoutInProgress };
});

export const meta = (_args: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: "Preference | Ryot" }];
};

const notificationContent = {
	title: "Invalid action",
	color: "red",
	message:
		"Changing preferences is disabled for demo users. Please create an account to save your preferences.",
};

export const action = unstable_defineAction(async ({ request }) => {
	const userDetails = await redirectIfNotAuthenticatedOrUpdated(request);
	const entries = Object.entries(Object.fromEntries(await request.formData()));
	const submission = [];
	for (let [property, value] of entries) {
		if (property === "reset") {
			property = "";
			value = "";
		}
		submission.push({
			property,
			value: value.toString(),
		});
	}
	for (const input of submission) {
		await serverGqlService.authenticatedRequest(
			request,
			UpdateUserPreferenceDocument,
			{ input },
		);
	}
	queryClient.removeQueries({
		queryKey: queryFactory.users.preferences(userDetails.id).queryKey,
	});
	const toastHeaders = await createToastHeaders({
		message: "Preferences updated",
		type: "success",
	});
	return Response.json({}, { headers: toastHeaders });
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const submit = useConfirmSubmit();
	const [dashboardElements, setDashboardElements] = useState(
		userPreferences.general.dashboard,
	);
	const [toUpdatePreferences, updateUserPreferencesHandler] = useListState<
		[string, string]
	>([]);
	const [defaultTab, setDefaultTab] = useState(
		loaderData.query.defaultTab || "dashboard",
	);
	const isEditDisabled = false;

	const appendPref = (property: string, value: string) => {
		const index = toUpdatePreferences.findIndex((p) => p[0] === property);
		if (index !== -1) updateUserPreferencesHandler.remove(index);
		updateUserPreferencesHandler.append([property, value]);
	};

	return (
		<Container size="xs">
			{toUpdatePreferences.length > 0 ? (
				<Affix
					position={{
						bottom: rem(45),
						right: rem(loaderData.workoutInProgress ? 100 : 40),
					}}
				>
					<Form
						replace
						method="POST"
						action={`?defaultTab=${defaultTab}`}
						onSubmit={() => updateUserPreferencesHandler.setState([])}
					>
						{toUpdatePreferences.map((pref) => (
							<input
								key={pref[0]}
								hidden
								name={pref[0]}
								value={pref[1]}
								readOnly
							/>
						))}
						<Button
							color="green"
							variant="outline"
							leftSection={<IconCheckbox size={20} />}
							type="submit"
						>
							Save changes ({toUpdatePreferences.length})
						</Button>
					</Form>
				</Affix>
			) : null}
			<Stack>
				<Group justify="space-between">
					<Title>Preferences</Title>
					<Form method="POST" reloadDocument>
						<input type="hidden" name="reset" defaultValue="reset" />
						<Tooltip label="Reset preferences">
							<ActionIcon
								color="red"
								type="submit"
								variant="outline"
								onClick={async (e) => {
									if (!isEditDisabled) {
										const form = e.currentTarget.form;
										e.preventDefault();
										const conf = await confirmWrapper({
											confirmation:
												"This will reset all your preferences to default. Are you sure you want to continue?",
										});
										if (conf && form) submit(form);
										else
											notifications.show({
												message:
													"Preferences have been reset. Please reload the page.",
												color: "green",
											});
									} else notifications.show(notificationContent);
								}}
							>
								<IconRotate360 size={20} />
							</ActionIcon>
						</Tooltip>
					</Form>
				</Group>
				{isEditDisabled ? (
					<Alert icon={<IconAlertCircle />} variant="outline" color="violet">
						{notificationContent.message}
					</Alert>
				) : null}
				<Tabs
					value={defaultTab}
					onChange={(value) => {
						if (value) setDefaultTab(value);
					}}
				>
					<Tabs.List mb="md">
						<Tabs.Tab value="dashboard">Dashboard</Tabs.Tab>
						<Tabs.Tab value="features">Features</Tabs.Tab>
						<Tabs.Tab value="general">General</Tabs.Tab>
						<Tabs.Tab value="notifications">Notifications</Tabs.Tab>
						<Tabs.Tab value="fitness">Fitness</Tabs.Tab>
					</Tabs.List>
					<Tabs.Panel value="dashboard">
						<Text mb="md">
							The different sections on the dashboard. Drag and drop using the
							handle to re-arrange them.
						</Text>
						<DragDropContext
							onDragEnd={({ destination, source }) => {
								if (!isEditDisabled) {
									const newOrder = reorder(dashboardElements, {
										from: source.index,
										to: destination?.index || 0,
									});
									setDashboardElements(newOrder);
									appendPref("general.dashboard", JSON.stringify(newOrder));
								} else notifications.show(notificationContent);
							}}
						>
							<Droppable droppableId="dnd-list">
								{(provided) => (
									<Stack {...provided.droppableProps} ref={provided.innerRef}>
										{dashboardElements.map((de, index) => (
											<EditDashboardElement
												index={index}
												key={de.section}
												lot={de.section}
												appendPref={appendPref}
												isEditDisabled={isEditDisabled}
											/>
										))}
										{provided.placeholder}
									</Stack>
								)}
							</Droppable>
						</DragDropContext>
					</Tabs.Panel>
					<Tabs.Panel value="features">
						<Stack>
							<Text>Features that you want to use.</Text>
							{(["media", "fitness", "others"] as const).map((facet) => (
								<Fragment key={facet}>
									<Title order={4}>{startCase(facet)}</Title>
									<SimpleGrid cols={2}>
										{Object.entries(userPreferences.featuresEnabled[facet]).map(
											([name, isEnabled]) => (
												<Switch
													key={name}
													size="xs"
													label={changeCase(snakeCase(name))}
													defaultChecked={isEnabled}
													disabled={!!isEditDisabled}
													onChange={(ev) => {
														const lot = snakeCase(name);
														appendPref(
															`features_enabled.${facet}.${lot}`,
															String(ev.currentTarget.checked),
														);
													}}
												/>
											),
										)}
									</SimpleGrid>
								</Fragment>
							))}
						</Stack>
					</Tabs.Panel>
					<Tabs.Panel value="general">
						<Stack gap="xl">
							<TagsInput
								label="Watch providers"
								placeholder="Enter more providers"
								defaultValue={userPreferences.general.watchProviders}
								disabled={!!isEditDisabled}
								onChange={(val) => {
									appendPref("general.watch_providers", JSON.stringify(val));
								}}
							/>
							<SimpleGrid cols={2} style={{ alignItems: "center" }}>
								{(
									[
										"displayNsfw",
										"disableIntegrations",
										"disableNavigationAnimation",
										"disableVideos",
										"disableReviews",
										"disableWatchProviders",
										"persistQueries",
									] as const
								).map((name) => (
									<Switch
										key={name}
										size="xs"
										label={match(name)
											.with(
												"displayNsfw",
												() => "Whether NSFW will be displayed",
											)
											.with(
												"disableIntegrations",
												() => "Disable all integrations",
											)
											.with(
												"disableNavigationAnimation",
												() => "Disable navigation animation",
											)
											.with("disableVideos", () => "Do not display videos")
											.with("disableReviews", () => "Do not display reviews")
											.with(
												"disableWatchProviders",
												() => 'Do not display the "Watch On" tab',
											)
											.with(
												"persistQueries",
												() => "Persist queries in the URL",
											)
											.exhaustive()}
										defaultChecked={userPreferences.general[name]}
										disabled={!!isEditDisabled}
										onChange={(ev) => {
											appendPref(
												`general.${snakeCase(name)}`,
												String(ev.currentTarget.checked),
											);
										}}
									/>
								))}
								<Select
									size="xs"
									label="Scale used for rating in reviews"
									data={Object.values(UserReviewScale).map((c) => ({
										label: startCase(snakeCase(c)),
										value: c,
									}))}
									defaultValue={userPreferences.general.reviewScale}
									disabled={!!isEditDisabled}
									onChange={(val) => {
										if (val) appendPref("general.review_scale", val);
									}}
								/>
							</SimpleGrid>
						</Stack>
					</Tabs.Panel>
					<Tabs.Panel value="notifications">
						<Stack>
							<Switch
								size="xs"
								label="Whether notifications will be sent"
								defaultChecked={userPreferences.notifications.enabled}
								disabled={!!isEditDisabled}
								onChange={(ev) => {
									appendPref(
										"notifications.enabled",
										String(ev.currentTarget.checked),
									);
								}}
							/>
							<Divider />
							<Text>
								The notifications you want to receive in your configured
								providers.
							</Text>
							<SimpleGrid cols={2}>
								{Object.values(MediaStateChanged).map((name) => (
									<Switch
										key={name}
										size="xs"
										label={match(name)
											.with(
												MediaStateChanged.MetadataEpisodeNameChanged,
												() => "Name of an episode changes",
											)
											.with(
												MediaStateChanged.MetadataEpisodeImagesChanged,
												() => "Images for an episode changes",
											)
											.with(
												MediaStateChanged.MetadataEpisodeReleased,
												() => "Number of episodes changes",
											)
											.with(
												MediaStateChanged.MetadataPublished,

												() => "A media is published",
											)
											.with(
												MediaStateChanged.MetadataStatusChanged,
												() => "Status changes",
											)
											.with(
												MediaStateChanged.MetadataReleaseDateChanged,
												() => "Release date changes",
											)
											.with(
												MediaStateChanged.MetadataNumberOfSeasonsChanged,
												() => "Number of seasons changes",
											)
											.with(
												MediaStateChanged.MetadataChaptersOrEpisodesChanged,
												() =>
													"Number of chapters/episodes changes for manga/anime",
											)
											.with(
												MediaStateChanged.ReviewPosted,
												() =>
													"A new public review is posted for media/people you monitor",
											)
											.with(
												MediaStateChanged.PersonMediaAssociated,
												() => "New media is associated with a person",
											)
											.exhaustive()}
										defaultChecked={userPreferences.notifications.toSend.includes(
											name,
										)}
										disabled={
											!!isEditDisabled || !userPreferences.notifications.enabled
										}
										onChange={() => {
											const alreadyToSend = new Set(
												userPreferences.notifications.toSend,
											);
											const alreadyHas = alreadyToSend.has(name);
											if (!alreadyHas) alreadyToSend.add(name);
											else alreadyToSend.delete(name);
											const val = Array.from(alreadyToSend).map((v) => {
												const n = camelCase(v.toLowerCase());
												return n[0].toUpperCase() + n.slice(1);
											});
											appendPref("notifications.to_send", JSON.stringify(val));
										}}
										styles={{ track: { flex: "none" } }}
									/>
								))}
							</SimpleGrid>
						</Stack>
					</Tabs.Panel>
					<Tabs.Panel value="fitness">
						<Stack>
							<SimpleGrid
								cols={{ base: 1, md: 2 }}
								style={{ alignItems: "center" }}
							>
								<Select
									size="xs"
									label="Unit system to use for measurements"
									data={Object.values(UserUnitSystem).map((c) => ({
										value: c.toLowerCase(),
										label: startCase(c.toLowerCase()),
									}))}
									defaultValue={userPreferences.fitness.exercises.unitSystem.toLowerCase()}
									disabled={!!isEditDisabled}
									onChange={(val) => {
										if (val) appendPref("fitness.exercises.unit_system", val);
									}}
								/>
								<Group wrap="nowrap">
									<ActionIcon
										onClick={async () => {
											if (Notification.permission !== "granted") {
												await Notification.requestPermission();
												window.location.reload();
											} else
												notifications.show({
													color: "yellow",
													message: "You have already granted permissions",
												});
										}}
									>
										<IconBellRinging />
									</ActionIcon>
									<Text size="xs">
										Show me notifications related to the current workout
									</Text>
								</Group>
							</SimpleGrid>
							<Text>The default measurements you want to keep track of.</Text>
							<SimpleGrid cols={2}>
								{Object.entries(
									userPreferences.fitness.measurements.inbuilt,
								).map(([name, isEnabled]) => (
									<Switch
										size="xs"
										key={name}
										label={changeCase(snakeCase(name))}
										defaultChecked={isEnabled}
										disabled={!!isEditDisabled}
										onChange={(ev) => {
											appendPref(
												`fitness.measurements.inbuilt.${snakeCase(name)}`,
												String(ev.currentTarget.checked),
											);
										}}
									/>
								))}
							</SimpleGrid>
							<JsonInput
								label="The custom metrics you want to keep track of"
								description="The name of the attribute along with the data type. Only decimal data type is supported."
								defaultValue={JSON.stringify(
									userPreferences.fitness.measurements.custom,
									null,
									4,
								)}
								disabled={!!isEditDisabled}
								autosize
								formatOnBlur
								onChange={(v) => {
									appendPref("fitness.measurements.custom.dummy", v);
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
	isEditDisabled: boolean;
	lot: DashboardElementLot;
	index: number;
	appendPref: (property: string, value: string) => void;
}) => {
	const userPreferences = useUserPreferences();
	const focusedElementIndex = userPreferences.general.dashboard.findIndex(
		(de) => de.section === props.lot,
	);
	const focusedElement = userPreferences.general.dashboard[focusedElementIndex];

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
							disabled={!!props.isEditDisabled}
							onChange={(ev) => {
								const newValue = ev.currentTarget.checked;
								const newDashboardData = Array.from(
									userPreferences.general.dashboard,
								);
								newDashboardData[focusedElementIndex].hidden = newValue;
								props.appendPref(
									"general.dashboard",
									JSON.stringify(newDashboardData),
								);
							}}
						/>
					</Group>
					{isNumber(focusedElement.numElements) ? (
						<Flex>
							<NumberInput
								label="Number of elements"
								size="xs"
								defaultValue={focusedElement.numElements}
								disabled={!!props.isEditDisabled}
								onChange={(num) => {
									if (isNumber(num)) {
										const newDashboardData = Array.from(
											userPreferences.general.dashboard,
										);
										newDashboardData[focusedElementIndex].numElements = num;
										props.appendPref(
											"general.dashboard",
											JSON.stringify(newDashboardData),
										);
									}
								}}
							/>
						</Flex>
					) : null}
				</Paper>
			)}
		</Draggable>
	);
};

const reorder = <T,>(
	array: Array<T>,
	{ from, to }: { from: number; to: number },
) => {
	const cloned = [...array];
	const item = array[from];
	cloned.splice(from, 1);
	cloned.splice(to, 0, item);
	return cloned;
};
