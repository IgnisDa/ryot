// oxlint-disable-next-line import/no-unassigned-import
import "./styles.css";
import { bootstrapClientPlugin } from "@ryot-app/client-sdk/plugin";

import { Details } from "./details";
import { Home } from "./home";

const NotFound = () => (
	<main>
		<h1>Page not found</h1>
	</main>
);

bootstrapClientPlugin({
	notFound: NotFound,
	home: { component: Home, header: () => ({ title: "Fixture home" }) },
	routes: [
		{
			component: Details,
			path: "/details/$itemId",
			header: ({ params }) => ({ title: `Item ${params.itemId}` }),
		},
	],
});
