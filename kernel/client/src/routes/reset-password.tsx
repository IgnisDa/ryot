import { Button } from "@ryot-app/client-ui-sdk";
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
	({ fieldState, state }) => fieldState.meta.isBlurred || state.submissionAttempts > 0,
);

export const Route = createFileRoute("/reset-password")({
	component: ResetPassword,
	validateSearch: (search) => ({
		token: typeof search.token === "string" && search.token !== "" ? search.token : undefined,
	}),
	beforeLoad: ({ context, search }) => {
		if (search.token === undefined) {
			return { server: null };
		}
		const server = context.runtime.runSync(
			Effect.flatMap(ServerService, (service) => service.selected),
		);
		if (server === null) {
			// oxlint-disable-next-line typescript/only-throw-error
			throw redirect({
				replace: true,
				to: "/onboarding",
				search: { redirect: `/reset-password?token=${encodeURIComponent(search.token)}` },
			});
		}
		return { server };
	},
});

function ResetPassword() {
	const { token } = Route.useSearch();
	const navigate = Route.useNavigate();
	const { runtime, server } = Route.useRouteContext();

	if (token === undefined) {
		return (
			<AuthStatus
				title="Invalid reset link"
				message="This password reset link is missing its token. Ask your administrator for a new link."
				actions={
					<Button
						type="button"
						variant="primary"
						className="w-full"
						onClick={() =>
							void navigate({ replace: true, to: "/auth", search: { redirect: undefined } })
						}
					>
						Back to sign in
					</Button>
				}
			/>
		);
	}

	if (server === null) {
		return null;
	}

	return <ResetPasswordForm runtime={runtime} server={server} token={token} />;
}

function ResetPasswordForm(props: {
	readonly token: string;
	readonly server: ServerOrigin;
	readonly runtime: ClientRuntime;
}) {
	const navigate = Route.useNavigate();
	const auth = props.runtime.runSync(HostedAuthService);
	const confirmationRef = useRef<HTMLInputElement>(null);
	const controller = useRef(new AbortController());
	const [done, setDone] = useState(false);
	const [serverError, setServerError] = useState<string>();
	useEffect(() => () => controller.current.abort(), []);

	const form = useForm({
		errorVisibility,
		defaultValues: { password: "", confirmation: "" },
		onSubmit: async ({ value }) => {
			setServerError(undefined);
			if (value.password !== value.confirmation) {
				setServerError("Passwords do not match.");
				return;
			}
			let error;
			try {
				error = await props.runtime.runPromise(
					auth
						.resetPassword(props.server, props.token, value.password)
						.pipe(Effect.match({ onSuccess: () => undefined, onFailure: (failure) => failure })),
					{ signal: controller.current.signal },
				);
			} catch {
				return;
			}
			if (error) {
				setServerError(
					error.code === "INVALID_TOKEN"
						? "This password reset link is invalid or has expired."
						: "Could not reset your password.",
				);
				return;
			}
			setDone(true);
		},
	});

	if (done) {
		return (
			<AuthStatus
				title="Password updated"
				message="Sign in with your new password to continue."
				actions={
					<Button
						type="button"
						variant="primary"
						className="w-full"
						onClick={() =>
							void navigate({ replace: true, to: "/auth", search: { redirect: undefined } })
						}
					>
						Sign in
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
					<h1 id="reset-password-title" className="ui-heading">
						Choose a new password
					</h1>
					<p className="ui-subtitle">Use at least 8 characters.</p>
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
											run: ({ value }) => validatePassword(value),
										},
									]}
								>
									{(field) => (
										<label className="ui-field-label">
											<span>New password</span>
											<input
												autoFocus
												type="password"
												name={field.name}
												value={field.value}
												disabled={isSubmitting}
												onBlur={field.handleBlur}
												placeholder="New password"
												className="ui-field-input"
												autoComplete="new-password"
												aria-invalid={field.errors.length > 0}
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
												<small id="new-password-error" role="alert" className="ui-field-error">
													{field.errors[0].message}
												</small>
											)}
										</label>
									)}
								</form.Field>
								<form.Field name="confirmation">
									{(field) => (
										<label className="ui-field-label">
											<span>Confirm password</span>
											<input
												type="password"
												name={field.name}
												value={field.value}
												ref={confirmationRef}
												disabled={isSubmitting}
												onBlur={field.handleBlur}
												className="ui-field-input"
												autoComplete="new-password"
												placeholder="Confirm password"
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
							{serverError}
						</p>
					)}
					<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
						{([canSubmit, isSubmitting]) => (
							<Button type="submit" variant="primary" className="w-full" disabled={!canSubmit}>
								{isSubmitting ? "Updating..." : "Update password"}
							</Button>
						)}
					</form.Subscribe>
				</form>
			</section>
		</ResetPasswordFrame>
	);
}

function ResetPasswordFrame(props: { readonly children: ReactNode }) {
	usePageTitle("Choose a new password");
	return (
		<main {...mainContentProps} className="ui-page">
			{props.children}
		</main>
	);
}
