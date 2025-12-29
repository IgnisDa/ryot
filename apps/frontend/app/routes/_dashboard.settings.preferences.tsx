import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import {
	ActionIcon,
	Alert,
	Box,
	Button,
	Collapse,
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
	MediaSource,
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
	IconSettings,
	IconX,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { useLoaderData } from "react-router";
import { $path } from "safe-routes";
import invariant from "tiny-invariant";
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

const EDITABLE_NUM_DAYS_AHEAD = [DashboardElementLot.Upcoming];
const EDITABLE_DEDUPLICATE_MEDIA = [DashboardElementLot.Upcoming];
const EDITABLE_NUM_ELEMENTS = [
	DashboardElementLot.Upcoming,
	DashboardElementLot.InProgress,
	DashboardElementLot.Recommendations,
];

const updateCollectionInArray = <T extends { lot: unknown; values: string[] }>(
	array: T[],
	lot: unknown,
	values: string[],
): T[] => {
	const cloned = cloneDeep(array);
	let item = cloned.find((x) => x.lot === lot);
	if (!item) {
		item = { lot, values } as T;
		cloned.push(item);
	} else {
		item.values = values;
	}
	return cloned;
};

type MeasurementStatistic = { name: string; unit?: string | null };

const addMeasurementStatistic = (
	statistics: MeasurementStatistic[],
): MeasurementStatistic[] => [...statistics, { name: "<name>" }];

const updateMeasurementStatistic = (
	statistics: MeasurementStatistic[],
	index: number,
	updates: Partial<MeasurementStatistic>,
): MeasurementStatistic[] => {
	const newStats = [...statistics];
	newStats[index] = { ...newStats[index], ...updates };
	return newStats;
};

const removeMeasurementStatistic = (
	statistics: MeasurementStatistic[],
	index: number,
): MeasurementStatistic[] => {
	const newStats = [...statistics];
	newStats.splice(index, 1);
	return newStats;
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
			value: $path("/media/:action/:lot", {
				action: "list",
				lot: lot.toLowerCase(),
			}),
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

	const form = useForm<UserPreferences>({ initialValues: userPreferences });

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
							<Tabs.Tab value="languages">Languages</Tabs.Tab>
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
													form={form}
													index={index}
													key={de.section}
													lot={de.section}
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
														data={convertEnumToSelectData(MediaLot)}
														value={form.values.featuresEnabled[facet].specific}
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
												if (value)
													form.setFieldValue("general.landingPath", value);
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
														form.setFieldValue(
															"general.watchProviders",
															updateCollectionInArray(watchProviders, lot, val),
														);
													}
												}}
											/>
										);
									})}
								</Stack>
							</Stack>
						</Tabs.Panel>
						<Tabs.Panel value="languages">
							<Stack>
								<Title order={4}>Providers</Title>
								{Object.values(MediaSource).map((source) => {
									const languagesForThisSource =
										coreDetails.providerLanguages.find(
											(l) => l.source === source,
										);
									if ((languagesForThisSource?.supported.length || 0) <= 1)
										return null;

									invariant(languagesForThisSource);

									return (
										<Box key={source}>
											<Text>{changeCase(source)}</Text>
											<Select
												size="xs"
												searchable
												disabled={!!isEditDisabled}
												data={languagesForThisSource.supported}
												value={
													form.values.languages.providers.find(
														(p) => p.source === source,
													)?.preferredLanguage
												}
												onChange={(val) => {
													if (val) {
														const providers = [
															...form.values.languages.providers,
														];
														const existingIndex = providers.findIndex(
															(p) => p.source === source,
														);
														if (existingIndex !== -1) {
															providers[existingIndex] = {
																...providers[existingIndex],
																preferredLanguage: val,
															};
														} else {
															providers.push({
																source: source as MediaSource,
																preferredLanguage: val,
															});
														}
														form.setFieldValue("languages", {
															...form.values.languages,
															providers,
														});
													}
												}}
											/>
										</Box>
									);
								})}
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
													onChange={(val) =>
														form.setFieldValue(
															"fitness.measurements.statistics",
															updateMeasurementStatistic(
																form.values.fitness.measurements.statistics,
																index,
																{ name: val.target.value },
															),
														)
													}
												/>
												<TextInput
													size="xs"
													label="Unit"
													value={s.unit || undefined}
													disabled={!!isEditDisabled}
													onChange={(val) =>
														form.setFieldValue(
															"fitness.measurements.statistics",
															updateMeasurementStatistic(
																form.values.fitness.measurements.statistics,
																index,
																{ unit: val.target.value },
															),
														)
													}
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
													onClick={() =>
														form.setFieldValue(
															"fitness.measurements.statistics",
															removeMeasurementStatistic(
																form.values.fitness.measurements.statistics,
																index,
															),
														)
													}
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
										onClick={() =>
											form.setFieldValue(
												"fitness.measurements.statistics",
												addMeasurementStatistic(
													form.values.fitness.measurements.statistics,
												),
											)
										}
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

