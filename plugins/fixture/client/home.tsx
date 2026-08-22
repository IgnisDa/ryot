import { RyotClientError } from "@ryot/client-sdk";
import { Schema } from "@ryot/client-sdk/effect";
import { PluginLink } from "@ryot/client-sdk/plugin";
import {
	createRyotMutation,
	createRyotQuery,
	useRyot,
	useRyotMutation,
	useRyotQuery,
	useRyotTheme,
} from "@ryot/client-sdk/react";
import { Button, StatusMessage } from "@ryot/client-ui-sdk";
import { useState } from "react";

import logo from "./logo.svg";
import { fixtureClientPluginCatalogRecipe } from "./query-recipes";

const Greeting = Schema.Struct({ greeting: Schema.String });

type GreetingInput = { readonly name: string | number };

const catalogTones = { error: "error", pending: "pending", success: "success" } as const;

const greetingTones = {
	error: "error",
	idle: "pending",
	pending: "pending",
	success: "success",
} as const;

const fixtureClientPluginCatalogQuery = createRyotQuery(({ client, signal }) =>
	client.data.query(fixtureClientPluginCatalogRecipe(), { signal }),
);

const greetingMutation = createRyotMutation<GreetingInput, typeof Greeting.Type>(
	({ client, input }) => client.operations.invoke({ slug: "greet", output: Greeting, input }),
);

export const Home = () => {
	const ryot = useRyot();
	const theme = useRyotTheme();
	const [greetings, setGreetings] = useState(0);
	const greeting = useRyotMutation(greetingMutation);
	const [requested, setRequested] = useState("Ryot");
	const [shouldCrash, setShouldCrash] = useState(false);
	const catalog = useRyotQuery(fixtureClientPluginCatalogQuery);
	const refused =
		greeting.status === "error" &&
		greeting.error instanceof RyotClientError &&
		greeting.error.reason === "operation-failed";
	const installedPluginSlugs = catalog.data?.map(({ slug }) => slug).join(", ") ?? "";
	let catalogMessage = "Client plugin catalog is unavailable.";
	if (catalog.status === "pending") {
		catalogMessage = "Fetching installed client plugins...";
	} else if (catalog.status === "success") {
		catalogMessage = `Installed client plugins: ${installedPluginSlugs}`;
	}
	let greetingMessage = "";
	if (greeting.status === "pending") {
		greetingMessage = "Requesting a greeting...";
	} else if (greeting.status === "error") {
		greetingMessage = refused
			? "The server refused this greeting."
			: "Greetings are unavailable right now.";
	} else if (greeting.status === "success") {
		greetingMessage = greeting.data?.greeting ?? "";
	}

	if (shouldCrash) {
		throw new Error("fixture render failure");
	}

	const requestGreeting = (name: string) => {
		setRequested(name);
		greeting.mutate({ name });
	};

	return (
		<main className="flex min-h-screen w-full flex-col items-center gap-4 bg-bg p-8 text-text">
			<img alt="" src={logo} className="plugin-logo" />
			<h1 className="font-display text-2xl">Fixture plugin</h1>
			<p className="text-text-muted">Greeted {greetings} times.</p>
			<Button onClick={() => setGreetings((count) => count + 1)}>Greet</Button>
			<Button variant="secondary" onClick={() => setShouldCrash(true)}>
				Crash during render
			</Button>
			<section
				aria-labelledby="fixture-theme-title"
				className="w-full max-w-md rounded-lg border border-border bg-surface p-4"
			>
				<h2 id="fixture-theme-title" className="font-display text-lg text-accent-text">
					Theme snapshot
				</h2>
				<p role="status" aria-live="polite" className="text-sm text-text-muted">
					Resolved mode: <strong className="text-accent-text">{theme.resolvedMode}</strong>
				</p>
				<StatusMessage className="mt-2" tone="success">
					Semantic theme tokens synchronized.
				</StatusMessage>
				<div className="mt-3 rounded-md border border-accent bg-accent-soft p-3 text-sm text-text">
					Accent surface with semantic border and primary text
				</div>
			</section>
			<section aria-labelledby="fixture-catalog-title" className="flex flex-col items-center gap-2">
				<h2 id="fixture-catalog-title" className="font-display text-lg">
					Client plugin catalog
				</h2>
				<StatusMessage id="fixture-catalog-status" tone={catalogTones[catalog.status]}>
					{catalogMessage}
				</StatusMessage>
				<Button
					onClick={catalog.refetch}
					disabled={catalog.isFetching}
					aria-describedby="fixture-catalog-status"
				>
					Refresh catalog
				</Button>
			</section>
			<section
				aria-labelledby="fixture-greeting-title"
				className="flex flex-col items-center gap-2"
			>
				<h2 id="fixture-greeting-title" className="font-display text-lg">
					Server greeting
				</h2>
				<StatusMessage tone={greetingTones[greeting.status]}>{greetingMessage}</StatusMessage>
				{greeting.status === "error" ? (
					<Button variant="secondary" onClick={() => requestGreeting(requested)}>
						Try again
					</Button>
				) : null}
				<Button onClick={() => requestGreeting("Ryot")}>Fetch greeting</Button>
				<Button variant="text" onClick={() => requestGreeting("")}>
					Fetch without a name
				</Button>
				<Button variant="text" onClick={() => greeting.mutate({ name: Number.NaN })}>
					Fetch with invalid payload
				</Button>
			</section>
			<PluginLink to="/details/item-1" search={{ tab: "stats" }}>
				Item 1 details
			</PluginLink>
			<Button variant="secondary" onClick={() => ryot.navigation.push({ path: "/details/item-2" })}>
				Open item 2
			</Button>
		</main>
	);
};
