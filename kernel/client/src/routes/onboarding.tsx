import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useReducer, useRef, useState } from "react";

import { resolveServerOrigin, type ServerMode, suggestedServerOrigin } from "#/api/origin";
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
		label: kernelMessage("client.route.onboarding.cloud-label"),
		description: kernelMessage("client.route.onboarding.cloud-detail"),
	},
	{
		mode: "self-hosted",
		label: kernelMessage("client.route.onboarding.self-hosted-label"),
		description: kernelMessage("client.route.onboarding.self-hosted-detail"),
	},
] as const satisfies readonly {
	readonly label: Message;
	readonly mode: ServerMode;
	readonly description: Message;
}[];

export const Route = createFileRoute("/onboarding")({
	component: Onboarding,
	validateSearch: (search) => ({ redirect: sanitizeRedirect(search.redirect) }),
	beforeLoad: ({ search, context }): undefined | ReturnType<typeof redirect> => {
		const isNative = isNativePlatform();
		const server = context.runtime.runSync(
			Effect.flatMap(ServerService, (service) => service.selected),
		);
		const decision = decideOnboardingGate(isNative, server, search.redirect);
		if (decision.action === "start-oauth") {
			return redirect({ to: decision.to, search: { redirect: decision.redirectTo } });
		}
		if (decision.action === "enter-instance-admin") {
			return redirect({ href: decision.to });
		}
		return undefined;
	},
});

function Onboarding() {
	const t = useT();
	const { runtime } = Route.useRouteContext();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const serverService = runtime.runSync(ServerService);
	const [mode, setMode] = useState<ServerMode>("cloud");
	const [serverUrl, setServerUrl] = useState(() => suggestedServerOrigin(undefined));
	const [validationError, setValidationError] = useState<Message>();
	const [connection, dispatch] = useReducer(reduceConnectionState, initialConnectionState);
	const connectionController = useRef<AbortController>(null);
	const checking = connection.status === "checking";
	usePageTitle(t(kernelMessage("client.route.onboarding.page-title")));
	useEffect(() => () => connectionController.current?.abort(), []);

	function changeMode(nextMode: ServerMode) {
		setMode(nextMode);
		setValidationError(undefined);
		dispatch({ type: "changed" });
	}

	let submitLabel = t(kernelMessage("common.action.continue"));
	if (checking) {
		submitLabel = t(kernelMessage("client.route.onboarding.checking"));
	} else if (connection.status === "error") {
		submitLabel = t(kernelMessage("common.action.retry"));
	}

	function connect() {
		setValidationError(undefined);

		const result = resolveServerOrigin(mode, serverUrl);
		if (!result.ok) {
			setValidationError(kernelMessage("client.route.onboarding.invalid-url"));
			dispatch({ type: "changed" });
			return Promise.resolve();
		}

		dispatch({ type: "started" });
		connectionController.current?.abort();
		const controller = new AbortController();
		connectionController.current = controller;
		return runtime.runPromiseExit(
			Effect.gen(function* () {
				const connected = yield* serverService
					.connect(result.origin)
					.pipe(Effect.matchCause({ onSuccess: () => true, onFailure: () => false }));
				if (controller.signal.aborted) {
					return;
				}
				if (!connected) {
					dispatch({ type: "failed" });
					return;
				}
				dispatch({ type: "succeeded" });
				const decision = decideOnboardingCompletion(search.redirect);
				yield* Effect.promise(() =>
					decision.action === "enter-instance-admin"
						? navigate({ replace: true, href: decision.to, search: { redirect: undefined } })
						: navigate({
								replace: true,
								to: decision.to,
								search: { redirect: decision.redirectTo },
							}),
				);
			}),
			{ signal: controller.signal },
		);
	}

	return (
		<main
			{...mainContentProps}
			className="ui-page md:grid-cols-[minmax(260px,400px)_minmax(400px,480px)] md:items-center md:justify-center md:gap-[clamp(48px,8vw,112px)] md:px-12"
		>
			<section aria-labelledby="onboarding-title" className="mx-auto w-[min(100%,480px)] md:mx-0">
				<p className="ui-overline">{t(kernelMessage("client.route.onboarding.overline"))}</p>
				<h1 id="onboarding-title" className="ui-heading">
					{t(kernelMessage("client.route.onboarding.heading"))}
				</h1>
				<p className="ui-subtitle">{t(kernelMessage("client.route.onboarding.intro"))}</p>
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
					<legend className="ui-field-caption">
						{t(kernelMessage("client.route.onboarding.choose-server"))}
					</legend>
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
									<strong className="text-base font-semibold">{t(option.label)}</strong>
									<small className="text-sm text-text-muted">{t(option.description)}</small>
								</span>
							</label>
						))}
					</div>

					{mode === "self-hosted" && (
						<label className="mt-4 grid">
							<span className="ui-field-caption">
								{t(kernelMessage("client.route.onboarding.server-url"))}
							</span>
							<input
								type="url"
								inputMode="url"
								autoCorrect="off"
								value={serverUrl}
								autoCapitalize="none"
								className="ui-field-input"
								aria-invalid={validationError !== undefined}
								aria-describedby={validationError ? "server-url-error" : undefined}
								placeholder={t(kernelMessage("client.route.onboarding.server-url-placeholder"))}
								onChange={(event) => {
									setServerUrl(event.currentTarget.value);
									setValidationError(undefined);
									dispatch({ type: "changed" });
								}}
							/>
							{validationError && (
								<small role="alert" id="server-url-error" className="ui-field-error mt-1.5">
									{t(validationError)}
								</small>
							)}
						</label>
					)}
				</fieldset>

				<div aria-live="polite">
					{connection.status === "checking" && (
						<p role="status" className="ui-form-status">
							{t(kernelMessage("client.route.onboarding.status-checking"))}
						</p>
					)}
					{connection.status === "error" && (
						<p role="alert" className="ui-form-status text-danger">
							{t(kernelMessage("client.route.onboarding.status-failed"))}
						</p>
					)}
					{connection.status === "success" && (
						<p role="status" className="ui-form-status text-success">
							{t(kernelMessage("client.route.onboarding.status-succeeded"))}
						</p>
					)}
				</div>

				<Button
					type="submit"
					variant="primary"
					className="mt-4 w-full"
					disabled={checking || (mode === "self-hosted" && !serverUrl.trim())}
				>
					{submitLabel}
				</Button>
			</form>
		</main>
	);
}
