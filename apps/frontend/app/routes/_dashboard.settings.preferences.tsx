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
	MultiSelect,
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
	TextInput,
	Title,
	rem,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
	DashboardElementLot,
	MediaLot,
	UpdateUserPreferenceDocument,
	type UserPreferences,
	UserReviewScale,
	UserUnitSystem,
} from "@ryot/generated/graphql/backend/graphql";
import {
	changeCase,
	cloneDeep,
	cn,
	isBoolean,
	isNumber,
	parseSearchQuery,
	snakeCase,
	startCase,
} from "@ryot/ts-utils";
import { IconCheckbox, IconMinus } from "@tabler/icons-react";
import {
	IconAlertCircle,
	IconBellRinging,
	IconGripVertical,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { type Draft, produce } from "immer";
import { Fragment, useState } from "react";
import { useLoaderData } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { z } from "zod";
import { PRO_REQUIRED_MESSAGE } from "~/lib/shared/constants";
import {
	useCoreDetails,
	useDashboardLayoutData,
	useInvalidateUserDetails,
	useIsFitnessActionActive,
	useUserPreferences,
} from "~/lib/shared/hooks";
import { clientGqlService } from "~/lib/shared/react-query";
import { convertEnumToSelectData } from "~/lib/shared/ui-utils";
import { FitnessEntity } from "~/lib/types";
import classes from "~/styles/preferences.module.css";
import type { Route } from "./+types/_dashboard.settings.preferences";

const searchSchema = z.object({
	defaultTab: z.string().default("dashboard").optional(),
});

export const loader = async ({ request }: Route.LoaderArgs) => {
	// biome-ignore lint/suspicious/noExplicitAny: can't use correct types here
	const userPreferenceLandingPaths: any = [
		{ label: "Dashboard", value: $path("/") },
		{ label: "Analytics", value: $path("/analytics") },
		{ label: "Calendar", value: $path("/calendar") },
		{ label: "Collections", value: $path("/collections/list") },
	];
	userPreferenceLandingPaths.push({
		group: "Media",
		items: Object.values(MediaLot).map((lot) => ({
			label: changeCase(lot),
			value: $path("/media/:action/:lot", { lot, action: "list" }),
		})),
	});
	userPreferenceLandingPaths.push({
		group: "Fitness",
		items: [
			...Object.values(FitnessEntity).map((entity) => ({
				label: changeCase(entity),
				value: $path("/fitness/:entity/list", { entity }),
			})),
			{ label: "Measurements", value: $path("/fitness/measurements/list") },
			{ label: "Exercises", value: $path("/fitness/exercises/list") },
		],
	});
	const query = parseSearchQuery(request, searchSchema);
	return { query, userPreferenceLandingPaths };
};

export const meta = () => {
	return [{ title: "Preferences | Ryot" }];
};

const notificationContent = {
	title: "Invalid action",
	color: "red",
	message:
		"Changing preferences is disabled for demo users. Please create an account to save your preferences.",
};

type UpdatePreferenceFunc = (draft: Draft<UserPreferences>) => void;

export default function Page() {
	const coreDetails = useCoreDetails();
	const userPreferences = useUserPreferences();
	const loaderData = useLoaderData<typeof loader>();
	const isFitnessActionActive = useIsFitnessActionActive();
	const [defaultTab, setDefaultTab] = useState(
		loaderData.query.defaultTab || "dashboard",
	);
	const dashboardData = useDashboardLayoutData();
	const invalidateUserDetails = useInvalidateUserDetails();
	const [changingUserPreferences, setChangingUserPreferences] = useState({
		isChanged: false,
		value: userPreferences,
	});
	const isEditDisabled = dashboardData.isDemoInstance;

	const updateUserPreferencesMutation = useMutation({
		mutationFn: async () => {
			await clientGqlService.request(UpdateUserPreferenceDocument, {
				input: changingUserPreferences.value,
			});
			await invalidateUserDetails();
		},
	});

	const updatePreference = (makeChange: UpdatePreferenceFunc) => {
		setChangingUserPreferences(
			produce(changingUserPreferences, (draft) => {
				draft.isChanged = true;
				makeChange(draft.value);
			}),
		);
	};

	return (
		<Container size="xs">
			{changingUserPreferences.isChanged ? (
				<Affix
					position={{
						bottom: rem(45),
						right: rem(isFitnessActionActive ? 100 : 40),
					}}
				>
					<Group gap="xs">
						<Button
							variant="outline"
							color="red"
							disabled={updateUserPreferencesMutation.isPending}
							onClick={() => {
								setChangingUserPreferences({
									isChanged: false,
									value: userPreferences,
								});
							}}
						>
							Cancel changes
						</Button>
						<Button
							color="green"
							variant="outline"
							leftSection={<IconCheckbox size={20} />}
							loading={updateUserPreferencesMutation.isPending}
							onClick={async () => {
								await updateUserPreferencesMutation.mutateAsync();
								notifications.show({
									color: "green",
									title: "Preferences updated",
									message: "Preferences have been updated.",
								});
								setChangingUserPreferences({
									isChanged: false,
									value: userPreferences,
								});
							}}
						>
							Save changes
						</Button>
					</Group>
				</Affix>
			) : null}
			<Stack>
				<Title>Preferences</Title>
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
									const newOrder = reorder(userPreferences.general.dashboard, {
										from: source.index,
										to: destination?.index || 0,
									});
									updatePreference((draft) => {
										draft.general.dashboard = newOrder;
									});
								} else {
									notifications.show(notificationContent);
								}
							}}
						>
							<Droppable droppableId="dnd-list">
								{(provided) => (
									<Stack {...provided.droppableProps} ref={provided.innerRef}>
										{changingUserPreferences.value.general.dashboard.map(
											(de, index) => (
												<EditDashboardElement
													index={index}
													key={de.section}
													lot={de.section}
													isEditDisabled={isEditDisabled}
													updatePreference={updatePreference}
												/>
											),
										)}
										{provided.placeholder}
									</Stack>
								)}
							</Droppable>
						</DragDropContext>
					</Tabs.Panel>
					<Tabs.Panel value="features">
						<Stack>
							<Text>Features that you want to use.</Text>
							{(["media", "fitness", "analytics", "others"] as const).map(
								(facet) => {
									const entries = Object.entries(
										userPreferences.featuresEnabled[facet],
									);

									return (
										<Fragment key={facet}>
											<Title order={4}>{startCase(facet)}</Title>
											<SimpleGrid cols={2}>
												{entries.map(([name, isEnabled]) =>
													isBoolean(isEnabled) ? (
														<Switch
															key={name}
															size="xs"
															defaultChecked={isEnabled}
															disabled={!!isEditDisabled}
															label={changeCase(snakeCase(name))}
															onChange={(ev) => {
																updatePreference((draft) => {
																	// biome-ignore lint/suspicious/noExplicitAny: too much work to use correct types
																	(draft as any).featuresEnabled[facet][name] =
																		ev.currentTarget.checked;
																});
															}}
														/>
													) : null,
												)}
											</SimpleGrid>
											{facet === "media" ? (
												<MultiSelect
													disabled={!!isEditDisabled}
													defaultValue={
														userPreferences.featuresEnabled[facet].specific
													}
													data={Object.entries(MediaLot).map(([name, lot]) => ({
														value: lot,
														label: changeCase(name),
													}))}
													onChange={(val) => {
														if (val) {
															updatePreference((draft) => {
																draft.featuresEnabled[facet].specific =
																	val as MediaLot[];
															});
														}
													}}
												/>
											) : null}
										</Fragment>
									);
								},
							)}
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
										"showSpoilersInCalendar",
									] as const
								).map((name) => (
									<Switch
										size="xs"
										key={name}
										disabled={!!isEditDisabled}
										defaultChecked={userPreferences.general[name]}
										onChange={(ev) => {
											updatePreference((draft) => {
												draft.general[name] = ev.currentTarget.checked;
											});
										}}
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
												"showSpoilersInCalendar",
												() =>
													"Show episode title in calendar and upcoming section which might contain spoilers",
											)
											.exhaustive()}
									/>
								))}
							</SimpleGrid>
							<Stack gap="xs">
								<Divider />
								<Group wrap="nowrap">
									<Select
										size="xs"
										disabled={!!isEditDisabled}
										label="Default landing page"
										data={loaderData.userPreferenceLandingPaths}
										defaultValue={userPreferences.general.landingPath}
										description="The page you want to see when you first open the app"
										onChange={(value) => {
											if (!coreDetails.isServerKeyValidated) {
												notifications.show({
													color: "red",
													message: PRO_REQUIRED_MESSAGE,
												});
												return;
											}
											if (value) {
												updatePreference((draft) => {
													draft.general.landingPath = value;
												});
											}
										}}
									/>
									<NumberInput
										min={5}
										size="xs"
										label="List page size"
										disabled={!!isEditDisabled}
										defaultValue={userPreferences.general.listPageSize}
										description="The number of items to display on the list pages"
										onChange={(val) => {
											if (isNumber(val)) {
												updatePreference((draft) => {
													draft.general.listPageSize = val;
												});
											}
										}}
									/>
								</Group>
								<Input.Wrapper
									label="Review scale"
									description="Scale you want to use for reviews"
								>
									<SegmentedControl
										mt="xs"
										size="xs"
										fullWidth
										disabled={!!isEditDisabled}
										data={convertEnumToSelectData(UserReviewScale)}
										defaultValue={userPreferences.general.reviewScale}
										onChange={(val) => {
											if (val) {
												updatePreference((draft) => {
													draft.general.reviewScale = val as UserReviewScale;
												});
											}
										}}
									/>
								</Input.Wrapper>
								<Divider />
							</Stack>
							<Stack gap="sm">
								<Title order={3}>Watch providers</Title>
								{Object.values(MediaLot).map((lot) => {
									const watchProviders =
										changingUserPreferences.value.general.watchProviders;
									const existingValues =
										watchProviders.find((wp) => wp.lot === lot)?.values || [];
									return (
										<TagsInput
											key={lot}
											label={changeCase(lot)}
											disabled={!!isEditDisabled}
											defaultValue={existingValues}
											placeholder="Enter more providers"
											onChange={(val) => {
												if (val) {
													const newWatchProviders = cloneDeep(watchProviders);
													let existingMediaLot = newWatchProviders.find(
														(wp) => wp.lot === lot,
													);
													if (!existingMediaLot) {
														existingMediaLot = {
															values: val,
															lot: lot as MediaLot,
														};
														newWatchProviders.push(existingMediaLot);
													} else {
														existingMediaLot.values = val;
													}
													updatePreference((draft) => {
														draft.general.watchProviders = newWatchProviders;
													});
												}
											}}
										/>
									);
								})}
							</Stack>
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
													color: "green",
													message: "You have already granted permissions",
												});
										}}
									>
										<IconBellRinging />
									</ActionIcon>
									<Text size="xs">
										Send me notifications related to the current workout
									</Text>
								</Group>
								<Select
									size="xs"
									disabled={!!isEditDisabled}
									label="Unit system to use for measurements"
									data={convertEnumToSelectData(UserUnitSystem)}
									defaultValue={userPreferences.fitness.exercises.unitSystem}
									onChange={(val) => {
										if (val) {
											updatePreference((draft) => {
												draft.fitness.exercises.unitSystem =
													val as UserUnitSystem;
											});
										}
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
															updatePreference((draft) => {
																draft.fitness.exercises.setRestTimers[name] =
																	val;
															});
														}
													}}
												/>
											);
										},
									)}
								</SimpleGrid>
							</Input.Wrapper>
							<Divider />
							<Title order={4}>Workout logging</Title>
							{(
								[
									"muteSounds",
									"promptForRestTimer",
									"startTimerForDurationExercises",
								] as const
							).map((option) => {
								const [label, isGatedBehindServerKeyValidation] = match(option)
									.with(
										"muteSounds",
										() => ["Mute all sounds for actions"] as const,
									)
									.with(
										"promptForRestTimer",
										() =>
											[
												"Prompt for rest timer when confirming sets",
												true,
											] as const,
									)
									.with(
										"startTimerForDurationExercises",
										() =>
											[
												"Start timer for exercises where duration is set",
											] as const,
									)
									.exhaustive();

								return (
									<Switch
										size="xs"
										key={option}
										label={label}
										disabled={!!isEditDisabled}
										defaultChecked={userPreferences.fitness.logging[option]}
										onChange={(ev) => {
											if (
												isGatedBehindServerKeyValidation &&
												!coreDetails.isServerKeyValidated
											) {
												notifications.show({
													color: "red",
													message: PRO_REQUIRED_MESSAGE,
												});
												return;
											}
											updatePreference((draft) => {
												draft.fitness.logging[option] =
													ev.currentTarget.checked;
											});
										}}
									/>
								);
							})}
							<TextInput
								size="xs"
								label="Calories burnt unit"
								disabled={!!isEditDisabled}
								description="The unit to use for tracking calories burnt"
								defaultValue={userPreferences.fitness.logging.caloriesBurntUnit}
								onChange={(val) => {
									if (val) {
										updatePreference((draft) => {
											draft.fitness.logging.caloriesBurntUnit =
												val.target.value;
										});
									}
								}}
							/>
							<Divider />
							<Stack gap="xs">
								<Text size="sm">
									The measurements you want to keep track of
								</Text>
								{changingUserPreferences.value.fitness.measurements.statistics.map(
									(s, index) => (
										<Group
											wrap="nowrap"
											key={`${
												// biome-ignore lint/suspicious/noArrayIndexKey: index is unique
												index
											}`}
										>
											<TextInput
												size="xs"
												label="Name"
												value={s.name}
												disabled={!!isEditDisabled}
												onChange={(val) => {
													updatePreference((draft) => {
														draft.fitness.measurements.statistics[index].name =
															val.target.value;
													});
												}}
											/>
											<TextInput
												size="xs"
												label="Unit"
												value={s.unit || undefined}
												disabled={!!isEditDisabled}
												onChange={(val) => {
													updatePreference((draft) => {
														draft.fitness.measurements.statistics[index].unit =
															val.target.value;
													});
												}}
											/>
											<ActionIcon
												mt={14}
												size="xs"
												color="red"
												variant="outline"
												disabled={
													!!isEditDisabled ||
													changingUserPreferences.value.fitness.measurements
														.statistics.length === 1
												}
												onClick={() => {
													updatePreference((draft) => {
														draft.fitness.measurements.statistics.splice(
															index,
															1,
														);
													});
												}}
											>
												<IconMinus />
											</ActionIcon>
										</Group>
									),
								)}
								<Button
									ml="auto"
									size="xs"
									variant="outline"
									onClick={() => {
										updatePreference((draft) => {
											draft.fitness.measurements.statistics.push({
												name: "<name>",
											});
										});
									}}
								>
									Add
								</Button>
							</Stack>
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
	index: number;
	isEditDisabled: boolean;
	lot: DashboardElementLot;
	updatePreference: (makeChange: UpdatePreferenceFunc) => void;
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
								props.updatePreference((draft) => {
									draft.general.dashboard = newDashboardData;
								});
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
										const newDashboardData = cloneDeep(
											userPreferences.general.dashboard,
										);
										newDashboardData[focusedElementIndex].numElements = num;
										props.updatePreference((draft) => {
											draft.general.dashboard = newDashboardData;
										});
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
									props.updatePreference((draft) => {
										draft.general.dashboard = newDashboardData;
									});
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
