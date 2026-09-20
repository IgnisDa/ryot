import { Button } from "@ryot-app/client-ui-sdk";
import { createErrorVisibility, useForm } from "@tanstack/react-form";
import { Effect } from "effect";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { renderSVG } from "uqr";

import type { HostedAuthService } from "#/modules/auth/hosted-service";

type TwoFactorActions = Pick<
	HostedAuthService["Service"],
	"enableTwoFactor" | "confirmTwoFactor" | "disableTwoFactor" | "regenerateBackupCodes"
>;

type TwoFactorEnrollment = Effect.Success<ReturnType<TwoFactorActions["enableTwoFactor"]>>;

type ManagementView =
	| { readonly kind: "overview" }
	| { readonly kind: "turned-off" }
	| { readonly kind: "enroll"; readonly enrollment: TwoFactorEnrollment }
	| { readonly kind: "confirm-password"; readonly action: "regenerate" | "disable" }
	| { readonly kind: "backup-codes"; readonly message: string; readonly codes: readonly string[] };

const errorVisibility = createErrorVisibility(
	({ state, fieldState }) => fieldState.meta.isBlurred || state.submissionAttempts > 0,
);

const passwordActions = {
	disable: {
		pending: "Turning off...",
		submit: "Turn off two-factor authentication",
		subtitle: "Confirm your password to turn off two-factor authentication.",
	},
	regenerate: {
		pending: "Generating...",
		submit: "Generate new codes",
		subtitle:
			"Confirm your password to replace your backup codes. Your current codes will stop working.",
	},
} as const;

const BACKUP_CODES_NOTICE =
	"Save these backup codes somewhere safe. Each code works once, and they will not be shown again.";

export function TwoFactorManagement(props: {
	readonly enabled: boolean;
	readonly onDone: () => void;
	readonly actions: TwoFactorActions;
}) {
	const [view, setView] = useState<ManagementView>({ kind: "overview" });

	function startEnrollment(password: string) {
		return props.actions.enableTwoFactor(password).pipe(
			Effect.match({
				onFailure: (error) => error.message,
				onSuccess: (enrollment) => {
					setView({ enrollment, kind: "enroll" });
					return undefined;
				},
			}),
		);
	}

	function confirmEnrollment(enrollment: TwoFactorEnrollment, code: string) {
		return props.actions.confirmTwoFactor(code).pipe(
			Effect.match({
				onFailure: (error) => error.message,
				onSuccess: () => {
					setView({
						kind: "backup-codes",
						codes: enrollment.backupCodes,
						message: `Two-factor authentication is on. ${BACKUP_CODES_NOTICE}`,
					});
					return undefined;
				},
			}),
		);
	}

	function confirmPassword(action: "regenerate" | "disable", password: string) {
		if (action === "disable") {
			return props.actions.disableTwoFactor(password).pipe(
				Effect.match({
					onFailure: (error) => error.message,
					onSuccess: () => {
						setView({ kind: "turned-off" });
						return undefined;
					},
				}),
			);
		}
		return props.actions.regenerateBackupCodes(password).pipe(
			Effect.match({
				onFailure: (error) => error.message,
				onSuccess: (codes) => {
					setView({
						codes,
						kind: "backup-codes",
						message: `New backup codes generated. ${BACKUP_CODES_NOTICE}`,
					});
					return undefined;
				},
			}),
		);
	}

	const doneButton = (
		<Button type="button" variant="text" onClick={props.onDone}>
			Done
		</Button>
	);

	if (view.kind === "enroll") {
		return (
			<ManagementPanel subtitle="Scan this QR code with your authenticator app, then enter the 6-digit code it shows.">
				<TotpEnrollmentDetails enrollment={view.enrollment} />
				<SingleFieldForm
					name="code"
					inputMode="numeric"
					pending="Verifying..."
					label="Authenticator code"
					autoComplete="one-time-code"
					submit="Turn on two-factor authentication"
					required="Enter the code from your authenticator app."
					onSubmit={(code) => confirmEnrollment(view.enrollment, code)}
				/>
				<Button type="button" variant="text" onClick={() => setView({ kind: "overview" })}>
					Cancel
				</Button>
			</ManagementPanel>
		);
	}
	if (view.kind === "confirm-password") {
		const content = passwordActions[view.action];
		return (
			<ManagementPanel subtitle={content.subtitle}>
				<SingleFieldForm
					type="password"
					name="password"
					label="Password"
					submit={content.submit}
					pending={content.pending}
					autoComplete="current-password"
					required="Enter your password."
					onSubmit={(password) => confirmPassword(view.action, password)}
				/>
				<Button type="button" variant="text" onClick={() => setView({ kind: "overview" })}>
					Cancel
				</Button>
			</ManagementPanel>
		);
	}
	if (view.kind === "backup-codes") {
		return (
			<ManagementPanel subtitle={view.message}>
				<ul
					aria-label="Backup codes"
					className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface-2 p-3"
				>
					{view.codes.map((code) => (
						<li key={code}>
							<code className="font-mono text-sm text-text">{code}</code>
						</li>
					))}
				</ul>
				<Button type="button" variant="primary" className="w-full" onClick={props.onDone}>
					Done
				</Button>
			</ManagementPanel>
		);
	}
	if (view.kind === "turned-off") {
		return (
			<ManagementPanel subtitle="Two-factor authentication is off.">
				<Button type="button" variant="primary" className="w-full" onClick={props.onDone}>
					Done
				</Button>
			</ManagementPanel>
		);
	}
	if (props.enabled) {
		return (
			<ManagementPanel subtitle="Two-factor authentication is on.">
				<Button
					type="button"
					variant="secondary"
					onClick={() => setView({ action: "regenerate", kind: "confirm-password" })}
				>
					Regenerate backup codes
				</Button>
				<Button
					type="button"
					variant="secondary"
					onClick={() => setView({ action: "disable", kind: "confirm-password" })}
				>
					Disable two-factor authentication
				</Button>
				{doneButton}
			</ManagementPanel>
		);
	}
	return (
		<ManagementPanel subtitle="Two-factor authentication is off. Confirm your password to set up an authenticator app.">
			<SingleFieldForm
				type="password"
				name="password"
				label="Password"
				onSubmit={startEnrollment}
				pending="Starting setup..."
				autoComplete="current-password"
				required="Enter your password."
				submit="Set up authenticator app"
			/>
			{doneButton}
		</ManagementPanel>
	);
}

