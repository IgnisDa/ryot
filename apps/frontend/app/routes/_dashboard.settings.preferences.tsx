import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import {
	ActionIcon,
	Affix,
	Alert,
	Button,
	Container,
	Divider,
	Group,
	Input,
	JsonInput,
	NumberInput,
	Paper,
	SegmentedControl,
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
import { notifications } from "@mantine/notifications";
import type {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaArgs,
} from "@remix-run/node";
import { Form, data, useLoaderData } from "@remix-run/react";
import {
	DashboardElementLot,
	GridPacking,
	MediaLot,
	MediaStateChanged,
	UpdateUserPreferenceDocument,
	UserReviewScale,
	UserUnitSystem,
} from "@ryot/generated/graphql/backend/graphql";
import {
	camelCase,
	changeCase,
	cn,
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
import { Fragment, useState } from "react";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { confirmWrapper } from "~/components/confirmation";
import { queryClient, queryFactory } from "~/lib/generals";
import {
	useComplexJsonUpdate,
	useConfirmSubmit,
	useDashboardLayoutData,
	useIsFitnessActionActive,
	useUserPreferences,
} from "~/lib/hooks";
import {
	createToastHeaders,
	redirectIfNotAuthenticatedOrUpdated,
	serverGqlService,
} from "~/lib/utilities.server";
import classes from "~/styles/preferences.module.css";

const searchSchema = z.object({
	defaultTab: z.string().default("dashboard").optional(),
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchSchema);
	return { query };
};

export const meta = (_args: MetaArgs<typeof loader>) => {
	return [{ title: "Preference | Ryot" }];
};

const notificationContent = {
	title: "Invalid action",
	color: "red",
	message:
		"Changing preferences is disabled for demo users. Please create an account to save your preferences.",
};

export const action = async ({ request }: ActionFunctionArgs) => {
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
		queryKey: queryFactory.users.details(userDetails.id).queryKey,
	});
	const toastHeaders = await createToastHeaders({
		message: "Preferences updated",
		type: "success",
	});
	return data({}, { headers: toastHeaders });
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const submit = useConfirmSubmit();
	const isFitnessActionActive = useIsFitnessActionActive();
	const [watchProviders, setWatchProviders] = useState(
		userPreferences.general.watchProviders.map((wp) => ({
			...wp,
			lot: snakeCase(wp.lot),
		})),
	);
	const [dashboardElements, setDashboardElements] = useState(
		userPreferences.general.dashboard,
	);
	const { toUpdatePreferences, appendPref, reset } = useComplexJsonUpdate();
	const [defaultTab, setDefaultTab] = useState(
		loaderData.query.defaultTab || "dashboard",
	);
	const dashboardData = useDashboardLayoutData();
	const isEditDisabled = dashboardData.isDemo;

	return (
		<Container size="xs">
			{toUpdatePreferences.length > 0 ? (
				<Affix
					position={{
						bottom: rem(45),
						right: rem(isFitnessActionActive ? 100 : 40),
					}}
				>
					<Form
						replace
						method="POST"
						action={`?defaultTab=${defaultTab}`}
						onSubmit={() => reset()}
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
							<Input.Wrapper
								label="Grid packing"
								description="Display size for library user interface elements"
							>
								<SegmentedControl
									mt="xs"
									fullWidth
									data={Object.values(GridPacking).map((c) => ({
										label: startCase(snakeCase(c)),
										value: c,
									}))}
									defaultValue={userPreferences.general.gridPacking}
									disabled={!!isEditDisabled}
									onChange={(val) => {
										if (val) appendPref("general.grid_packing", val);
									}}
								/>
							</Input.Wrapper>
							<Stack>
								<Title order={3}>Watch providers</Title>
								{Object.values(MediaLot)
									.map(snakeCase)
									.map((lot) => {
										const existingValues =
											watchProviders.find((wp) => wp.lot === lot)?.values || [];
										return (
											<Stack key={lot} gap={4}>
												<Text>{changeCase(lot)}</Text>
												<TagsInput
													placeholder="Enter more providers"
													value={existingValues}
													disabled={!!isEditDisabled}
													onChange={(val) => {
														if (val) {
															const newWatchProviders =
																Array.from(watchProviders);
															let existingMediaLot = newWatchProviders.find(
																(wp) => wp.lot === lot,
															);
															if (!existingMediaLot) {
																existingMediaLot = { lot, values: val };
																newWatchProviders.push(existingMediaLot);
															} else {
																existingMediaLot.values = val;
															}
															setWatchProviders(newWatchProviders);
															appendPref(
																"general.watch_providers",
																JSON.stringify(newWatchProviders),
															);
														}
													}}
												/>
											</Stack>
										);
									})}
							</Stack>
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
							</SimpleGrid>
							<Input.Wrapper
								label="Default Rest Timers"
								description="When adding an exercise to your workout, these timer values will be used if you have not configured a rest timer for that exercise."
							>
								<SimpleGrid cols={{ base: 2, md: 4 }}>
									{(["normal", "warmup", "drop", "failure"] as const).map(
										(name) => {
											const value =
												userPreferences.fitness.exercises.setRestTimers[name];
											return (
												<NumberInput
													suffix="s"
													size="xs"
													key={name}
													disabled={!!isEditDisabled}
													label={changeCase(snakeCase(name))}
													defaultValue={isNumber(value) ? value : undefined}
													onChange={(val) => {
														if (isNumber(val)) {
															appendPref(
																`fitness.exercises.set_rest_timers.${snakeCase(name)}`,
																String(val),
															);
														}
													}}
												/>
											);
										},
									)}
								</SimpleGrid>
							</Input.Wrapper>
							<Divider />
							{(["muteSounds", "showDetailsWhileEditing"] as const).map(
								(option) => (
									<Switch
										key={option}
										label={match(option)
											.with(
												"muteSounds",
												() => "Mute sounds while logging workouts",
											)
											.with(
												"showDetailsWhileEditing",
												() =>
													"Show details and history while editing workouts/templates",
											)
											.exhaustive()}
										size="xs"
										disabled={!!isEditDisabled}
										defaultChecked={userPreferences.fitness.logging[option]}
										onChange={(ev) => {
											appendPref(
												`fitness.logging.${snakeCase(option)}`,
												String(ev.currentTarget.checked),
											);
										}}
									/>
								),
							)}
							<Divider />
							<Input.Wrapper label="The default measurements you want to keep track of">
								<SimpleGrid cols={2} mt="xs">
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
							</Input.Wrapper>
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

const EDITABLE_NUM_ELEMENTS = [
	DashboardElementLot.Upcoming,
	DashboardElementLot.InProgress,
	DashboardElementLot.Recommendations,
];
const EDITABLE_DEDUPLICATE_MEDIA = [DashboardElementLot.Upcoming];

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
					className={cn({ [classes.itemDragging]: snapshot.isDragging })}
				>
					<Group justify="space-between" wrap="nowrap">
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
							<Text fw="bold" fz={{ md: "lg", lg: "xl" }}>
								{changeCase(props.lot)}
							</Text>
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
					<Group gap="xl" wrap="nowrap">
						{EDITABLE_NUM_ELEMENTS.includes(props.lot) ? (
							<NumberInput
								size="xs"
								label="Number of elements"
								disabled={!!props.isEditDisabled}
								defaultValue={focusedElement.numElements || undefined}
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
						) : null}
						{EDITABLE_DEDUPLICATE_MEDIA.includes(props.lot) ? (
							<Switch
								size="xs"
								label="Deduplicate media"
								disabled={!!props.isEditDisabled}
								defaultChecked={focusedElement.deduplicateMedia || undefined}
								styles={{ description: { width: rem(200) } }}
								description="If there's more than one episode of a media, keep the first one"
								onChange={(ev) => {
									const newValue = ev.currentTarget.checked;
									const newDashboardData = Array.from(
										userPreferences.general.dashboard,
									);
									newDashboardData[focusedElementIndex].deduplicateMedia =
										newValue;
									props.appendPref(
										"general.dashboard",
										JSON.stringify(newDashboardData),
									);
								}}
							/>
						) : null}
					</Group>
				</Paper>
			)}
		</Draggable>
	);
};

const reorder = <T,>(
	array: Array<T>,
	details: { from: number; to: number },
) => {
	const cloned = [...array];
	const item = array[details.from];
	cloned.splice(details.from, 1);
	cloned.splice(details.to, 0, item);
	return cloned;
};
