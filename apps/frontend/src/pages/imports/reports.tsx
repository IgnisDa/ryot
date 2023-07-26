import type { NextPageWithLayout } from "../_app";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { gqlClient } from "@/lib/services/api";
import { Container, Stack, Title } from "@mantine/core";
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

	return (
		<>
			<Head>
				<title>Import Reports | Ryot</title>
			</Head>
			<Container>
				<Stack>
					<Title>Import Reports</Title>
					{JSON.stringify(importReports.data)}
				</Stack>
			</Container>
		</>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
