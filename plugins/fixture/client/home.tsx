import { Button } from "@ryot/client-ui-sdk";
import { useState } from "react";

import logo from "./logo.svg";

export const FixtureHome = () => {
	const [greetings, setGreetings] = useState(0);

	return (
		<main className="flex flex-col items-center gap-4 p-8 text-text">
			<img alt="" src={logo} className="fixture-logo" />
			<h1 className="font-display text-2xl">Fixture plugin</h1>
			<p className="text-text-muted">Greeted {greetings} times.</p>
			<Button onClick={() => setGreetings((count) => count + 1)}>Greet</Button>
		</main>
	);
};
