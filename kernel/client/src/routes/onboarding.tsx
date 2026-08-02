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
		<main className="grid min-h-screen content-center gap-8 px-5 pt-[max(72px,calc(env(safe-area-inset-top)+56px))] pb-[max(32px,env(safe-area-inset-bottom))] md:grid-cols-[minmax(260px,400px)_minmax(400px,480px)] md:items-center md:justify-center md:gap-[clamp(48px,8vw,112px)] md:px-12">
			<section aria-labelledby="onboarding-title" className="mx-auto w-[min(100%,480px)] md:mx-0">
				<p className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-accent-text uppercase">
					Your private library
				</p>
				<h1
					id="onboarding-title"
					className="font-display text-[clamp(30px,7vw,42px)] leading-[1.18] font-semibold tracking-tight"
				>
					Your Ryot, your server.
				</h1>
				<p className="mt-3 text-text-muted">
					Choose where your data lives. Ryot checks the connection before saving your selection.
				</p>
			</section>

			<form
				noValidate
				className="mx-auto w-[min(100%,480px)] rounded-xl border border-border bg-surface p-5 shadow-card md:mx-0 md:p-6"
				onSubmit={(event) => {
					event.preventDefault();
					void connect();
				}}
			>
				<fieldset disabled={checking}>
					<legend className="mb-2.5 text-[13px] font-semibold">Choose a server</legend>
					<div className="grid gap-2.5">
						{serverOptions.map((option) => (
							<label
								key={option.mode}
								className="grid min-h-18 cursor-pointer grid-cols-[auto_1fr] items-start gap-3 rounded-lg border border-border p-3.5 has-checked:border-accent has-checked:bg-accent-soft has-checked:shadow-sm"
							>
								<input
									type="radio"
									name="server-mode"
									value={option.mode}
									checked={mode === option.mode}
									className="mt-0.75 size-4.5 accent-accent"
									onChange={() => changeMode(option.mode)}
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
							<span className="mb-2.5 text-[13px] font-semibold">Server URL</span>
							<input
								type="url"
								inputMode="url"
								autoCorrect="off"
								value={serverUrl}
								autoCapitalize="none"
								placeholder="https://ryot.example.com"
								aria-invalid={validationError !== undefined}
								aria-describedby={validationError ? "server-url-error" : undefined}
								className="min-h-12 w-full rounded-lg border border-border-strong bg-raised px-3.5 py-2.75 text-text placeholder:text-text-subtle"
								onChange={(event) => {
									setServerUrl(event.currentTarget.value);
									setValidationError(undefined);
									dispatch({ type: "changed" });
								}}
							/>
						</label>
					)}
				</fieldset>

				<div className="flex min-h-11.25 items-center" aria-live="polite">
					{validationError && (
						<p role="alert" id="server-url-error" className="mt-2.5 mb-1.5 text-sm text-danger">
							{validationError}
						</p>
					)}
					{connection.status === "checking" && (
						<p role="status" className="mt-2.5 mb-1.5 text-sm">
							Checking server...
						</p>
					)}
					{connection.status === "error" && (
						<p role="alert" className="mt-2.5 mb-1.5 text-sm text-danger">
							Could not reach a healthy Ryot server. Check the address and try again.
						</p>
					)}
					{connection.status === "success" && (
						<p role="status" className="mt-2.5 mb-1.5 text-sm text-success">
							Server connected. Continuing...
						</p>
					)}
				</div>

				<button
					type="submit"
					className="min-h-11 w-full cursor-pointer rounded-lg border border-accent bg-accent px-4 py-2.5 font-semibold text-accent-ink"
					disabled={checking || (mode === "self-hosted" && !serverUrl.trim())}
				>
					{submitLabel}
				</button>
			</form>
		</main>
	);
}
