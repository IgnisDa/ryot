import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import clsx from "clsx";
import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";

import type { ServerOrigin } from "#/api/origin";
import { InstanceAdminContext } from "#/modules/instance-admin/context";
import { InstanceAdminSessionService } from "#/modules/instance-admin/session";
import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";
import type { ClientRuntime } from "#/runtime";

const sections = [
	{
		icon: "users",
		path: "/instance-admin/users",
		label: kernelMessage("client.instance-admin.users.title"),
	},
	{
		icon: "file-text",
		path: "/instance-admin/migration-report",
		label: kernelMessage("client.instance-admin.migration-report.title"),
	},
	{
		icon: "file-text",
		path: "/instance-admin/logs",
		label: kernelMessage("client.instance-admin.logs.title"),
	},
] as const;

type InstanceAdminShellProps = { readonly server: ServerOrigin; readonly runtime: ClientRuntime };

export function InstanceAdminShell({ server, runtime }: InstanceAdminShellProps) {
	const sessionService = runtime.runSync(InstanceAdminSessionService);
	const sessionIdRef = useRef<string>(null);
	const [sessionId, setSessionId] = useState<string>();
	const [tokenGateError, setTokenGateError] = useState<Message>();

	function clearSession() {
		const current = sessionIdRef.current;
		sessionIdRef.current = null;
		setSessionId(undefined);
		if (current !== null) {
			runtime.runSync(sessionService.clear(current));
		}
	}
	function lock() {
		clearSession();
		setTokenGateError(undefined);
	}
	function unauthorized() {
		clearSession();
		setTokenGateError(kernelMessage("client.instance-admin.shell.invalid-token"));
	}

	useEffect(
		() => () => {
			const current = sessionIdRef.current;
			if (current !== null) {
				runtime.runSync(sessionService.clear(current));
			}
		},
		[runtime, sessionService],
	);

	if (sessionId === undefined) {
		return (
			<InstanceAdminTokenGate
				server={server}
				runtime={runtime}
				initialError={tokenGateError}
				onUnlock={(nextSessionId) => {
					sessionIdRef.current = nextSessionId;
					setSessionId(nextSessionId);
				}}
			/>
		);
	}

	return (
		// The provider only exists for one unlocked session and is removed when it changes.
		// oxlint-disable-next-line react/jsx-no-constructed-context-values
		<InstanceAdminContext.Provider value={{ lock, sessionId, unauthorized }}>
			<InstanceAdminWorkspace onLock={lock} />
		</InstanceAdminContext.Provider>
	);
}

function InstanceAdminTokenGate(props: {
	readonly server: ServerOrigin;
	readonly initialError?: Message;
	readonly runtime: ClientRuntime;
	readonly onUnlock: (sessionId: string) => void;
}) {
	const t = useT();
	usePageTitle(t(kernelMessage("client.instance-admin.shell.title")));
	const sessionService = props.runtime.runSync(InstanceAdminSessionService);
	const [token, setToken] = useState("");
	const [error, setError] = useState(props.initialError);
	const [submitting, setSubmitting] = useState(false);

	function unlock() {
		const trimmedToken = token.trim();
		if (!trimmedToken) {
			setError(kernelMessage("client.instance-admin.shell.token-required"));
			return;
		}
		setSubmitting(true);
		setError(undefined);
		props.runtime.runFork(
			sessionService.create(props.server, trimmedToken).pipe(
				Effect.matchCause({
					onSuccess: (sessionId) => props.onUnlock(sessionId),
					onFailure: () => {
						setError(kernelMessage("client.instance-admin.shell.start-failed"));
						setSubmitting(false);
					},
				}),
			),
		);
	}

	return (
		<main
			{...mainContentProps}
			className="ui-page bg-surface-2 md:grid-cols-[minmax(280px,420px)_minmax(360px,460px)] md:items-center md:justify-center md:gap-[clamp(48px,8vw,112px)] md:px-12"
		>
			<section
				aria-labelledby="instance-admin-title"
				className="mx-auto w-[min(100%,460px)] md:mx-0"
			>
				<p className="ui-overline">{t(kernelMessage("client.instance-admin.shell.overline"))}</p>
				<h1 className="ui-heading" id="instance-admin-title">
					{t(kernelMessage("client.instance-admin.shell.title"))}
				</h1>
				<p className="ui-subtitle">
					{t(
						kernelMessage("client.instance-admin.shell.token-help", {
							host: new URL(props.server).host,
						}),
					)}
				</p>
			</section>
			<form
				noValidate
				className="ui-card mx-auto w-[min(100%,460px)] md:mx-0"
				onSubmit={(event) => {
					event.preventDefault();
					unlock();
				}}
			>
				<label className="ui-field-label">
					{t(kernelMessage("client.instance-admin.shell.token-label"))}
					<input
						required
						autoFocus
						value={token}
						type="password"
						autoComplete="off"
						className="ui-field-input"
						aria-invalid={error !== undefined}
						aria-describedby={error ? "instance-admin-token-error" : undefined}
						onChange={(event) => {
							setToken(event.currentTarget.value);
							setError(undefined);
						}}
					/>
				</label>
				<div aria-live="polite" className="flex min-h-11 items-center">
					{error && (
						<p role="alert" id="instance-admin-token-error" className="ui-form-status text-danger">
							{t(error)}
						</p>
					)}
				</div>
				<Button type="submit" variant="primary" className="w-full" disabled={submitting}>
					{t(
						kernelMessage(
							submitting
								? "client.instance-admin.shell.unlocking"
								: "client.instance-admin.shell.unlock",
						),
					)}
				</Button>
			</form>
		</main>
	);
}

