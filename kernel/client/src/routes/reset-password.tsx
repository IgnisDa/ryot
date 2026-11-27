import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { createErrorVisibility, useForm } from "@tanstack/react-form";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Effect } from "effect";
import { type ReactNode, useEffect, useRef, useState } from "react";

import type { ServerOrigin } from "#/api/origin";
import { validatePassword } from "#/modules/auth/form-values";
import { HostedAuthService } from "#/modules/auth/hosted-service";
import { AuthStatus } from "#/modules/auth/status";
import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";
import { ServerService } from "#/modules/server/service";
import type { ClientRuntime } from "#/runtime";

const errorVisibility = createErrorVisibility(
	({ state, fieldState }) => fieldState.meta.isBlurred || state.submissionAttempts > 0,
);

export const Route = createFileRoute("/reset-password")({
	component: ResetPassword,
	validateSearch: (search) => ({
		token: typeof search.token === "string" && search.token !== "" ? search.token : undefined,
	}),
	beforeLoad: ({ search, context }) => {
		if (search.token === undefined) {
			return { server: null };
		}
		const server = context.runtime.runSync(
			Effect.flatMap(ServerService, (service) => service.selected),
		);
		if (server === null) {
			throw redirect({
				replace: true,
				to: "/onboarding",
				search: { redirect: `/reset-password?token=${encodeURIComponent(search.token)}` },
			});
		}
		return { server };
	},
});

function ResetPasswordFrame(props: { readonly children: ReactNode }) {
	const t = useT();
	usePageTitle(t(kernelMessage("client.route.reset-password.choose-title")));
	return (
		<main {...mainContentProps} className="ui-page">
			{props.children}
		</main>
	);
}

function ResetPassword() {
	const t = useT();
	const { token } = Route.useSearch();
	const navigate = Route.useNavigate();
	const { server, runtime } = Route.useRouteContext();

	if (token === undefined) {
		return (
			<AuthStatus
				title={t(kernelMessage("client.route.reset-password.invalid-title"))}
				message={t(kernelMessage("client.route.reset-password.invalid-detail"))}
				actions={
					<Button
						type="button"
						variant="primary"
						className="w-full"
						onClick={() =>
							void navigate({ to: "/auth", replace: true, search: { redirect: undefined } })
						}
					>
						{t(kernelMessage("client.auth.back-to-sign-in"))}
					</Button>
				}
			/>
		);
	}

	if (server === null) {
		return null;
	}

	return <ResetPasswordForm token={token} server={server} runtime={runtime} />;
}

function ResetPasswordForm(props: {
	readonly token: string;
	readonly server: ServerOrigin;
	readonly runtime: ClientRuntime;
}) {
	const t = useT();
	const navigate = Route.useNavigate();
	const auth = props.runtime.runSync(HostedAuthService);
	const confirmationRef = useRef<HTMLInputElement>(null);
	const controller = useRef(new AbortController());
	const [done, setDone] = useState(false);
	const [serverError, setServerError] = useState<Message>();
	useEffect(() => () => controller.current.abort(), []);

	const form = useForm({
		errorVisibility,
		defaultValues: { password: "", confirmation: "" },
		onSubmit: ({ value }) =>
			props.runtime.runPromiseExit(
				Effect.gen(function* () {
					setServerError(undefined);
					if (value.password !== value.confirmation) {
						setServerError(kernelMessage("client.route.reset-password.passwords-differ"));
						return;
					}
					yield* auth
						.resetPassword(props.server, props.token, value.password)
						.pipe(
							Effect.match({
								onSuccess: () => setDone(true),
								onFailure: (error) =>
									setServerError(
										error.code === "INVALID_TOKEN"
											? kernelMessage("client.route.reset-password.token-invalid")
											: kernelMessage("client.route.reset-password.reset-failed"),
									),
							}),
						);
				}),
				{ signal: controller.current.signal },
			),
	});

	if (done) {
		return (
			<AuthStatus
				title={t(kernelMessage("client.route.reset-password.done-title"))}
				message={t(kernelMessage("client.route.reset-password.done-detail"))}
				actions={
					<Button
						type="button"
						variant="primary"
						className="w-full"
						onClick={() =>
							void navigate({ to: "/auth", replace: true, search: { redirect: undefined } })
						}
					>
						{t(kernelMessage("common.action.sign-in"))}
					</Button>
				}
			/>
		);
	}

	return (
		<ResetPasswordFrame>
			<section
				aria-labelledby="reset-password-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				<div>
					<h1 className="ui-heading" id="reset-password-title">
						{t(kernelMessage("client.route.reset-password.choose-title"))}
					</h1>
					<p className="ui-subtitle">{t(kernelMessage("client.route.reset-password.hint"))}</p>
				</div>
				<form
					noValidate
					className="ui-stack"
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<form.Subscribe selector={(state) => state.isSubmitting}>
						{(isSubmitting) => (
							<>
								<form.Field
									name="password"
									validators={[
										{
											runOnMount: true,
											triggers: ["change", "blur"],
											run: ({ value }) => validatePassword(t, value),
										},
									]}
								>
									{(field) => (
										<label className="ui-field-label">
											<span>{t(kernelMessage("client.route.reset-password.new-password"))}</span>
											<input
												autoFocus
												type="password"
												name={field.name}
												value={field.value}
												disabled={isSubmitting}
												onBlur={field.handleBlur}
												className="ui-field-input"
												autoComplete="new-password"
												aria-invalid={field.errors.length > 0}
												placeholder={t(kernelMessage("client.route.reset-password.new-password"))}
												aria-describedby={
													field.errors.length > 0 ? "new-password-error" : undefined
												}
												onChange={(event) => {
													field.handleChange(event.currentTarget.value);
													setServerError(undefined);
												}}
												onKeyDown={(event) => {
													if (event.key === "Enter") {
														event.preventDefault();
														confirmationRef.current?.focus();
													}
												}}
											/>
											{field.errors[0] && (
												<small role="alert" id="new-password-error" className="ui-field-error">
													{field.errors[0].message}
												</small>
											)}
										</label>
									)}
								</form.Field>
								<form.Field name="confirmation">
									{(field) => (
										<label className="ui-field-label">
											<span>
												{t(kernelMessage("client.route.reset-password.confirm-password"))}
											</span>
											<input
												type="password"
												name={field.name}
												value={field.value}
												ref={confirmationRef}
												disabled={isSubmitting}
												onBlur={field.handleBlur}
												className="ui-field-input"
												autoComplete="new-password"
												placeholder={t(
													kernelMessage("client.route.reset-password.confirm-password"),
												)}
												onChange={(event) => {
													field.handleChange(event.currentTarget.value);
													setServerError(undefined);
												}}
											/>
										</label>
									)}
								</form.Field>
							</>
						)}
					</form.Subscribe>
					{serverError && (
						<p role="alert" className="ui-field-error">
							{t(serverError)}
						</p>
					)}
					<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
						{([canSubmit, isSubmitting]) => (
							<Button type="submit" variant="primary" className="w-full" disabled={!canSubmit}>
								{isSubmitting
									? t(kernelMessage("client.route.reset-password.updating"))
									: t(kernelMessage("client.route.reset-password.update"))}
							</Button>
						)}
					</form.Subscribe>
				</form>
			</section>
		</ResetPasswordFrame>
	);
}
