import {
	isOAuthAccessScope,
	type OAuthAccessScope,
	type OAuthConsentDetails,
	type OAuthScope,
	type WriteAccess,
	writeAccessFromScopes,
	writeAccessScopes,
} from "@ryot-app/contract/oauth";
import type { Message } from "@ryot-app/i18n/message";
import { useRichText, useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";

import { WriteAccessField } from "#/modules/access/write-access";
import { HostedAuthService } from "#/modules/auth/hosted-service";
import { AuthStatus } from "#/modules/auth/status";
import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";

export const Route = createFileRoute("/oauth/consent")({
	shouldReload: true,
	component: OAuthConsent,
	pendingComponent: ConsentPending,
	loaderDeps: ({ search }) => search,
	loader: ({ context, abortController }) => {
		const oauthQuery = context.hostedOAuthQuery();
		return context.runtime.runPromise(
			Effect.flatMap(HostedAuthService, (auth) =>
				auth
					.consentDetails(oauthQuery)
					.pipe(
						Effect.match({
							onSuccess: (details) => ({ details, oauthQuery, _tag: "Ready" as const }),
							onFailure: (error) => ({ error, oauthQuery, _tag: "Unavailable" as const }),
						}),
					),
			),
			{ signal: abortController.signal },
		);
	},
});

function ConsentPending() {
	const t = useT();
	return (
		<AuthStatus
			title={t(kernelMessage("client.route.oauth-consent.checking-title"))}
			message={t(kernelMessage("client.route.oauth-consent.checking-detail"))}
		/>
	);
}

function ConsentLogin(props: { readonly oauthQuery: string }) {
	const t = useT();
	return (
		<AuthStatus
			title={t(kernelMessage("client.route.oauth-consent.login-title"))}
			message={t(kernelMessage("client.route.oauth-consent.login-detail"))}
			actions={
				<a href={`/oauth/login?${props.oauthQuery}`} className="font-semibold text-accent-text">
					{t(kernelMessage("common.action.sign-in"))}
				</a>
			}
		/>
	);
}

function OAuthConsent() {
	const t = useT();
	const result = Route.useLoaderData();
	const router = useRouter();
	if (result._tag === "Unavailable") {
		return result.error.code === "UNAUTHORIZED" ? (
			<ConsentLogin oauthQuery={result.oauthQuery} />
		) : (
			<AuthStatus
				message={t(result.error.reason)}
				title={t(kernelMessage("client.route.oauth-consent.load-failed-title"))}
				actions={
					<Button type="button" variant="secondary" onClick={() => void router.invalidate()}>
						{t(kernelMessage("common.action.try-again"))}
					</Button>
				}
			/>
		);
	}
	return (
		<ConsentForm key={result.oauthQuery} details={result.details} oauthQuery={result.oauthQuery} />
	);
}

function ConsentForm(props: {
	readonly oauthQuery: string;
	readonly details: OAuthConsentDetails;
}) {
	const { runtime } = Route.useRouteContext();
	const auth = runtime.runSync(HostedAuthService);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<Message>();
	const [loginRequired, setLoginRequired] = useState(false);
	const controller = useRef(new AbortController());
	useEffect(() => () => controller.current.abort(), []);

	const maximum = writeAccessFromScopes(props.details.scopes);
	const [writeAccess, setWriteAccess] = useState<WriteAccess>(
		maximum === "unattended" ? "confirm" : maximum,
	);

	function decide(accept: boolean) {
		if (pending) {
			return;
		}
		setPending(true);
		setError(undefined);
		const scopes = [
			...props.details.scopes.filter((scope) => !isOAuthAccessScope(scope)),
			...writeAccessScopes[writeAccess],
		];
		runtime.runFork(
			auth.submitConsent(props.oauthQuery, accept, scopes).pipe(
				Effect.catch((failure) =>
					Effect.sync(() => {
						setPending(false);
						setError(failure.reason);
						setLoginRequired(failure.code === "UNAUTHORIZED");
					}),
				),
			),
			{ signal: controller.current.signal },
		);
	}

	if (loginRequired) {
		return <ConsentLogin oauthQuery={props.oauthQuery} />;
	}

	return (
		<ConsentRequest
			error={error}
			decide={decide}
			pending={pending}
			maximum={maximum}
			details={props.details}
			writeAccess={writeAccess}
			onWriteAccessChange={setWriteAccess}
		/>
	);
}

const permissionDescriptions: Record<Exclude<OAuthScope, OAuthAccessScope>, Message> = {
	email: kernelMessage("client.route.oauth-consent.permission.email"),
	openid: kernelMessage("client.route.oauth-consent.permission.openid"),
	profile: kernelMessage("client.route.oauth-consent.permission.profile"),
	offline_access: kernelMessage("client.route.oauth-consent.permission.offline-access"),
};

function ConsentRequest(props: {
	readonly error?: Message;
	readonly pending: boolean;
	readonly maximum: WriteAccess;
	readonly writeAccess: WriteAccess;
	readonly details: OAuthConsentDetails;
	readonly decide: (accept: boolean) => void;
	readonly onWriteAccessChange: (access: WriteAccess) => void;
}) {
	const t = useT();
	const richText = useRichText(kernelMessage);
	usePageTitle(t(kernelMessage("client.route.oauth-consent.approve-title")));
	return (
		<main {...mainContentProps} className="ui-page">
			<section
				aria-labelledby="consent-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				<div>
					<h1 id="consent-title" className="ui-heading">
						{t(kernelMessage("client.route.oauth-consent.approve-title"))}
					</h1>
					<p className="ui-subtitle">
						{richText("client.route.oauth-consent.access-request", {
							clientName: <strong>{props.details.clientName}</strong>,
						})}
					</p>
				</div>
				<p>
					{richText("client.route.oauth-consent.return-origin", {
						origin: <strong className="break-all">{props.details.redirectOrigin}</strong>,
					})}
				</p>
				<WriteAccessField
					maximum={props.maximum}
					disabled={props.pending}
					value={props.writeAccess}
					onChange={props.onWriteAccessChange}
				/>
				<div>
					<h2 className="font-medium">
						{t(kernelMessage("client.route.oauth-consent.permissions-title"))}
					</h2>
					<ul className="ui-stack">
						{props.details.scopes.flatMap((scope) =>
							isOAuthAccessScope(scope)
								? []
								: [
										<li key={scope}>
											<code>{scope}</code> — {t(permissionDescriptions[scope])}
										</li>,
									],
						)}
					</ul>
				</div>
				<p className="text-sm text-text-subtle">
					{t(kernelMessage("client.route.oauth-consent.publisher-warning"))}
				</p>
				{props.error && (
					<p role="alert" className="ui-field-error">
						{t(props.error)}
					</p>
				)}
				{props.pending && (
					<p role="status">{t(kernelMessage("client.route.oauth-consent.returning"))}</p>
				)}
				<div className="grid gap-2">
					<Button
						type="button"
						variant="primary"
						disabled={props.pending}
						onClick={() => props.decide(true)}
					>
						{t(kernelMessage("client.route.oauth-consent.approve"))}
					</Button>
					<Button
						type="button"
						variant="secondary"
						disabled={props.pending}
						onClick={() => props.decide(false)}
					>
						{t(kernelMessage("client.route.oauth-consent.deny"))}
					</Button>
				</div>
			</section>
		</main>
	);
}
