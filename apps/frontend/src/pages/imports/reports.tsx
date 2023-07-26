import type { NextPageWithLayout } from "../_app";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { getStringAsciiValue } from "@/lib/utilities";
import {
	Box,
	Card,
	Container,
	Flex,
	Stack,
	Text,
	Title,
	useMantineTheme,
} from "@mantine/core";
import {
	ImportFailStep,
	ImportReportsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase } from "@ryot/utilities";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement } from "react";

const Page: NextPageWithLayout = () => {
	const theme = useMantineTheme();
	const colors = Object.keys(theme.colors);

	const importReports = useQuery({
		queryKey: ["importReports"],
		queryFn: async () => {
			const { importReports } = await gqlClient.request(ImportReportsDocument);
			return importReports;
		},
	});

	return importReports.data ? (
		<>
			<Head>
				<title>Import Reports | Ryot</title>
			</Head>
			<Container>
				<Stack>
					<Title>Import Reports</Title>
					<Container size="xs" ml={0} pl={0}>
						<Card shadow="sm" padding={"sm"}>
							<Card.Section withBorder p="sm">
								<Text weight={500} size="lg">
									Legend
								</Text>
							</Card.Section>
							<Flex mt="xs" columnGap="xs" rowGap={3} wrap="wrap">
								{Object.values(ImportFailStep).map((s) => (
									<Text
										color={
											colors[
												(getStringAsciiValue(s) + colors.length) % colors.length
											]
										}
										size="xs"
									>
										{changeCase(s)}
									</Text>
								))}
							</Flex>
						</Card>
					</Container>
					{importReports.data.length > 0 ? (
						<Stack>
							{importReports.data.map((r) => (
								<Box key={r.id}>{JSON.stringify(r)}</Box>
							))}
						</Stack>
					) : (
						<Text>You have not performed any imports</Text>
					)}
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
