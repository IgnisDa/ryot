import { createErrorVisibility, useForm } from "@tanstack/react-form";
import { useRef, useState } from "react";

import type { AuthMode, TwoFactorMethod } from "./flow";
import {
	type CredentialsValues,
	normalizeCredentials,
	validateEmail,
	validatePassword,
} from "./form-values";

const errorVisibility = createErrorVisibility(
	({ fieldState, state }) => fieldState.meta.isBlurred || state.submissionAttempts > 0,
);

const modeContent = {
	login: {
		action: "Sign in",
		title: "Welcome back",
		pending: "Signing in...",
		subtitle: "Pick up where you left off.",
	},
	signup: {
		title: "Make it yours",
		action: "Create account",
		pending: "Creating account...",
		subtitle: "Start a library shaped around you.",
	},
} as const;

export function CredentialsForm(props: {
	mode: AuthMode;
	disabled: boolean;
	signupAllowed: boolean;
	onModeChange: (mode: AuthMode) => void;
	onSubmit: (values: CredentialsValues) => Promise<string | undefined>;
}) {
	const passwordRef = useRef<HTMLInputElement>(null);
	const [serverError, setServerError] = useState<string>();
	const content = modeContent[props.mode];
	const form = useForm({
		errorVisibility,
		defaultValues: { email: "", password: "" },
		onSubmit: async ({ value }) => {
			setServerError(undefined);
			setServerError(await props.onSubmit(normalizeCredentials(value)));
		},
	});

	function changeMode(mode: AuthMode) {
		form.reset({ email: form.state.values.email, password: "" });
		setServerError(undefined);
		props.onModeChange(mode);
	}

	return (
		<div className="grid gap-4.5">
			<div>
				<h1
					id="auth-title"
					className="font-display text-[clamp(30px,7vw,42px)] leading-[1.18] font-semibold tracking-tight"
				>
					{content.title}
				</h1>
				<p className="mt-3 text-text-muted">{content.subtitle}</p>
			</div>
			{props.signupAllowed && (
				<div
					role="group"
					aria-label="Authentication mode"
					className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1"
				>
					<button
						type="button"
						disabled={props.disabled}
						onClick={() => changeMode("login")}
						aria-pressed={props.mode === "login"}
						className="min-h-9.5 cursor-pointer rounded-md font-semibold text-text-muted aria-pressed:bg-raised aria-pressed:text-text aria-pressed:shadow-sm"
					>
						Sign in
					</button>
					<button
						type="button"
						disabled={props.disabled}
						onClick={() => changeMode("signup")}
						aria-pressed={props.mode === "signup"}
						className="min-h-9.5 cursor-pointer rounded-md font-semibold text-text-muted aria-pressed:bg-raised aria-pressed:text-text aria-pressed:shadow-sm"
					>
						Sign up
					</button>
				</div>
			)}
			<form
				noValidate
				className="grid gap-4.5"
				onSubmit={(event) => {
					event.preventDefault();
					void form.handleSubmit();
				}}
			>
				<form.Subscribe selector={(state) => state.isSubmitting}>
					{(isSubmitting) => (
						<>
							<form.Field
								name="email"
								validators={[
									{
										runOnMount: true,
										triggers: ["change", "blur"],
										run: ({ value }) => validateEmail(value),
									},
								]}
							>
								{(field) => (
									<label className="grid gap-1.5 text-[13px] font-semibold text-text-muted">
										<span>Email address</span>
										<input
											autoFocus
											type="email"
											name={field.name}
											value={field.value}
											autoComplete="email"
											autoCapitalize="none"
											placeholder="you@example.com"
											className="min-h-12 w-full rounded-lg border border-border-strong bg-raised px-3.5 py-2.75 text-text aria-invalid:border-danger"
											aria-invalid={field.errors.length > 0}
											disabled={props.disabled || isSubmitting}
											aria-describedby={field.errors.length > 0 ? "email-error" : undefined}
											onBlur={field.handleBlur}
											onChange={(event) => {
												field.handleChange(event.currentTarget.value);
												setServerError(undefined);
											}}
											onKeyDown={(event) => {
												if (event.key === "Enter") {
													event.preventDefault();
													passwordRef.current?.focus();
												}
											}}
										/>
										{field.errors[0] && (
											<small
												id="email-error"
												role="alert"
												className="text-sm font-normal text-danger"
											>
												{field.errors[0].message}
											</small>
										)}
									</label>
								)}
							</form.Field>
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
									<label className="grid gap-1.5 text-[13px] font-semibold text-text-muted">
										<span>Password</span>
										<input
											type="password"
											ref={passwordRef}
											name={field.name}
											value={field.value}
											placeholder="Password"
											onBlur={field.handleBlur}
											className="min-h-12 w-full rounded-lg border border-border-strong bg-raised px-3.5 py-2.75 text-text aria-invalid:border-danger"
											aria-invalid={field.errors.length > 0}
											disabled={props.disabled || isSubmitting}
											aria-describedby={field.errors.length > 0 ? "password-error" : undefined}
											autoComplete={props.mode === "login" ? "current-password" : "new-password"}
											onChange={(event) => {
												field.handleChange(event.currentTarget.value);
												setServerError(undefined);
											}}
										/>
										{field.errors[0] && (
											<small
												id="password-error"
												role="alert"
												className="text-sm font-normal text-danger"
											>
												{field.errors[0].message}
											</small>
										)}
									</label>
								)}
							</form.Field>
						</>
					)}
				</form.Subscribe>
				{serverError && (
					<p className="text-sm font-normal text-danger" role="alert">
						{serverError}
					</p>
				)}
				<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
					{([canSubmit, isSubmitting]) => (
						<button
							type="submit"
							className="min-h-11 w-full cursor-pointer rounded-lg border border-accent bg-accent px-4 py-2.5 font-semibold text-accent-ink"
							disabled={props.disabled || !canSubmit}
						>
							{isSubmitting ? content.pending : content.action}
						</button>
					)}
				</form.Subscribe>
			</form>
		</div>
	);
}

