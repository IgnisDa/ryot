import LoggedIn from "@/lib/layouts/LoggedIn";
import type { NextPageWithLayout } from "./_app";
import type { ReactElement } from "react";
import { Container } from "@mantine/core";

const Page: NextPageWithLayout = () => {
	return (
		<Container>
			<div>Hello world from Books page!</div>
		</Container>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
