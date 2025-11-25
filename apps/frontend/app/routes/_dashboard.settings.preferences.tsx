import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import {
	ActionIcon,
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
import { useForm } from "@mantine/form";
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
import {
	IconAlertCircle,
	IconCheckbox,
	IconGripVertical,
	IconMinus,
	IconX,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
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

export default function Page() {
	const coreDetails = useCoreDetails();
	const userPreferences = useUserPreferences();
	const loaderData = useLoaderData<typeof loader>();
	const [defaultTab, setDefaultTab] = useState(
		loaderData.query.defaultTab || "dashboard",
	);
	const dashboardData = useDashboardLayoutData();
	const invalidateUserDetails = useInvalidateUserDetails();
	const isEditDisabled = dashboardData.isDemoInstance;

	const form = useForm<UserPreferences>({
		mode: "controlled",
		initialValues: userPreferences,
	});

	const updateUserPreferencesMutation = useMutation({
		mutationFn: async (values: UserPreferences) => {
			await clientGqlService.request(UpdateUserPreferenceDocument, {
				input: values,
			});
			await invalidateUserDetails();
		},
		onSuccess: () => {
			notifications.show({
				color: "green",
				title: "Preferences updated",
				message: "Preferences have been updated.",
			});
			form.resetDirty();
		},
	});

	return (
		<Container size="xs">
			<form
				onSubmit={form.onSubmit((values) =>
					updateUserPreferencesMutation.mutate(values),
				)}
			>
				<Stack>
					<Group justify="space-between" align="center">
						<Title>Preferences</Title>
						{form.isDirty() ? (
							<Group gap="xs">
								<ActionIcon
									color="red"
									type="button"
									title="Cancel changes"
									onClick={() => form.reset()}
									disabled={updateUserPreferencesMutation.isPending}
								>
									<IconX size={24} />
								</ActionIcon>
								<ActionIcon
									color="green"
									type="submit"
									title="Save changes"
									loading={updateUserPreferencesMutation.isPending}
								>
									<IconCheckbox size={24} />
								</ActionIcon>
							</Group>
						) : null}
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
										const newOrder = reorder(form.values.general.dashboard, {
											from: source.index,
											to: destination?.index || 0,
										});
										form.setFieldValue("general.dashboard", newOrder);
									} else {
										notifications.show(notificationContent);
									}
								}}
							>
								<Droppable droppableId="dnd-list">
									{(provided) => (
										<Stack {...provided.droppableProps} ref={provided.innerRef}>
											{form.values.general.dashboard.map((de, index) => (
												<EditDashboardElement
													index={index}
													key={de.section}
													lot={de.section}
													form={form}
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
								{(["media", "fitness", "analytics", "others"] as const).map(
									(facet) => {
										const entries = Object.entries(
											form.values.featuresEnabled[facet],
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
																checked={isEnabled}
																disabled={!!isEditDisabled}
																label={changeCase(snakeCase(name))}
																onChange={(ev) => {
																	form.setFieldValue(
																		`featuresEnabled.${facet}.${name}`,
																		ev.currentTarget.checked,
																	);
																}}
															/>
														) : null,
													)}
												</SimpleGrid>
												{facet === "media" ? (
													<MultiSelect
														disabled={!!isEditDisabled}
														value={form.values.featuresEnabled[facet].specific}
														data={Object.entries(MediaLot).map(
															([name, lot]) => ({
																value: lot,
																label: changeCase(name),
															}),
														)}
														onChange={(val) => {
															if (val) {
																form.setFieldValue(
																	`featuresEnabled.${facet}.specific`,
																	val as MediaLot[],
																);
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
											checked={form.values.general[name]}
											onChange={(ev) => {
												form.setFieldValue(
													`general.${name}`,
													ev.currentTarget.checked,
												);
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
											value={form.values.general.landingPath}
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
													form.setFieldValue("general.landingPath", value);
												}
											}}
										/>
										<NumberInput
											min={5}
											size="xs"
											label="List page size"
											disabled={!!isEditDisabled}
											value={form.values.general.listPageSize}
											description="The number of items to display on the list pages"
											onChange={(val) => {
												if (isNumber(val)) {
													form.setFieldValue("general.listPageSize", val);
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
											value={form.values.general.reviewScale}
											onChange={(val) => {
												if (val) {
													form.setFieldValue(
														"general.reviewScale",
														val as UserReviewScale,
													);
												}
											}}
										/>
									</Input.Wrapper>
									<Divider />
								</Stack>
								<Stack gap="sm">
									<Title order={3}>Watch providers</Title>
									{Object.values(MediaLot).map((lot) => {
										const watchProviders = form.values.general.watchProviders;
										const existingValues =
											watchProviders.find((wp) => wp.lot === lot)?.values || [];
										return (
											<TagsInput
												key={lot}
												label={changeCase(lot)}
												disabled={!!isEditDisabled}
												value={existingValues}
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
														form.setFieldValue(
															"general.watchProviders",
															newWatchProviders,
														);
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
								<Select
									size="xs"
									disabled={!!isEditDisabled}
									label="Unit system to use for measurements"
									data={convertEnumToSelectData(UserUnitSystem)}
									value={form.values.fitness.exercises.unitSystem}
									onChange={(val) => {
										if (val) {
											form.setFieldValue(
												"fitness.exercises.unitSystem",
												val as UserUnitSystem,
											);
										}
									}}
								/>
								<Input.Wrapper
									label="Default Rest Timers"
									description="When adding an exercise to your workout, these timer values will be used if you have not configured a rest timer for that exercise."
								>
									<SimpleGrid cols={{ base: 2, md: 4 }}>
										{(["normal", "warmup", "drop", "failure"] as const).map(
											(name) => {
												const value =
													form.values.fitness.exercises.setRestTimers[name];
												return (
													<NumberInput
														suffix="s"
														size="xs"
														key={name}
														disabled={!!isEditDisabled}
														label={changeCase(snakeCase(name))}
														value={isNumber(value) ? value : undefined}
														onChange={(val) => {
															if (isNumber(val)) {
																form.setFieldValue(
																	`fitness.exercises.setRestTimers.${name}`,
																	val,
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
								<Title order={4}>Workout logging</Title>
								{(
									[
										"muteSounds",
										"promptForRestTimer",
										"startTimerForDurationExercises",
									] as const
								).map((option) => {
									const [label, isGatedBehindServerKeyValidation] = match(
										option,
									)
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
											checked={form.values.fitness.logging[option]}
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
												form.setFieldValue(
													`fitness.logging.${option}`,
													ev.currentTarget.checked,
												);
											}}
										/>
									);
								})}
								<TextInput
									size="xs"
									label="Calories burnt unit"
									disabled={!!isEditDisabled}
									description="The unit to use for tracking calories burnt"
									value={form.values.fitness.logging.caloriesBurntUnit}
									onChange={(val) => {
										if (val) {
											form.setFieldValue(
												"fitness.logging.caloriesBurntUnit",
												val.target.value,
											);
										}
									}}
								/>
								<Divider />
								<Stack gap="xs">
									<Text size="sm">
										The measurements you want to keep track of
									</Text>
									{form.values.fitness.measurements.statistics.map(
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
														const newStatistics = [
															...form.values.fitness.measurements.statistics,
														];
														newStatistics[index] = {
															...newStatistics[index],
															name: val.target.value,
														};
														form.setFieldValue(
															"fitness.measurements.statistics",
															newStatistics,
														);
													}}
												/>
												<TextInput
													size="xs"
													label="Unit"
													value={s.unit || undefined}
													disabled={!!isEditDisabled}
													onChange={(val) => {
														const newStatistics = [
															...form.values.fitness.measurements.statistics,
														];
														newStatistics[index] = {
															...newStatistics[index],
															unit: val.target.value,
														};
														form.setFieldValue(
															"fitness.measurements.statistics",
															newStatistics,
														);
													}}
												/>
												<ActionIcon
													mt={14}
													size="xs"
													color="red"
													type="button"
													variant="outline"
													disabled={
														!!isEditDisabled ||
														form.values.fitness.measurements.statistics
															.length === 1
													}
													onClick={() => {
														const newStatistics = [
															...form.values.fitness.measurements.statistics,
														];
														newStatistics.splice(index, 1);
														form.setFieldValue(
															"fitness.measurements.statistics",
															newStatistics,
														);
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
										type="button"
										variant="outline"
										onClick={() => {
											const newStatistics = [
												...form.values.fitness.measurements.statistics,
												{ name: "<name>" },
											];
											form.setFieldValue(
												"fitness.measurements.statistics",
												newStatistics,
											);
										}}
									>
										Add
									</Button>
								</Stack>
							</Stack>
						</Tabs.Panel>
					</Tabs>
				</Stack>
			</form>
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
	form: ReturnType<typeof useForm<UserPreferences>>;
}) => {
	const focusedElementIndex = props.form.values.general.dashboard.findIndex(
		(de) => de.section === props.lot,
	);
	const focusedElement =
		props.form.values.general.dashboard[focusedElementIndex];

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
							checked={focusedElement.hidden}
							disabled={!!props.isEditDisabled}
							onChange={(ev) => {
								const newValue = ev.currentTarget.checked;
								const newDashboardData = Array.from(
									props.form.values.general.dashboard,
								);
								newDashboardData[focusedElementIndex].hidden = newValue;
								props.form.setFieldValue("general.dashboard", newDashboardData);
							}}
						/>
					</Group>
					<Group gap="xl" wrap="nowrap">
						{EDITABLE_NUM_ELEMENTS.includes(props.lot) ? (
							<NumberInput
								size="xs"
								label="Number of elements"
								disabled={!!props.isEditDisabled}
								value={focusedElement.numElements || undefined}
								onChange={(num) => {
									if (isNumber(num)) {
										const newDashboardData = cloneDeep(
											props.form.values.general.dashboard,
										);
										newDashboardData[focusedElementIndex].numElements = num;
										props.form.setFieldValue(
											"general.dashboard",
											newDashboardData,
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
								styles={{ description: { width: rem(200) } }}
								checked={focusedElement.deduplicateMedia ?? undefined}
								description="If there's more than one episode of a media, keep the first one"
								onChange={(ev) => {
									const newValue = ev.currentTarget.checked;
									const newDashboardData = Array.from(
										props.form.values.general.dashboard,
									);
									newDashboardData[focusedElementIndex].deduplicateMedia =
										newValue;
									props.form.setFieldValue(
										"general.dashboard",
										newDashboardData,
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
