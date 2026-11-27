import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { createErrorVisibility, useForm } from "@tanstack/react-form";
import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";

import type { AuthMode, TwoFactorMethod } from "#/modules/auth/flow";
import {
	type CredentialsValues,
	normalizeCredentials,
	validateEmail,
	validatePassword,
} from "#/modules/auth/form-values";

const errorVisibility = createErrorVisibility(
	({ state, fieldState }) => fieldState.meta.isBlurred || state.submissionAttempts > 0,
);

const modeContent = {
	login: {
		action: kernelMessage("common.action.sign-in"),
		title: kernelMessage("client.auth.mode.login.title"),
		pending: kernelMessage("client.auth.mode.login.pending"),
		subtitle: kernelMessage("client.auth.mode.login.subtitle"),
	},
	signup: {
		title: kernelMessage("client.auth.mode.signup.title"),
		action: kernelMessage("client.auth.mode.signup.action"),
		pending: kernelMessage("client.auth.mode.signup.pending"),
		subtitle: kernelMessage("client.auth.mode.signup.subtitle"),
	},
} as const;

export function TwoFactorForm(props: {
	onBack: () => void;
	method: TwoFactorMethod;
	methods: readonly TwoFactorMethod[];
	onMethodChange: (method: TwoFactorMethod) => void;
	onSubmit: (code: string) => Effect.Effect<Message | undefined>;
}) {
	const t = useT();
	const [serverError, setServerError] = useState<Message>();
	const usingBackupCode = props.method === "backupCode";
	const controller = useRef(new AbortController());
	useEffect(() => () => controller.current.abort(), []);
	const form = useForm({
		errorVisibility,
		defaultValues: { code: "" },
		onSubmit: ({ value }) => {
			setServerError(undefined);
			return Effect.runPromiseExit(
				props.onSubmit(value.code.trim()).pipe(
					Effect.map((error) => {
						setServerError(error);
						if (error) {
							form.reset();
						}
						return undefined;
					}),
				),
				{ signal: controller.current.signal },
			);
		},
	});

	function changeMethod() {
		form.reset();
		setServerError(undefined);
		props.onMethodChange(usingBackupCode ? "totp" : "backupCode");
	}

	return (
		<div className="ui-stack">
			<div>
				<h1 id="auth-title" className="ui-heading">
					{t(kernelMessage("client.auth.two-factor.title"))}
				</h1>
				<p className="ui-subtitle">
					{t(
						usingBackupCode
							? kernelMessage("client.auth.two-factor.backup-prompt")
							: kernelMessage("client.auth.two-factor.totp-prompt"),
					)}
				</p>
			</div>
			<form
				noValidate
				className="ui-stack"
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
								value.trim() === ""
									? t(kernelMessage("client.auth.two-factor.code-required"))
									: undefined,
						},
					]}
				>
					{(field) => (
						<label className="ui-field-label">
							<span>
								{t(
									usingBackupCode
										? kernelMessage("client.auth.two-factor.backup-code")
										: kernelMessage("client.auth.two-factor.authenticator-code"),
								)}
							</span>
							<input
								autoFocus
								name={field.name}
								value={field.value}
								autoCapitalize="none"
								onBlur={field.handleBlur}
								className="ui-field-input"
								autoComplete="one-time-code"
								aria-invalid={field.errors.length > 0}
								maxLength={usingBackupCode ? undefined : 6}
								inputMode={usingBackupCode ? "text" : "numeric"}
								aria-describedby={field.errors.length > 0 ? "code-error" : undefined}
								onChange={(event) => {
									field.handleChange(event.currentTarget.value);
									setServerError(undefined);
								}}
								placeholder={
									usingBackupCode
										? t(kernelMessage("client.auth.two-factor.backup-code"))
										: "000000"
								}
							/>
							{field.errors[0] && (
								<small role="alert" id="code-error" className="ui-field-error">
									{field.errors[0].message}
								</small>
							)}
						</label>
					)}
				</form.Field>
				{serverError && (
					<p role="alert" className="ui-field-error">
						{t(serverError)}
					</p>
				)}
				<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
					{([canSubmit, isSubmitting]) => (
						<>
							<Button type="submit" variant="primary" className="w-full" disabled={!canSubmit}>
								{t(
									isSubmitting
										? kernelMessage("client.auth.two-factor.verifying")
										: kernelMessage("client.auth.two-factor.verify"),
								)}
							</Button>
							{props.methods.length > 1 && (
								<Button
									type="button"
									variant="ghost"
									onClick={changeMethod}
									disabled={isSubmitting}
								>
									{t(
										usingBackupCode
											? kernelMessage("client.auth.two-factor.use-authenticator")
											: kernelMessage("client.auth.two-factor.use-backup"),
									)}
								</Button>
							)}
							<Button type="button" variant="ghost" onClick={props.onBack} disabled={isSubmitting}>
								{t(kernelMessage("client.auth.back-to-sign-in"))}
							</Button>
						</>
					)}
				</form.Subscribe>
			</form>
		</div>
	);
}

