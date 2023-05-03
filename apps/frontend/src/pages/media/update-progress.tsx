import type { NextPageWithLayout } from "../_app";
import LoggedIn from "@/lib/layouts/LoggedIn";
import type { ReactElement } from "react";

const Page: NextPageWithLayout = () => {
	return (
		<div>
			<div>Hello world from Index page!</div>
		</div>
	);
};

Page.getLayout = (page: ReactElement) => {
	return <LoggedIn>{page}</LoggedIn>;
};

export default Page;
