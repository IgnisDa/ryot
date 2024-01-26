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
	Text,
	Title,
	rem,
} from "@mantine/core";
import { useListState } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
	ActionFunctionArgs,
	LoaderFunctionArgs,
	MetaFunction,
	json,
} from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
	DashboardElementLot,
	UpdateUserPreferenceDocument,
	UserReviewScale,
	UserUnitSystem,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, snakeCase, startCase } from "@ryot/ts-utils";
import { IconCheckbox } from "@tabler/icons-react";
import {
	IconAlertCircle,
	IconBellRinging,
	IconGripVertical,
	IconRotate360,
} from "@tabler/icons-react";
import clsx from "clsx";
import { Fragment, useState } from "react";
import { flushSync } from "react-dom";
import { match } from "ts-pattern";
import { z } from "zod";
import { zx } from "zodix";
import { getAuthorizationHeader, gqlClient } from "~/lib/api.server";
import { getCoreDetails, getUserPreferences } from "~/lib/graphql.server";
import classes from "~/styles/preferences.module.css";

const searchSchema = z.object({
	defaultTab: z.string().default("dashboard").optional(),
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchSchema);
	const [coreDetails, userPreferences] = await Promise.all([
		getCoreDetails(),
		getUserPreferences(request),
	]);
	return json({
		query,
		coreDetails: {
			preferencesChangeAllowed: coreDetails.preferencesChangeAllowed,
		},
		userPreferences,
	});
};

export const meta: MetaFunction = () => {
	return [{ title: "Preference | Ryot" }];
};

const notificationContent = {
	title: "Invalid action",
	color: "red",
	message: "Changing preferences is disabled on this instance.",
};

export const action = async ({ request }: ActionFunctionArgs) => {
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
		await gqlClient.request(
			UpdateUserPreferenceDocument,
			{ input },
			await getAuthorizationHeader(request),
		);
	}
	return json({ status: "success", submission } as const);
};

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const [dashboardElements, dashboardElementsHandlers] = useListState(
		loaderData.userPreferences.general.dashboard,
	);
	const [toUpdatePreferences, updateUserPreferencesHandler] = useListState<
		[string, string]
	>([]);
	const [defaultTab, setDefaultTab] = useState(
		loaderData.query.defaultTab || "dashboard",
	);

	const appendPref = (property: string, value: string) => {
		const index = toUpdatePreferences.findIndex((p) => p[0] === property);
		if (index !== -1) updateUserPreferencesHandler.remove(index);
		updateUserPreferencesHandler.append([property, value]);
	};

	return (
		<Container size="xs">
			{toUpdatePreferences.length > 0 ? (
				<Affix position={{ bottom: rem(40), right: rem(30) }}>
					<Form
						method="post"
						reloadDocument
						action={`?defaultTab=${defaultTab}`}
					>
						{toUpdatePreferences.map((pref) => (
							<input
								key={pref[0]}
								hidden
								name={pref[0]}
								defaultValue={pref[1]}
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
					<Form method="post" reloadDocument>
						<ActionIcon
							color="red"
							variant="outline"
							onClick={async (e) => {
								if (loaderData.coreDetails.preferencesChangeAllowed) {
									if (
										!confirm(
											"This will reset all your preferences to default. Are you sure you want to continue?",
										)
									)
										e.preventDefault();
									else
										notifications.show({
											message:
												"Preferences have been reset. Please reload the page.",
											color: "green",
										});
								} else notifications.show(notificationContent);
							}}
							type="submit"
							name="reset"
							value="reset"
						>
							<IconRotate360 size={20} />
						</ActionIcon>
					</Form>
				</Group>
				{!loaderData.coreDetails.preferencesChangeAllowed ? (
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
								if (loaderData.coreDetails.preferencesChangeAllowed) {
									flushSync(() => {
										dashboardElementsHandlers.reorder({
											from: source.index,
											to: destination?.index || 0,
										});
									});
									// FIXME: https://github.com/mantinedev/mantine/issues/5362
									appendPref(
										"general.dashboard",
										JSON.stringify(dashboardElements),
									);
								} else notifications.show(notificationContent);
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
												appendPref={appendPref}
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
												key={name}
												size="xs"
												label={changeCase(snakeCase(name))}
												// biome-ignore lint/suspicious/noExplicitAny: required here
												defaultChecked={isEnabled as any}
												disabled={
													!loaderData.coreDetails.preferencesChangeAllowed
												}
												onChange={(ev) => {
													const lot = snakeCase(name);
													appendPref(
														`features_enabled.${facet}.${lot}`,
														String(ev.currentTarget.checked),
													);
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
										if (val) appendPref("general.review_scale", val);
									}}
								/>
								<Switch
									size="xs"
									mt="md"
									label="Whether NSFW will be displayed"
									defaultChecked={
										loaderData.userPreferences.general.displayNsfw
									}
									disabled={!loaderData.coreDetails.preferencesChangeAllowed}
									onChange={(ev) => {
										appendPref(
											"general.display_nsfw",
											String(ev.currentTarget.checked),
										);
									}}
								/>
								<Switch
									size="xs"
									mt="md"
									label="Disable yank integrations"
									defaultChecked={
										loaderData.userPreferences.general.disableYankIntegrations
									}
									disabled={!loaderData.coreDetails.preferencesChangeAllowed}
									onChange={(ev) => {
										appendPref(
											"general.disable_yank_integrations",
											String(ev.currentTarget.checked),
										);
									}}
								/>
							</SimpleGrid>
						</Stack>
					</Tabs.Panel>
					<Tabs.Panel value="notifications" mt="md">
						<Stack>
							<Text>
								The notifications you want to receive in your configured
								providers.
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
												.with("mediaPublished", () => "A media is published")
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
												.with(
													"newReviewPosted",
													() => "A new public review is posted",
												)
												.otherwise(() => undefined)}
											defaultChecked={isEnabled}
											disabled={
												!loaderData.coreDetails.preferencesChangeAllowed
											}
											onChange={(ev) => {
												appendPref(
													`notifications.${snakeCase(name)}`,
													String(ev.currentTarget.checked),
												);
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
										appendPref("fitness.exercises.default_timer", String(num));
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
											appendPref("fitness.exercises.save_history", String(num));
									}}
								/>
								<Group wrap="nowrap">
									<ActionIcon
										onClick={async () => {
											if (Notification.permission !== "granted") {
												await Notification.requestPermission();
												window.location.reload();
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
										if (val) appendPref("fitness.exercises.unit_system", val);
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
										defaultChecked={isEnabled}
										disabled={!loaderData.coreDetails.preferencesChangeAllowed}
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
									loaderData.userPreferences.fitness.measurements.custom,
									null,
									4,
								)}
								disabled={!loaderData.coreDetails.preferencesChangeAllowed}
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
	lot: DashboardElementLot;
	index: number;
	appendPref: (property: string, value: string) => void;
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
								props.appendPref(
									"general.dashboard",
									JSON.stringify(newDashboardData),
								);
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
