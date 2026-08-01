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
		<div className="stack">
			<div>
				<h1 id="auth-title" className="heading-display">
					{content.title}
				</h1>
				<p className="subtitle">{content.subtitle}</p>
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
						className="button-switch"
					>
						Sign in
					</button>
					<button
						type="button"
						disabled={props.disabled}
						onClick={() => changeMode("signup")}
						aria-pressed={props.mode === "signup"}
						className="button-switch"
					>
						Sign up
					</button>
				</div>
			)}
			<form
				noValidate
				className="stack"
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
									<label className="field-label">
										<span>Email address</span>
										<input
											autoFocus
											type="email"
											name={field.name}
											value={field.value}
											autoComplete="email"
											autoCapitalize="none"
											placeholder="you@example.com"
											className="field-input"
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
											<small id="email-error" role="alert" className="field-error">
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
									<label className="field-label">
										<span>Password</span>
										<input
											type="password"
											ref={passwordRef}
											name={field.name}
											value={field.value}
											placeholder="Password"
											onBlur={field.handleBlur}
											className="field-input"
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
											<small id="password-error" role="alert" className="field-error">
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
					<p className="field-error" role="alert">
						{serverError}
					</p>
				)}
				<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
					{([canSubmit, isSubmitting]) => (
						<button
							type="submit"
							className="button-primary w-full"
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
		<div className="stack">
			<div>
				<h1 id="auth-title" className="heading-display">
					One more step
				</h1>
				<p className="subtitle">
					{usingBackupCode
						? "Enter one of your saved backup codes."
						: "Enter the 6-digit code from your authenticator app."}
				</p>
			</div>
			<form
				noValidate
				className="stack"
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
						<label className="field-label">
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
								className="field-input"
								aria-describedby={field.errors.length > 0 ? "code-error" : undefined}
								onChange={(event) => {
									field.handleChange(event.currentTarget.value);
									setServerError(undefined);
								}}
							/>
							{field.errors[0] && (
								<small id="code-error" role="alert" className="field-error">
									{field.errors[0].message}
								</small>
							)}
						</label>
					)}
				</form.Field>
				{serverError && (
					<p className="field-error" role="alert">
						{serverError}
					</p>
				)}
				<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
					{([canSubmit, isSubmitting]) => (
						<>
							<button className="button-primary w-full" type="submit" disabled={!canSubmit}>
								{isSubmitting ? "Verifying..." : "Verify"}
							</button>
							{props.methods.length > 1 && (
								<button
									type="button"
									onClick={changeMethod}
									disabled={isSubmitting}
									className="button-text"
								>
									{usingBackupCode ? "Use an authenticator code" : "Use a backup code"}
								</button>
							)}
							<button
								type="button"
								onClick={props.onBack}
								disabled={isSubmitting}
								className="button-text"
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
