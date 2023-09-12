import { useCoreDetails } from "@/lib/hooks/graphql";
import LoadingPage from "@/lib/layouts/LoadingPage";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { Box, Container, Stack } from "@mantine/core";
import Head from "next/head";
import { type ReactElement } from "react";
import type { NextPageWithLayout } from "./_app";

const Page: NextPageWithLayout = () => {
	const coreDetails = useCoreDetails();

	return coreDetails.data ? (
		<>
			<Head>
				<title>Calendar</title>
			</Head>
			<Container>
				<Stack>
					<Box>Hello</Box>
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
