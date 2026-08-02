// oxlint-disable-next-line import/no-unassigned-import
import "./styles.css";
import { bootstrapClientPlugin, defineClientPlugin } from "@ryot/client-sdk/plugin";

import { Details } from "./details";
import { Home } from "./home";

bootstrapClientPlugin(
	defineClientPlugin({
		home: Home,
		routes: [{ path: "/details/$itemId", component: Details }],
	}),
);
