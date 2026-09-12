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
	| { readonly kind: "confirm"; readonly action: "regenerate" | "disable" }
	| { readonly kind: "backup-codes"; readonly message: string; readonly codes: readonly string[] };

const errorVisibility = createErrorVisibility(
	({ state, fieldState }) => fieldState.meta.isBlurred || state.submissionAttempts > 0,
);

const confirmActions = {
	regenerate: {
		pending: "Generating...",
		submit: "Generate new codes",
		subtitle: "Replace your backup codes? Your current codes will stop working.",
	},
	disable: {
		pending: "Turning off...",
		submit: "Turn off two-factor authentication",
		subtitle: "Turn off two-factor authentication for your account?",
	},
} as const;

const BACKUP_CODES_NOTICE =
	"Save these backup codes somewhere safe. Each code works once, and they will not be shown again.";

export function TwoFactorManagement(props: {
	readonly enabled: boolean;
	// The password from this page's sign-in, so Better Auth's password checks do not prompt again.
	readonly password: string;
	readonly onDone: () => void;
	readonly actions: TwoFactorActions;
}) {
	const [view, setView] = useState<ManagementView>({ kind: "overview" });

	function startEnrollment() {
		return props.actions.enableTwoFactor(props.password).pipe(
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

	function confirmAction(action: "regenerate" | "disable") {
		if (action === "disable") {
			return props.actions.disableTwoFactor(props.password).pipe(
				Effect.match({
					onFailure: (error) => error.message,
					onSuccess: () => {
						setView({ kind: "turned-off" });
						return undefined;
					},
				}),
			);
		}
		return props.actions.regenerateBackupCodes(props.password).pipe(
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
				<TotpCodeForm onSubmit={(code) => confirmEnrollment(view.enrollment, code)} />
				<Button type="button" variant="text" onClick={() => setView({ kind: "overview" })}>
					Cancel
				</Button>
			</ManagementPanel>
		);
	}
	if (view.kind === "confirm") {
		const content = confirmActions[view.action];
		return (
			<ManagementPanel subtitle={content.subtitle}>
				<ActionButton
					submit={content.submit}
					pending={content.pending}
					onSubmit={() => confirmAction(view.action)}
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
					onClick={() => setView({ kind: "confirm", action: "regenerate" })}
				>
					Regenerate backup codes
				</Button>
				<Button
					type="button"
					variant="secondary"
					onClick={() => setView({ kind: "confirm", action: "disable" })}
				>
					Disable two-factor authentication
				</Button>
				{doneButton}
			</ManagementPanel>
		);
	}
	return (
		<ManagementPanel subtitle="Two-factor authentication is off.">
			<ActionButton
				onSubmit={startEnrollment}
				pending="Starting setup..."
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

function ActionButton(props: {
	readonly submit: string;
	readonly pending: string;
	readonly onSubmit: () => Effect.Effect<string | undefined>;
}) {
	const [pending, setPending] = useState(false);
	const [serverError, setServerError] = useState<string>();
	const controller = useRef(new AbortController());
	useEffect(() => () => controller.current.abort(), []);

	function run() {
		setPending(true);
		setServerError(undefined);
		void Effect.runPromiseExit(
			props.onSubmit().pipe(
				Effect.map((error) => setServerError(error)),
				Effect.ensuring(Effect.sync(() => setPending(false))),
			),
			{ signal: controller.current.signal },
		);
	}

	return (
		<div className="ui-stack">
			{serverError && (
				<p role="alert" className="ui-field-error">
					{serverError}
				</p>
			)}
			<Button type="button" onClick={run} variant="primary" className="w-full" disabled={pending}>
				{pending ? props.pending : props.submit}
			</Button>
		</div>
	);
}

function TotpCodeForm(props: {
	readonly onSubmit: (code: string) => Effect.Effect<string | undefined>;
}) {
	const [serverError, setServerError] = useState<string>();
	const controller = useRef(new AbortController());
	useEffect(() => () => controller.current.abort(), []);
	const form = useForm({
		errorVisibility,
		defaultValues: { value: "" },
		onSubmit: ({ value }) => {
			setServerError(undefined);
			return Effect.runPromiseExit(
				props.onSubmit(value.value.trim()).pipe(Effect.map((error) => setServerError(error))),
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
						run: ({ value }) =>
							value.trim() === "" ? "Enter the code from your authenticator app." : undefined,
					},
				]}
			>
				{(field) => (
					<label className="ui-field-label">
						<span>Authenticator code</span>
						<input
							autoFocus
							name="code"
							value={field.value}
							inputMode="numeric"
							autoCapitalize="none"
							onBlur={field.handleBlur}
							className="ui-field-input"
							autoComplete="one-time-code"
							aria-invalid={field.errors.length > 0}
							aria-describedby={field.errors.length > 0 ? "code-error" : undefined}
							onChange={(event) => {
								field.handleChange(event.currentTarget.value);
								setServerError(undefined);
							}}
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
					{serverError}
				</p>
			)}
			<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
				{([canSubmit, isSubmitting]) => (
					<Button type="submit" variant="primary" className="w-full" disabled={!canSubmit}>
						{isSubmitting ? "Verifying..." : "Turn on two-factor authentication"}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}
