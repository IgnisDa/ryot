import type { NextPageWithLayout } from "../_app";
import { useCoreDetails, useUserPreferences } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
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
	Text,
	Title,
} from "@mantine/core";
import {
	UpdateUserPreferenceDocument,
	type UpdateUserPreferenceMutationVariables,
	UserReviewScale,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, snakeCase, startCase } from "@ryot/ts-utils";
import { IconAlertCircle } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import Head from "next/head";
import { Fragment, type ReactElement } from "react";
import { match } from "ts-pattern";

const Page: NextPageWithLayout = () => {
	const userPreferences = useUserPreferences();
	const coreDetails = useCoreDetails();

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

	return userPreferences.data && coreDetails.data ? (
		<>
			<Head>
				<title>Preferences | Ryot</title>
			</Head>
			<Container size="xs">
				<Stack>
					{!coreDetails.data.preferencesChangeAllowed ? (
						<Alert
							icon={<IconAlertCircle size="1rem" />}
							variant="outline"
							color="violet"
						>
							Changing preferences is disabled on this instance.
						</Alert>
					) : undefined}
					<Title order={2}>Enabled features</Title>
					{["media", "fitness"].map((facet) => (
						<Fragment key={facet}>
							<Title order={4}>{startCase(facet)}</Title>
							<SimpleGrid cols={2}>
								{Object.entries(
									(userPreferences.data.featuresEnabled as any)[facet],
								).map(([name, isEnabled], idx) => (
									<Switch
										size="xs"
										key={idx}
										label={changeCase(snakeCase(name))}
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
					<Title order={2}>Notifications</Title>
					<Text size="xs">
						The following applies to media in your Watchlist or the ones you
						have monitored explicitly.
					</Text>
					<SimpleGrid cols={2}>
						{Object.entries(userPreferences.data.notifications).map(
							([name, isEnabled], idx) => (
								<Switch
									key={idx}
									size="xs"
									label={match(name)
										.with("episodeReleased", () => "Number of episodes changes")
										.with("statusChanged", () => "Status changes")
										.with("releaseDateChanged", () => "Release date changes")
										.with(
											"numberOfSeasonsChanged",
											() => "Number of seasons changes",
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
					<Divider />
					<Title order={2}>General</Title>
					<SimpleGrid cols={2}>
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
					</SimpleGrid>
					<Divider />
					<Title order={2}>Measurements</Title>
					<Text size="xs">
						The default measurements you want to keep track of.
					</Text>
					<SimpleGrid cols={2}>
						{Object.entries(
							userPreferences.data.fitness.measurements.inbuilt,
						).map(([name, isEnabled], idx) => (
							<Switch
								size="xs"
								key={idx}
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
					<Divider />
					<Title order={2}>Exercises</Title>
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
							defaultValue={userPreferences.data.fitness.exercises.saveHistory}
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