export function TwoFactorForm(props: {
	onBack: () => void;
	method: TwoFactorMethod;
	methods: readonly TwoFactorMethod[];
	onMethodChange: (method: TwoFactorMethod) => void;
	onSubmit: (code: string) => Promise<string | undefined>;
}) {
	const [serverError, setServerError] = useState<string>();
	const usingBackupCode = props.method === "backupCode";
	const form = useForm({
		errorVisibility,
		defaultValues: { code: "" },
		onSubmit: async ({ value }) => {
			setServerError(undefined);
			const error = await props.onSubmit(value.code.trim());
			setServerError(error);
			if (error) {
				form.reset();
			}
		},
	});

	function changeMethod() {
		form.reset();
		setServerError(undefined);
		props.onMethodChange(usingBackupCode ? "totp" : "backupCode");
	}

	return (
		<div className="grid gap-4.5">
			<div>
				<h1
					id="auth-title"
					className="font-display text-[clamp(30px,7vw,42px)] leading-[1.18] font-semibold tracking-tight"
				>
					One more step
				</h1>
				<p className="mt-3 text-text-muted">
					{usingBackupCode
						? "Enter one of your saved backup codes."
						: "Enter the 6-digit code from your authenticator app."}
				</p>
			</div>
			<form
				noValidate
				className="grid gap-4.5"
				onSubmit={(event) => {
					event.preventDefault();
					void form.handleSubmit();
				}}
			>
				<form.Field
					name="code"
					validators={[
						{
							runOnMount: true,
							triggers: ["change", "blur"],
							run: ({ value }) =>
								value.trim() === "" ? "Enter your two-factor authentication code." : undefined,
						},
					]}
				>
					{(field) => (
						<label className="grid gap-1.5 text-[13px] font-semibold text-text-muted">
							<span>{usingBackupCode ? "Backup code" : "Authenticator code"}</span>
							<input
								autoFocus
								name={field.name}
								value={field.value}
								autoCapitalize="none"
								onBlur={field.handleBlur}
								autoComplete="one-time-code"
								aria-invalid={field.errors.length > 0}
								maxLength={usingBackupCode ? undefined : 6}
								inputMode={usingBackupCode ? "text" : "numeric"}
								placeholder={usingBackupCode ? "Backup code" : "000000"}
								className="min-h-12 w-full rounded-lg border border-border-strong bg-raised px-3.5 py-2.75 text-text aria-invalid:border-danger"
								aria-describedby={field.errors.length > 0 ? "code-error" : undefined}
								onChange={(event) => {
									field.handleChange(event.currentTarget.value);
									setServerError(undefined);
								}}
							/>
							{field.errors[0] && (
								<small id="code-error" role="alert" className="text-sm font-normal text-danger">
									{field.errors[0].message}
								</small>
							)}
						</label>
					)}
				</form.Field>
				{serverError && (
					<p className="text-sm font-normal text-danger" role="alert">
						{serverError}
					</p>
				)}
				<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
					{([canSubmit, isSubmitting]) => (
						<>
							<button
								className="min-h-11 w-full cursor-pointer rounded-lg border border-accent bg-accent px-4 py-2.5 font-semibold text-accent-ink"
								type="submit"
								disabled={!canSubmit}
							>
								{isSubmitting ? "Verifying..." : "Verify"}
							</button>
							{props.methods.length > 1 && (
								<button
									type="button"
									onClick={changeMethod}
									disabled={isSubmitting}
									className="min-h-10 cursor-pointer font-semibold text-text-muted"
								>
									{usingBackupCode ? "Use an authenticator code" : "Use a backup code"}
								</button>
							)}
							<button
								type="button"
								onClick={props.onBack}
								disabled={isSubmitting}
								className="min-h-10 cursor-pointer font-semibold text-text-muted"
							>
								Back to sign in
							</button>
						</>
					)}
				</form.Subscribe>
			</form>
		</div>
	);
}
