// oxlint-disable-next-line import/no-unassigned-import
import "./styles.css";
import { bootstrapClientPlugin } from "@ryot/client-sdk/plugin";

import { Details } from "./details";
import { Home } from "./home";

const NotFound = () => (
	<main>
		<h1>Page not found</h1>
	</main>
);

bootstrapClientPlugin({
	home: Home,
	notFound: NotFound,
	routes: [{ path: "/details/$itemId", component: Details }],
});
