import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { createErrorVisibility, useForm } from "@tanstack/react-form";
import { Effect } from "effect";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { renderSVG } from "uqr";

import type { HostedAuthService } from "#/modules/auth/hosted-service";

type TwoFactorEnrollment = Effect.Success<ReturnType<TwoFactorActions["enableTwoFactor"]>>;

type TwoFactorActions = Pick<
	HostedAuthService["Service"],
	"enableTwoFactor" | "confirmTwoFactor" | "disableTwoFactor" | "regenerateBackupCodes"
>;

type ManagementView =
	| { readonly kind: "overview" }
	| { readonly kind: "turned-off" }
	| { readonly kind: "enroll"; readonly enrollment: TwoFactorEnrollment }
	| { readonly kind: "confirm"; readonly action: "disable" | "regenerate" }
	| { readonly message: Message; readonly kind: "backup-codes"; readonly codes: readonly string[] };

const errorVisibility = createErrorVisibility(
	({ state, fieldState }) => fieldState.meta.isBlurred || state.submissionAttempts > 0,
);

const confirmActions = {
	disable: {
		submit: kernelMessage("client.auth.management.disable.submit"),
		pending: kernelMessage("client.auth.management.disable.pending"),
		subtitle: kernelMessage("client.auth.management.disable.subtitle"),
	},
	regenerate: {
		submit: kernelMessage("client.auth.management.regenerate.submit"),
		pending: kernelMessage("client.auth.management.regenerate.pending"),
		subtitle: kernelMessage("client.auth.management.regenerate.subtitle"),
	},
} as const;

export function TwoFactorManagement(props: {
	readonly enabled: boolean;
	// The password from this page's sign-in, so Better Auth's password checks do not prompt again.
	readonly password: string;
	readonly onDone: () => void;
	readonly actions: TwoFactorActions;
}) {
	const t = useT();
	const [view, setView] = useState<ManagementView>({ kind: "overview" });

	function startEnrollment() {
		return props.actions.enableTwoFactor(props.password).pipe(
			Effect.match({
				onFailure: (error) => error.reason,
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
				onFailure: (error) => error.reason,
				onSuccess: () => {
					setView({
						kind: "backup-codes",
						codes: enrollment.backupCodes,
						message: kernelMessage("client.auth.management.codes-enabled"),
					});
					return undefined;
				},
			}),
		);
	}

	function confirmAction(action: "disable" | "regenerate") {
		if (action === "disable") {
			return props.actions.disableTwoFactor(props.password).pipe(
				Effect.match({
					onFailure: (error) => error.reason,
					onSuccess: () => {
						setView({ kind: "turned-off" });
						return undefined;
					},
				}),
			);
		}
		return props.actions.regenerateBackupCodes(props.password).pipe(
			Effect.match({
				onFailure: (error) => error.reason,
				onSuccess: (codes) => {
					setView({
						codes,
						kind: "backup-codes",
						message: kernelMessage("client.auth.management.codes-regenerated"),
					});
					return undefined;
				},
			}),
		);
	}

	const doneButton = (
		<Button type="button" variant="ghost" onClick={props.onDone}>
			{t(kernelMessage("common.action.done"))}
		</Button>
	);

	if (view.kind === "enroll") {
		return (
			<ManagementPanel subtitle={kernelMessage("client.auth.management.enroll-subtitle")}>
				<TotpEnrollmentDetails enrollment={view.enrollment} />
				<TotpCodeForm onSubmit={(code) => confirmEnrollment(view.enrollment, code)} />
				<Button type="button" variant="ghost" onClick={() => setView({ kind: "overview" })}>
					{t(kernelMessage("common.action.cancel"))}
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
				<Button type="button" variant="ghost" onClick={() => setView({ kind: "overview" })}>
					{t(kernelMessage("common.action.cancel"))}
				</Button>
			</ManagementPanel>
		);
	}
	if (view.kind === "backup-codes") {
		return (
			<ManagementPanel subtitle={view.message}>
				<ul
					aria-label={t(kernelMessage("client.auth.management.backup-codes-label"))}
					className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface-2 p-3"
				>
					{view.codes.map((code) => (
						<li key={code}>
							<code className="font-mono text-sm text-text">{code}</code>
						</li>
					))}
				</ul>
				<Button type="button" variant="primary" className="w-full" onClick={props.onDone}>
					{t(kernelMessage("common.action.done"))}
				</Button>
			</ManagementPanel>
		);
	}
	if (view.kind === "turned-off") {
		return (
			<ManagementPanel subtitle={kernelMessage("client.auth.management.off")}>
				<Button type="button" variant="primary" className="w-full" onClick={props.onDone}>
					{t(kernelMessage("common.action.done"))}
				</Button>
			</ManagementPanel>
		);
	}
	if (props.enabled) {
		return (
			<ManagementPanel subtitle={kernelMessage("client.auth.management.on")}>
				<Button
					type="button"
					variant="secondary"
					onClick={() => setView({ kind: "confirm", action: "regenerate" })}
				>
					{t(kernelMessage("client.auth.management.regenerate"))}
				</Button>
				<Button
					type="button"
					variant="secondary"
					onClick={() => setView({ kind: "confirm", action: "disable" })}
				>
					{t(kernelMessage("client.auth.management.disable"))}
				</Button>
				{doneButton}
			</ManagementPanel>
		);
	}
	return (
		<ManagementPanel subtitle={kernelMessage("client.auth.management.off")}>
			<ActionButton
				onSubmit={startEnrollment}
				submit={kernelMessage("client.auth.management.set-up")}
				pending={kernelMessage("client.auth.management.starting")}
			/>
			{doneButton}
		</ManagementPanel>
	);
}

