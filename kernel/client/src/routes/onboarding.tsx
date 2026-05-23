import { createFileRoute, redirect } from "@tanstack/react-router";
import { useReducer, useState } from "react";

import { type ServerMode, resolveServerOrigin } from "../api/origin";
import { checkServerHealth } from "../api/public";
import { verifyAndSaveServer } from "../modules/server/connect";
import { initialConnectionState, reduceConnectionState } from "../modules/server/connection-state";
import { sanitizeRedirect } from "../modules/server/redirect";
import { decideOnboardingGate } from "../modules/server/route-gates";
import { getServerSelection, setServerSelection } from "../persistence/storage";

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
	beforeLoad: ({ search }) => {
		const decision = decideOnboardingGate(getServerSelection(), search.redirect);
		if (decision.action === "redirect") {
			return redirect({ to: decision.to, search: { redirect: decision.redirectTo } });
		}
		return undefined;
	},
});

function Onboarding() {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const [mode, setMode] = useState<ServerMode>("cloud");
	const [serverUrl, setServerUrl] = useState("");
	const [validationError, setValidationError] = useState<string>();
	const [connection, dispatch] = useReducer(reduceConnectionState, initialConnectionState);
	const checking = connection.status === "checking";

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
		const connected = await verifyAndSaveServer(result.origin, {
			checkHealth: checkServerHealth,
			saveServer: setServerSelection,
		});
		if (!connected) {
			dispatch({ type: "failed" });
			return;
		}
		dispatch({ type: "succeeded" });
		await navigate({ to: "/auth", replace: true, search: { redirect: search.redirect } });
	}

	return (
		<main className="onboarding-shell">
			<section className="onboarding-intro" aria-labelledby="onboarding-title">
				<p className="overline">Your private library</p>
				<h1 id="onboarding-title">Your Ryot, your server.</h1>
				<p>
					Choose where your data lives. Ryot checks the connection before saving your selection.
				</p>
			</section>

			<form
				noValidate
				className="connection-card"
				onSubmit={(event) => {
					event.preventDefault();
					void connect();
				}}
			>
				<fieldset disabled={checking}>
					<legend>Choose a server</legend>
					<div className="server-options">
						{serverOptions.map((option) => (
							<label className="server-option" key={option.mode}>
								<input
									type="radio"
									name="server-mode"
									value={option.mode}
									checked={mode === option.mode}
									onChange={() => changeMode(option.mode)}
								/>
								<span>
									<strong>{option.label}</strong>
									<small>{option.description}</small>
								</span>
							</label>
						))}
					</div>

					{mode === "self-hosted" && (
						<label className="url-field">
							<span>Server URL</span>
							<input
								type="url"
								inputMode="url"
								autoCorrect="off"
								value={serverUrl}
								autoCapitalize="none"
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

				<div className="connection-message" aria-live="polite">
					{validationError && (
						<p id="server-url-error" role="alert" className="status-error">
							{validationError}
						</p>
					)}
					{connection.status === "checking" && <p role="status">Checking server...</p>}
					{connection.status === "error" && (
						<p role="alert" className="status-error">
							Could not reach a healthy Ryot server. Check the address and try again.
						</p>
					)}
					{connection.status === "success" && (
						<p role="status" className="status-success">
							Server connected. Continuing...
						</p>
					)}
				</div>

				<button
					type="submit"
					className="primary-button"
					disabled={checking || (mode === "self-hosted" && !serverUrl.trim())}
				>
					{submitLabel}
				</button>
			</form>
		</main>
	);
}
