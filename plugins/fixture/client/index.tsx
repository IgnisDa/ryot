// oxlint-disable-next-line import/no-unassigned-import
import "./styles.css";
import { bootstrapClientPlugin } from "@ryot-app/client-sdk/plugin";

import { Details } from "./details";
import { FullBleed } from "./full-bleed";
import { Home } from "./home";

const NotFound = () => (
	<main>
		<h1>Page not found</h1>
	</main>
);

bootstrapClientPlugin({
	notFound: NotFound,
	home: { component: Home },
	routes: [
		{ component: FullBleed, path: "/full-bleed" },
		{ component: Details, path: "/details/$itemId" },
	],
});
