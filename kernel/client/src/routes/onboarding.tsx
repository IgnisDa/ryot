import { Button } from "@ryot-app/client-ui-sdk";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useReducer, useRef, useState } from "react";

import { type ServerMode, resolveServerOrigin, suggestedServerOrigin } from "#/api/origin";
import { isNativePlatform } from "#/modules/navigation/native-navigation";
import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";
import { initialConnectionState, reduceConnectionState } from "#/modules/server/connection-state";
import { sanitizeRedirect } from "#/modules/server/redirect";
import { decideOnboardingCompletion, decideOnboardingGate } from "#/modules/server/route-gates";
import { ServerService } from "#/modules/server/service";

const serverOptions = [
	{
		mode: "cloud",
		label: "Ryot Cloud",
		description: "The quickest way to start your personal library.",
	},
	{
		mode: "self-hosted",
		label: "Self-hosted",
		description: "Connect to a Ryot instance you manage.",
	},
] as const;

export const Route = createFileRoute("/onboarding")({
	component: Onboarding,
	validateSearch: (search) => ({ redirect: sanitizeRedirect(search.redirect) }),
	beforeLoad: ({ search, context }): ReturnType<typeof redirect> | undefined => {
		const isNative = isNativePlatform();
		const server = context.runtime.runSync(
			Effect.flatMap(ServerService, (service) => service.selected),
		);
		const decision = decideOnboardingGate(isNative, server, search.redirect);
		if (decision.action === "start-oauth") {
			return redirect({ to: decision.to, search: { redirect: decision.redirectTo } });
		}
		if (decision.action === "enter-god-mode") {
			return redirect({ href: decision.to });
		}
		return undefined;
	},
});

function Onboarding() {
	const { runtime } = Route.useRouteContext();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const serverService = runtime.runSync(ServerService);
	const [mode, setMode] = useState<ServerMode>("cloud");
	const [serverUrl, setServerUrl] = useState(() => suggestedServerOrigin(undefined));
	const [validationError, setValidationError] = useState<string>();
	const [connection, dispatch] = useReducer(reduceConnectionState, initialConnectionState);
	const connectionController = useRef<AbortController>(null);
	const checking = connection.status === "checking";
	usePageTitle("Set up your server");
	useEffect(() => () => connectionController.current?.abort(), []);

	function changeMode(nextMode: ServerMode) {
		setMode(nextMode);
		setValidationError(undefined);
		dispatch({ type: "changed" });
	}

	let submitLabel = "Continue";
	if (checking) {
		submitLabel = "Checking...";
	} else if (connection.status === "error") {
		submitLabel = "Retry";
	}

	async function connect() {
		setValidationError(undefined);

		const result = resolveServerOrigin(mode, serverUrl);
		if (!result.ok) {
			setValidationError("Enter a valid URL, including http:// or https://.");
			dispatch({ type: "changed" });
			return;
		}

		dispatch({ type: "started" });
		connectionController.current?.abort();
		const controller = new AbortController();
		connectionController.current = controller;
		const connected = await runtime
			.runPromise(serverService.connect(result.origin), { signal: controller.signal })
			.then(
				() => true,
				() => false,
			);
		if (controller.signal.aborted) {
			return;
		}
		if (!connected) {
			dispatch({ type: "failed" });
			return;
		}
		dispatch({ type: "succeeded" });
		const decision = decideOnboardingCompletion(search.redirect);
		if (decision.action === "enter-god-mode") {
			await navigate({ replace: true, href: decision.to, search: { redirect: undefined } });
			return;
		}
		await navigate({ replace: true, to: decision.to, search: { redirect: decision.redirectTo } });
	}

	return (
		<main
			{...mainContentProps}
			className="ui-page md:grid-cols-[minmax(260px,400px)_minmax(400px,480px)] md:items-center md:justify-center md:gap-[clamp(48px,8vw,112px)] md:px-12"
		>
			<section aria-labelledby="onboarding-title" className="mx-auto w-[min(100%,480px)] md:mx-0">
				<p className="ui-overline">Your private library</p>
				<h1 id="onboarding-title" className="ui-heading">
					Your Ryot, your server.
				</h1>
				<p className="ui-subtitle">
					Choose where your data lives. Ryot checks the connection before saving your selection.
				</p>
			</section>

			<form
				noValidate
				className="ui-card mx-auto w-[min(100%,480px)] md:mx-0"
				onSubmit={(event) => {
					event.preventDefault();
					void connect();
				}}
			>
				<fieldset disabled={checking}>
					<legend className="ui-field-caption">Choose a server</legend>
					<div className="grid gap-2.5">
						{serverOptions.map((option) => (
							<label
								key={option.mode}
								className="grid min-h-18 grid-cols-[auto_1fr] items-start gap-3 rounded-lg border border-border p-3.5 has-checked:border-accent-deep has-checked:bg-accent-soft has-checked:shadow-sm"
							>
								<input
									type="radio"
									name="server-mode"
									value={option.mode}
									checked={mode === option.mode}
									onChange={() => changeMode(option.mode)}
									className="mt-0.75 size-4.5 accent-accent"
								/>
								<span className="grid gap-0.75">
									<strong className="text-base font-semibold">{option.label}</strong>
									<small className="text-sm text-text-muted">{option.description}</small>
								</span>
							</label>
						))}
					</div>

					{mode === "self-hosted" && (
						<label className="mt-4 grid">
							<span className="ui-field-caption">Server URL</span>
							<input
								type="url"
								inputMode="url"
								autoCorrect="off"
								value={serverUrl}
								autoCapitalize="none"
								className="ui-field-input"
								placeholder="https://ryot.example.com"
								aria-invalid={validationError !== undefined}
								aria-describedby={validationError ? "server-url-error" : undefined}
								onChange={(event) => {
									setServerUrl(event.currentTarget.value);
									setValidationError(undefined);
									dispatch({ type: "changed" });
								}}
							/>
						</label>
					)}
				</fieldset>

				<div aria-live="polite" className="flex min-h-11.25 items-center">
					{validationError && (
						<p role="alert" id="server-url-error" className="ui-form-status text-danger">
							{validationError}
						</p>
					)}
					{connection.status === "checking" && (
						<p role="status" className="ui-form-status">
							Checking server...
						</p>
					)}
					{connection.status === "error" && (
						<p role="alert" className="ui-form-status text-danger">
							Could not reach a healthy Ryot server. Check the address and try again.
						</p>
					)}
					{connection.status === "success" && (
						<p role="status" className="ui-form-status text-success">
							Server connected. Continuing...
						</p>
					)}
				</div>

				<Button
					type="submit"
					variant="primary"
					className="w-full"
					disabled={checking || (mode === "self-hosted" && !serverUrl.trim())}
				>
					{submitLabel}
				</Button>
			</form>
		</main>
	);
}
