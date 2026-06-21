import { RyotClientError } from "@ryot-app/client-sdk";
import { Schema } from "@ryot-app/client-sdk/effect";
import { PluginLink } from "@ryot-app/client-sdk/plugin";
import {
	createRyotMutation,
	createRyotQuery,
	useRyot,
	useRyotMutation,
	useRyotQuery,
	useRyotTheme,
} from "@ryot-app/client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/client-sdk/screen";
import { Button, StatusMessage } from "@ryot-app/client-ui-sdk";
import clsx from "clsx";
import { useState } from "react";

import importedLogo from "./imported-logo.png";
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
		<PluginScreenFrame title="Fixture plugin">
			<div className="flex w-full flex-col items-center gap-4 text-text">
				<img alt="" src={logo} className="plugin-logo" />
				<section
					className="flex flex-col items-center gap-3"
					aria-labelledby="fixture-binary-assets-title"
				>
					<h2 id="fixture-binary-assets-title" className="font-display text-lg">
						Binary plugin assets
					</h2>
					<div className="flex items-center gap-2">
						<img
							src={importedLogo}
							className="plugin-logo"
							alt="Fixture plugin binary TSX import logo"
						/>
						<span>Binary TSX import asset</span>
					</div>
					<div className="flex items-center gap-2">
						<div role="img" aria-label="Fixture plugin binary CSS URL logo" className="css-logo" />
						<span>Binary CSS URL asset</span>
					</div>
				</section>
				<p className="text-text-muted">Greeted {greetings} times.</p>
				<Button onClick={() => setGreetings((count) => count + 1)}>Greet</Button>
				<Button variant="secondary" onClick={() => setShouldCrash(true)}>
					Crash during render
				</Button>
				<section
					aria-labelledby="fixture-theme-title"
					className={clsx("w-full max-w-md", "rounded-lg border border-border bg-surface p-4")}
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
				<section
					aria-labelledby="fixture-catalog-title"
					className="flex flex-col items-center gap-2"
				>
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
				<PluginLink to={{ kind: "route", path: "/details/item-1", search: { tab: "stats" } }}>
					Item 1 details
				</PluginLink>
				<Button
					variant="secondary"
					onClick={() => ryot.navigation.push({ kind: "route", path: "/details/item-2" })}
				>
					Open item 2
				</Button>
				<PluginLink to={{ kind: "route", path: "/full-bleed" }}>Full-bleed screen</PluginLink>
				<PluginLink to={{ kind: "entity", entityId: "fixture-entity" }}>
					Open fixture entity
				</PluginLink>
			</div>
		</PluginScreenFrame>
	);
};
