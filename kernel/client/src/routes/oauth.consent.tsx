import type { OAuthConsentDetails } from "@ryot-app/contract/oauth";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useRef, useState } from "react";

import { HostedAuthService } from "#/modules/auth/hosted-service";
import { AuthStatus } from "#/modules/auth/status";
import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";

export const Route = createFileRoute("/oauth/consent")({
	shouldReload: true,
	component: OAuthConsent,
	loaderDeps: ({ search }) => search,
	pendingComponent: () => (
		<AuthStatus
			title="Checking access request"
			message="Reading this app's requested permissions..."
		/>
	),
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

function ConsentLogin(props: { readonly oauthQuery: string }) {
	return (
		<AuthStatus
			title="Sign in to continue"
			message="Your sign-in session has ended. Sign in again to review this app's access request."
			actions={
				<a href={`/oauth/login?${props.oauthQuery}`} className="font-semibold text-accent-text">
					Sign in
				</a>
			}
		/>
	);
}

function OAuthConsent() {
	const result = Route.useLoaderData();
	const router = useRouter();
	if (result._tag === "Unavailable") {
		return result.error.code === "UNAUTHORIZED" ? (
			<ConsentLogin oauthQuery={result.oauthQuery} />
		) : (
			<AuthStatus
				message={result.error.message}
				title="Could not load access request"
				actions={
					<Button type="button" variant="secondary" onClick={() => void router.invalidate()}>
						Try again
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
	const [error, setError] = useState<string>();
	const [loginRequired, setLoginRequired] = useState(false);
	const controller = useRef(new AbortController());
	useEffect(() => () => controller.current.abort(), []);

	function decide(accept: boolean) {
		if (pending) {
			return;
		}
		setPending(true);
		setError(undefined);
		runtime.runFork(
			auth.submitConsent(props.oauthQuery, accept).pipe(
				Effect.catch((failure) =>
					Effect.sync(() => {
						setPending(false);
						setError(failure.message);
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

	return <ConsentRequest error={error} decide={decide} pending={pending} details={props.details} />;
}

function ConsentRequest(props: {
	readonly error?: string;
	readonly pending: boolean;
	readonly details: OAuthConsentDetails;
	readonly decide: (accept: boolean) => void;
}) {
	usePageTitle("Approve access");
	return (
		<main {...mainContentProps} className="ui-page">
			<section
				aria-labelledby="consent-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				<div>
					<h1 id="consent-title" className="ui-heading">
						Approve access
					</h1>
					<p className="ui-subtitle">
						<strong>{props.details.clientName}</strong> wants to access your Ryot account.
					</p>
				</div>
				<p>
					You will return to <strong className="break-all">{props.details.redirectOrigin}</strong>.
				</p>
				<div>
					<h2 className="font-medium">Requested permission</h2>
					<p>
						<code>{props.details.scope}</code> — Read, change and delete your Ryot data, including
						through your installed plugins.
					</p>
				</div>
				<p className="text-sm text-text-subtle">
					The app name was supplied during registration. Ryot does not verify its publisher. Approve
					only if you trust this app.
				</p>
				{props.error && (
					<p role="alert" className="ui-field-error">
						{props.error}
					</p>
				)}
				{props.pending && <p role="status">Returning to the app...</p>}
				<div className="grid gap-2">
					<Button
						type="button"
						variant="primary"
						disabled={props.pending}
						onClick={() => props.decide(true)}
					>
						Approve
					</Button>
					<Button
						type="button"
						variant="secondary"
						disabled={props.pending}
						onClick={() => props.decide(false)}
					>
						Deny
					</Button>
				</div>
			</section>
		</main>
	);
}