export function CredentialsForm(props: {
	mode: AuthMode;
	disabled: boolean;
	signupAllowed: boolean;
	onModeChange: (mode: AuthMode) => void;
	onSubmit: (values: CredentialsValues) => Effect.Effect<Message | undefined>;
}) {
	const t = useT();
	const passwordRef = useRef<HTMLInputElement>(null);
	const [serverError, setServerError] = useState<Message>();
	const content = modeContent[props.mode];
	const controller = useRef(new AbortController());
	useEffect(() => () => controller.current.abort(), []);
	const form = useForm({
		errorVisibility,
		defaultValues: { email: "", password: "" },
		onSubmit: ({ value }) => {
			setServerError(undefined);
			return Effect.runPromiseExit(
				props
					.onSubmit(normalizeCredentials(value))
					.pipe(Effect.map((submissionError) => setServerError(submissionError))),
				{ signal: controller.current.signal },
			);
		},
	});

	function changeMode(mode: AuthMode) {
		form.reset({ password: "", email: form.state.values.email });
		setServerError(undefined);
		props.onModeChange(mode);
	}

	return (
		<div className="ui-stack">
			<div>
				<h1 id="auth-title" className="ui-heading">
					{t(content.title)}
				</h1>
				<p className="ui-subtitle">{t(content.subtitle)}</p>
			</div>
			{props.signupAllowed && (
				<div
					role="group"
					aria-label={t(kernelMessage("client.auth.mode.label"))}
					className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1"
				>
					<Button
						type="button"
						variant="switch"
						disabled={props.disabled}
						onClick={() => changeMode("login")}
						aria-pressed={props.mode === "login"}
					>
						{t(kernelMessage("common.action.sign-in"))}
					</Button>
					<Button
						type="button"
						variant="switch"
						disabled={props.disabled}
						onClick={() => changeMode("signup")}
						aria-pressed={props.mode === "signup"}
					>
						{t(kernelMessage("client.auth.mode.signup.tab"))}
					</Button>
				</div>
			)}
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
								name="email"
								validators={[
									{
										runOnMount: true,
										triggers: ["change", "blur"],
										run: ({ value }) => validateEmail(t, value),
									},
								]}
							>
								{(field) => (
									<label className="ui-field-label">
										<span>{t(kernelMessage("client.auth.email"))}</span>
										<input
											autoFocus
											type="email"
											name={field.name}
											value={field.value}
											autoComplete="email"
											autoCapitalize="none"
											onBlur={field.handleBlur}
											className="ui-field-input"
											aria-invalid={field.errors.length > 0}
											disabled={props.disabled || isSubmitting}
											placeholder={t(kernelMessage("client.auth.email-placeholder"))}
											aria-describedby={field.errors.length > 0 ? "email-error" : undefined}
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
											<small role="alert" id="email-error" className="ui-field-error">
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
										run: ({ value }) => validatePassword(t, value),
									},
								]}
							>
								{(field) => (
									<label className="ui-field-label">
										<span>{t(kernelMessage("client.auth.password"))}</span>
										<input
											type="password"
											ref={passwordRef}
											name={field.name}
											value={field.value}
											onBlur={field.handleBlur}
											className="ui-field-input"
											aria-invalid={field.errors.length > 0}
											disabled={props.disabled || isSubmitting}
											placeholder={t(kernelMessage("client.auth.password"))}
											aria-describedby={field.errors.length > 0 ? "password-error" : undefined}
											autoComplete={props.mode === "login" ? "current-password" : "new-password"}
											onChange={(event) => {
												field.handleChange(event.currentTarget.value);
												setServerError(undefined);
											}}
										/>
										{field.errors[0] && (
											<small role="alert" id="password-error" className="ui-field-error">
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
					<p role="alert" className="ui-field-error">
						{t(serverError)}
					</p>
				)}
				<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
					{([canSubmit, isSubmitting]) => (
						<Button
							type="submit"
							variant="primary"
							className="w-full"
							disabled={props.disabled || !canSubmit}
						>
							{t(isSubmitting ? content.pending : content.action)}
						</Button>
					)}
				</form.Subscribe>
			</form>
		</div>
	);
}
