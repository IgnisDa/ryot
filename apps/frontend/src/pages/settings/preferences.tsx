import type { NextPageWithLayout } from "../_app";
import { useUserPreferences } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { getLot } from "@/lib/utilities";
import {
	Container,
	Divider,
	SimpleGrid,
	Stack,
	Switch,
	Title,
} from "@mantine/core";
import {
	UpdateUserPreferenceDocument,
	type UpdateUserPreferenceMutationVariables,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, snakeCase } from "@ryot/utilities";
import { useMutation } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement } from "react";
import { match } from "ts-pattern";

const Page: NextPageWithLayout = () => {
	const userPrefs = useUserPreferences();

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

	return userPrefs.data ? (
		<>
			<Head>
				<title>Preferences | Ryot</title>
			</Head>
			<Container size="xs">
				<Stack>
					<Title>Preferences</Title>
					<Title order={3}>Enabled features</Title>
					<SimpleGrid cols={2}>
						{Object.entries(userPrefs.data.featuresEnabled.media).map(
							([name, isEnabled], idx) => (
								<Switch
									size="xs"
									key={idx}
									label={changeCase(name)}
									checked={isEnabled}
									onChange={(ev) => {
										const lot = getLot(name);
										if (lot)
											updateUserEnabledFeatures.mutate({
												input: {
													property: `features_enabled.media.${lot.toLowerCase()}`,
													value: ev.currentTarget.checked,
												},
											});
									}}
								/>
							),
						)}
					</SimpleGrid>
					<Divider />
					<Title order={3}>Notifications</Title>
					<SimpleGrid cols={1}>
						{Object.entries(userPrefs.data.notifications).map(
							([name, isEnabled], idx) => (
								<Switch
									key={idx}
									size="xs"
									label={match(name)
										.with(
											"episodeReleased",
											() =>
												"When a media in my Watchlist has new episodes released",
										)
										.with(
											"statusChanged",
											() => "When a media in my Watchlist has status changes",
										)
										.with(
											"releaseDateChanged",
											() =>
												`When a media in my Watchlist has its release date changed`,
										)
										.with(
											"numberOfSeasonsChanged",
											() =>
												"When a media in my Watchlist has the number of seasons change",
										)
										.otherwise(() => undefined)}
									checked={isEnabled}
									onChange={(ev) => {
										updateUserEnabledFeatures.mutate({
											input: {
												property: `notifications.${snakeCase(name)}`,
												value: ev.currentTarget.checked,
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
