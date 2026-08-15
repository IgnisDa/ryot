import { PluginLink, usePluginNavigation } from "@ryot/client-plugin-sdk";
import { Button } from "@ryot/client-ui-sdk";
import { useState } from "react";

import logo from "./logo.svg";

export const Home = () => {
	const [greetings, setGreetings] = useState(0);
	const { push } = usePluginNavigation();

	return (
		<main className="flex flex-col items-center gap-4 p-8 text-text">
			<img alt="" src={logo} className="plugin-logo" />
			<h1 className="font-display text-2xl">Fixture plugin</h1>
			<p className="text-text-muted">Greeted {greetings} times.</p>
			<Button onClick={() => setGreetings((count) => count + 1)}>Greet</Button>
			<PluginLink to="/details/item-1" search={{ tab: "stats" }}>
				Item 1 details
			</PluginLink>
			<Button variant="secondary" onClick={() => push({ path: "/details/item-2" })}>
				Open item 2
			</Button>
		</main>
	);
};
