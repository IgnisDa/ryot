import type { NextPageWithLayout } from "../_app";
import { useCoreDetails, useUserPreferences } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { getLot } from "@/lib/utilities";
import {
	Alert,
	Container,
	Divider,
	SimpleGrid,
	Stack,
	Switch,
	Text,
	Title,
} from "@mantine/core";
import {
	UpdateUserPreferenceDocument,
	type UpdateUserPreferenceMutationVariables,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, snakeCase } from "@ryot/ts-utils";
import { IconAlertCircle } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement } from "react";
import { match } from "ts-pattern";

const Page: NextPageWithLayout = () => {
	const userPrefs = useUserPreferences();
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
			userPrefs.refetch();
		},
	});

	return userPrefs.data && coreDetails.data ? (
		<>
			<Head>
				<title>Preferences | Ryot</title>
			</Head>
			<Container size="xs">
				<Stack>
					<Title>Preferences</Title>
					{!coreDetails.data.preferencesChangeAllowed ? (
						<Alert
							icon={<IconAlertCircle size="1rem" />}
							variant="outline"
							color="violet"
						>
							Changing preferences is disabled on this instance.
						</Alert>
					) : null}
					<Title order={3}>Enabled features</Title>
					<SimpleGrid cols={2}>
						{Object.entries(userPrefs.data.featuresEnabled.media).map(
							([name, isEnabled], idx) => (
								<Switch
									size="xs"
									key={idx}
									label={changeCase(name)}
									checked={isEnabled}
									disabled={!coreDetails.data.preferencesChangeAllowed}
									onChange={(ev) => {
										const lot = getLot(name);
										if (lot)
											updateUserEnabledFeatures.mutate({
												input: {
													property: `features_enabled.media.${lot.toLowerCase()}`,
													value: String(ev.currentTarget.checked),
												},
											});
									}}
								/>
							),
						)}
					</SimpleGrid>
					<Divider />
					<Title order={3}>Notifications</Title>
					<Text size="xs">
						The following applies to media in your Watchlist or the ones you
						have monitored explicitly.
					</Text>
					<SimpleGrid cols={2}>
						{Object.entries(userPrefs.data.notifications).map(
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