function ManagementPanel(props: { readonly subtitle: Message; readonly children: ReactNode }) {
	const t = useT();
	return (
		<div className="ui-stack">
			<div>
				<h1 id="auth-title" className="ui-heading">
					{t(kernelMessage("client.settings.account.two-factor.title"))}
				</h1>
				<p className="ui-subtitle">{t(props.subtitle)}</p>
			</div>
			{props.children}
		</div>
	);
}

function TotpEnrollmentDetails(props: { readonly enrollment: TwoFactorEnrollment }) {
	const t = useT();
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
				alt={t(kernelMessage("client.auth.management.qr-alt"))}
			/>
			<p className="text-sm text-text-muted">
				{t(kernelMessage("client.auth.management.cant-scan"))}
			</p>
			<code
				className="font-mono text-sm break-all text-text"
				aria-label={t(kernelMessage("client.auth.management.setup-key"))}
			>
				{props.enrollment.secret}
			</code>
			<a href={props.enrollment.totpURI} className="text-sm font-semibold text-accent-text">
				{t(kernelMessage("client.auth.management.open-authenticator"))}
			</a>
		</div>
	);
}

function ActionButton(props: {
	readonly submit: Message;
	readonly pending: Message;
	readonly onSubmit: () => Effect.Effect<Message | undefined>;
}) {
	const t = useT();
	const [pending, setPending] = useState(false);
	const [serverError, setServerError] = useState<Message>();
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
					{t(serverError)}
				</p>
			)}
			<Button type="button" onClick={run} variant="primary" className="w-full" disabled={pending}>
				{t(pending ? props.pending : props.submit)}
			</Button>
		</div>
	);
}

function TotpCodeForm(props: {
	readonly onSubmit: (code: string) => Effect.Effect<Message | undefined>;
}) {
	const t = useT();
	const [serverError, setServerError] = useState<Message>();
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
							value.trim() === ""
								? t(kernelMessage("client.auth.management.code-required"))
								: undefined,
					},
				]}
			>
				{(field) => (
					<label className="ui-field-label">
						<span>{t(kernelMessage("client.auth.two-factor.authenticator-code"))}</span>
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
					{t(serverError)}
				</p>
			)}
			<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
				{([canSubmit, isSubmitting]) => (
					<Button type="submit" variant="primary" className="w-full" disabled={!canSubmit}>
						{t(
							isSubmitting
								? kernelMessage("client.auth.two-factor.verifying")
								: kernelMessage("client.auth.management.turn-on"),
						)}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}
