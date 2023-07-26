import type { NextPageWithLayout } from "../_app";
import LoggedIn from "@/lib/layouts/LoggedIn";
import { Container, Stack, Text, Title } from "@mantine/core";
import Head from "next/head";
import { type ReactElement } from "react";

const Page: NextPageWithLayout = () => {
	return (
		<>
			<Head>
				<title>Perform imports | Ryot</title>
			</Head>
			<Container>
				<Stack>
					<Title>Fitness</Title>
					<Text>This page is still a WIP</Text>
				</Stack>
			</Container>
		</>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
