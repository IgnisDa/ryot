import LoggedIn from "@/lib/layouts/LoggedIn";
import type { NextPageWithLayout } from "./_app";

const Page: NextPageWithLayout = () => {
	return (
		<div>
			<div>Hello world from Index page!</div>
		</div>
	);
};

Page.getLayout = LoggedIn;

export default Page;
