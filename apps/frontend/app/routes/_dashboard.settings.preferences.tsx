import { useAutoAnimate } from "@formkit/auto-animate/react";
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
	MediaStateChanged,
	UpdateUserPreferenceDocument,
	type UserPreferencesQuery,
	UserReviewScale,
	UserUnitSystem,
} from "@ryot/generated/graphql/backend/graphql";
import {
	camelCase,
	changeCase,
	isBoolean,
	isNumber,
	snakeCase,
	sortBy,
	startCase,
} from "@ryot/ts-utils";
import { IconCheckbox } from "@tabler/icons-react";
import {
	IconAlertCircle,
	IconBellRinging,
	IconRotate360,
} from "@tabler/icons-react";
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

type DashboardPreferences =
	UserPreferencesQuery["userPreferences"]["general"]["dashboard"];
type DashboardSection = keyof DashboardPreferences;

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const userPreferences = useUserPreferences();
	const submit = useConfirmSubmit();
	const [elements, setElements] = useState(() => {
		const elements = Object.entries(userPreferences.general.dashboard);
		return Object.fromEntries(
			sortBy(elements, ([_, value]) => value.index),
		) as DashboardPreferences;
	});
	const [parent] = useAutoAnimate();
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
						<Stack ref={parent}>
							<Text size="xs">
								<pre>
									<code>{JSON.stringify(elements, null, 4)}</code>
								</pre>
							</Text>
							{/* {dashboardElements.map((section) => {
								const settings = section.settings;
								return (
									<Paper key={section.name} withBorder p="xs">
										<Group justify="space-between">
											<Title order={3}>{changeCase(section.name)}</Title>
											{isBoolean(settings.isHidden) ? (
												<Switch
													label="Hidden"
													labelPosition="left"
													defaultChecked={settings.isHidden}
													disabled={isEditDisabled}
													onChange={(ev) => {
														const newValue = ev.currentTarget.checked;
														console.log(newValue);
													}}
												/>
											) : null}
										</Group>
										{settings.__typename ===
										"UserGeneralDashboardCommonPreferences" ? (
											<Flex>
												<NumberInput
													label="Number of elements"
													size="xs"
													defaultValue={settings.numElements}
													disabled={isEditDisabled}
													onChange={(num) => {
														if (isNumber(num)) {
															// const newDashboardData = Array.from(
															// 	userPreferences.general.dashboard,
															// );
															// newDashboardData[
															// 	focusedElementIndex
															// ].numElements = num;
															// appendPref(
															// 	"general.dashboard",
															// 	JSON.stringify(newDashboardData),
															// );
														}
													}}
												/>
											</Flex>
										) : null}
									</Paper>
								);
							})} */}
						</Stack>
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