const EditDashboardElement = (props: {
	index: number;
	isEditDisabled: boolean;
	lot: DashboardElementLot;
	form: ReturnType<typeof useForm<UserPreferences>>;
}) => {
	const [isOpen, setIsOpen] = useState(false);
	const focusedElement = props.form.values.general.dashboard[props.index];

	const updateDashboardElement = <K extends keyof typeof focusedElement>(
		key: K,
		value: (typeof focusedElement)[K],
	) =>
		// @ts-expect-error Too lazy to debug why this is failing.
		props.form.setFieldValue(`general.dashboard.${props.index}.${key}`, value);

	return (
		<Draggable index={props.index} draggableId={props.lot}>
			{(provided, snapshot) => (
				<Paper
					p="xs"
					withBorder
					ref={provided.innerRef}
					{...provided.draggableProps}
					className={cn({ [classes.itemDragging]: snapshot.isDragging })}
				>
					<Group justify="space-between" wrap="nowrap">
						<Group>
							<div
								{...provided.dragHandleProps}
								style={{
									height: "100%",
									cursor: "grab",
									display: "flex",
									justifyContent: "center",
								}}
							>
								<IconGripVertical
									stroke={1.5}
									style={{ width: rem(18), height: rem(18) }}
								/>
							</div>
							<Text fw="bold" fz={{ md: "lg", lg: "xl" }}>
								{changeCase(props.lot)}
							</Text>
						</Group>
						<ActionIcon
							color="gray"
							variant="subtle"
							onClick={() => setIsOpen(!isOpen)}
						>
							<IconSettings size={20} />
						</ActionIcon>
					</Group>
					<Collapse in={isOpen}>
						<Stack gap="xs" mt="md">
							<Switch
								size="xs"
								label="Hidden"
								checked={focusedElement.hidden}
								disabled={!!props.isEditDisabled}
								onChange={(ev) =>
									updateDashboardElement("hidden", ev.currentTarget.checked)
								}
							/>
							{EDITABLE_DEDUPLICATE_MEDIA.includes(props.lot) ? (
								<Switch
									size="xs"
									label="Deduplicate media"
									disabled={!!props.isEditDisabled}
									checked={focusedElement.deduplicateMedia ?? undefined}
									description="If there's more than one episode of a media, keep the first one"
									onChange={(ev) =>
										updateDashboardElement(
											"deduplicateMedia",
											ev.currentTarget.checked,
										)
									}
								/>
							) : null}
							{EDITABLE_NUM_ELEMENTS.includes(props.lot) ? (
								<NumberInput
									size="xs"
									label="Number of elements"
									disabled={!!props.isEditDisabled}
									value={focusedElement.numElements || undefined}
									onChange={(num) => {
										if (isNumber(num)) {
											updateDashboardElement("numElements", num);
											updateDashboardElement("numDaysAhead", undefined);
										}
									}}
								/>
							) : null}
							{EDITABLE_NUM_DAYS_AHEAD.includes(props.lot) ? (
								<NumberInput
									size="xs"
									label="Number of days ahead"
									disabled={!!props.isEditDisabled}
									value={focusedElement.numDaysAhead || undefined}
									description="Show upcoming items within this many days from today"
									onChange={(num) => {
										if (isNumber(num)) {
											updateDashboardElement("numDaysAhead", num);
											updateDashboardElement("numElements", undefined);
										}
									}}
								/>
							) : null}
						</Stack>
					</Collapse>
				</Paper>
			)}
		</Draggable>
	);
};
