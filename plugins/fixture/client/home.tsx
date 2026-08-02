import { RyotClientError } from "@ryot/client-sdk";
import { Schema } from "@ryot/client-sdk/effect";
import { PluginLink } from "@ryot/client-sdk/plugin";
import { useRyot, useRyotTheme } from "@ryot/client-sdk/react";
import { Button, StatusMessage } from "@ryot/client-ui-sdk";
import { useState } from "react";

import logo from "./logo.svg";

const Greeting = Schema.Struct({ greeting: Schema.String });

const greetingTones = {
	idle: "pending",
	ready: "success",
	refused: "error",
	pending: "pending",
	unavailable: "error",
} as const;

const greetingMessages = {
	idle: "",
	ready: "",
	pending: "Requesting a greeting...",
	refused: "The server refused this greeting.",
	unavailable: "Greetings are unavailable right now.",
} as const;

type GreetingState =
	| { readonly status: "idle" }
	| { readonly status: "pending" }
	| { readonly status: "refused" }
	| { readonly status: "unavailable" }
	| { readonly status: "ready"; readonly greeting: string };

export const Home = () => {
	const ryot = useRyot();
	const theme = useRyotTheme();
	const [greetings, setGreetings] = useState(0);
	const [requested, setRequested] = useState("Ryot");
	const [greeting, setGreeting] = useState<GreetingState>({ status: "idle" });
	const [shouldCrash, setShouldCrash] = useState(false);
	const failed = greeting.status === "refused" || greeting.status === "unavailable";

	if (shouldCrash) {
		throw new Error("fixture render failure");
	}

	const requestGreeting = async (name: string) => {
		setRequested(name);
		setGreeting({ status: "pending" });
		try {
			const result = await ryot.operations.invoke({
				slug: "greet",
				input: { name },
				output: Greeting,
			});
			setGreeting({ status: "ready", greeting: result.greeting });
		} catch (error) {
			const refused = error instanceof RyotClientError && error.reason === "operation-failed";
			setGreeting({ status: refused ? "refused" : "unavailable" });
		}
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
			<section
				aria-labelledby="fixture-greeting-title"
				className="flex flex-col items-center gap-2"
			>
				<h2 id="fixture-greeting-title" className="font-display text-lg">
					Server greeting
				</h2>
				<StatusMessage tone={greetingTones[greeting.status]}>
					{greeting.status === "ready" ? greeting.greeting : greetingMessages[greeting.status]}
				</StatusMessage>
				{failed ? (
					<Button variant="secondary" onClick={() => void requestGreeting(requested)}>
						Try again
					</Button>
				) : null}
				<Button onClick={() => void requestGreeting("Ryot")}>Fetch greeting</Button>
				<Button variant="text" onClick={() => void requestGreeting("")}>
					Fetch without a name
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
