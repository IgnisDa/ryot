import LoggedIn from "@/lib/layouts/LoggedIn";
import type { NextPageWithLayout } from "../_app";
import { type ReactElement } from "react";
import { Container, Stack } from "@mantine/core";
import { useRouter } from "next/router";

const Page: NextPageWithLayout = () => {
	const router = useRouter();

	return (
		<Container>
			<Stack>{JSON.stringify(router.query)}</Stack>
		</Container>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