function ManagementPanel(props: { readonly subtitle: string; readonly children: ReactNode }) {
	return (
		<div className="ui-stack">
			<div>
				<h1 id="auth-title" className="ui-heading">
					Two-factor authentication
				</h1>
				<p className="ui-subtitle">{props.subtitle}</p>
			</div>
			{props.children}
		</div>
	);
}

function TotpEnrollmentDetails(props: { readonly enrollment: TwoFactorEnrollment }) {
	const qrCode = useMemo(
		() => `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(props.enrollment.totpURI))}`,
		[props.enrollment.totpURI],
	);
	return (
		<div className="ui-stack items-center">
			<img
				width={192}
				height={192}
				src={qrCode}
				className="rounded-lg"
				alt="QR code for your authenticator app"
			/>
			<p className="text-sm text-text-muted">Can't scan it? Enter this setup key instead:</p>
			<code aria-label="Setup key" className="font-mono text-sm break-all text-text">
				{props.enrollment.secret}
			</code>
			<a href={props.enrollment.totpURI} className="text-sm font-semibold text-accent-text">
				Open in authenticator app
			</a>
		</div>
	);
}

function SingleFieldForm(props: {
	readonly name: string;
	readonly label: string;
	readonly submit: string;
	readonly pending: string;
	readonly required: string;
	readonly autoComplete: string;
	readonly type?: "password";
	readonly inputMode?: "numeric";
	readonly onSubmit: (value: string) => Effect.Effect<string | undefined>;
}) {
	const [serverError, setServerError] = useState<string>();
	const controller = useRef(new AbortController());
	useEffect(() => () => controller.current.abort(), []);
	const errorId = `${props.name}-error`;
	const form = useForm({
		errorVisibility,
		defaultValues: { value: "" },
		onSubmit: ({ value }) => {
			setServerError(undefined);
			return Effect.runPromiseExit(
				props
					.onSubmit(props.type === "password" ? value.value : value.value.trim())
					.pipe(Effect.map((error) => setServerError(error))),
				{ signal: controller.current.signal },
			);
		},
	});

	return (
		<form
			noValidate
			className="ui-stack"
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<form.Field
				name="value"
				validators={[
					{
						runOnMount: true,
						triggers: ["change", "blur"],
						run: ({ value }) => (value.trim() === "" ? props.required : undefined),
					},
				]}
			>
				{(field) => (
					<label className="ui-field-label">
						<span>{props.label}</span>
						<input
							autoFocus
							name={props.name}
							type={props.type}
							value={field.value}
							autoCapitalize="none"
							onBlur={field.handleBlur}
							className="ui-field-input"
							inputMode={props.inputMode}
							autoComplete={props.autoComplete}
							aria-invalid={field.errors.length > 0}
							aria-describedby={field.errors.length > 0 ? errorId : undefined}
							onChange={(event) => {
								field.handleChange(event.currentTarget.value);
								setServerError(undefined);
							}}
						/>
						{field.errors[0] && (
							<small role="alert" id={errorId} className="ui-field-error">
								{field.errors[0].message}
							</small>
						)}
					</label>
				)}
			</form.Field>
			{serverError && (
				<p role="alert" className="ui-field-error">
					{serverError}
				</p>
			)}
			<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
				{([canSubmit, isSubmitting]) => (
					<Button type="submit" variant="primary" className="w-full" disabled={!canSubmit}>
						{isSubmitting ? props.pending : props.submit}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}
