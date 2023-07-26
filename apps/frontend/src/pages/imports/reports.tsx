import type { NextPageWithLayout } from "../_app";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Box, Container, Stack, Text, Title } from "@mantine/core";
import { ImportReportsDocument } from "@ryot/generated/graphql/backend/graphql";
import { useQuery } from "@tanstack/react-query";
import Head from "next/head";
import { type ReactElement } from "react";

const Page: NextPageWithLayout = () => {
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