function InstanceAdminWorkspace({ onLock }: { readonly onLock: () => void }) {
	const t = useT();
	const navigate = useNavigate();
	const { pathname } = useLocation();
	const active = sections.find((section) => section.path === pathname) ?? sections[0];
	usePageTitle(t(active.label));

	return (
		<div className="flex min-h-dvh bg-surface-2 text-text">
			<aside
				data-testid="instance-admin-sidebar"
				className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface px-4 py-6 md:flex"
			>
				<Link to="/" className="mb-8 flex min-h-11 items-center gap-2 px-3 text-sm text-text-muted">
					<AppIcon name="chevron-left" />
					{t(kernelMessage("client.instance-admin.shell.back"))}
				</Link>
				<p className="px-3 font-display text-2xl font-semibold">
					{t(kernelMessage("client.instance-admin.shell.title"))}
				</p>
				<nav
					className="mt-6 flex flex-col gap-1"
					aria-label={t(kernelMessage("client.instance-admin.shell.sections"))}
				>
					{sections.map((section) => (
						<Link
							to={section.path}
							key={section.path}
							aria-current={section === active ? "page" : undefined}
							className={clsx(
								"flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-text-muted",
								section === active && "bg-nav-indicator text-text",
							)}
						>
							<AppIcon size={17} name={section.icon} />
							{t(section.label)}
						</Link>
					))}
				</nav>
			</aside>
			<div className="min-w-0 flex-1">
				<header className="flex min-h-16 items-center gap-2 border-b border-border bg-surface px-3 pt-[env(safe-area-inset-top)] md:px-6">
					<Link
						to="/"
						className="flex size-11 items-center justify-center md:hidden"
						aria-label={t(kernelMessage("client.instance-admin.shell.back"))}
					>
						<AppIcon size={20} name="chevron-left" />
					</Link>
					<div className="min-w-0 flex-1">
						<p className="truncate font-display text-lg font-semibold md:text-xl">
							{t(active.label)}
						</p>
					</div>
					<Button type="button" variant="ghost" onClick={onLock}>
						<span className="flex items-center gap-2">
							<AppIcon name="lock" /> {t(kernelMessage("client.instance-admin.shell.lock"))}
						</span>
					</Button>
				</header>
				<nav
					aria-label={t(kernelMessage("client.instance-admin.shell.compact-sections"))}
					className="flex gap-1 overflow-x-auto border-b border-border bg-surface px-3 py-2 md:hidden"
				>
					{sections.map((section) => (
						<button
							type="button"
							key={section.path}
							aria-current={section === active ? "page" : undefined}
							onClick={() => void navigate({ replace: true, to: section.path })}
							className={clsx(
								"shrink-0 rounded-lg px-3 py-2 text-sm text-text-muted",
								section === active && "bg-nav-indicator text-text",
							)}
						>
							{t(section.label)}
						</button>
					))}
				</nav>
				<main {...mainContentProps} className="p-5 md:p-8">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
