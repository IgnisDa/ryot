import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { Effect, Match } from "effect";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { decodeServerOrigin } from "#/api/origin";
import { OAuthLauncher, type OAuthLaunchPlan } from "#/modules/auth/oauth-launcher";
import { AuthService } from "#/modules/auth/service";
import { AuthStatus } from "#/modules/auth/status";
import { sanitizeRedirect } from "#/modules/server/redirect";

export const Route = createFileRoute("/auth")({
	component: OAuthLaunch,
	pendingComponent: OAuthLaunchPending,
	errorComponent: OAuthLaunchUnavailable,
	validateSearch: (search) => ({ redirect: sanitizeRedirect(search.redirect) }),
	beforeLoad: ({ search, context }) =>
		context.runtime.runPromise(
			Effect.flatMap(OAuthLauncher, (launcher) => launcher.prepare(search.redirect)).pipe(
				Effect.map((result) => {
					if (result._tag === "MissingServer") {
						throw redirect({
							replace: true,
							to: "/onboarding",
							search: { redirect: search.redirect },
						});
					}
					if (result._tag === "Authenticated") {
						throw redirect({
							replace: true,
							to: result.destination,
							search: { redirect: undefined },
						});
					}
					return { plan: result.plan };
				}),
			),
		),
});

function OAuthLaunchPending() {
	const t = useT();
	return (
		<AuthStatus
			title={t(kernelMessage("client.route.auth.preparing-title"))}
			message={t(kernelMessage("client.route.auth.preparing-detail"))}
		/>
	);
}

function OAuthLaunchUnavailable({ error }: { error: unknown }) {
	const t = useT();
	const router = useRouter();
	const reason =
		typeof error === "object" && error !== null && "reason" in error ? error.reason : undefined;
	const message = Match.value(reason).pipe(
		Match.when("unknown-native-application", () =>
			kernelMessage("client.route.auth.launch-unknown-application"),
		),
		Match.when("storage-failed", () => kernelMessage("client.route.auth.launch-storage-failed")),
		Match.orElse(() => kernelMessage("client.route.auth.launch-unavailable")),
	);
	return (
		<AuthStatus
			message={t(message)}
			title={t(kernelMessage("client.route.auth.launch-failed-title"))}
			actions={
				<Button
					type="button"
					variant="primary"
					className="w-full"
					onClick={() => void router.invalidate()}
				>
					{t(kernelMessage("common.action.try-again"))}
				</Button>
			}
		/>
	);
}

function OAuthLaunch() {
	const t = useT();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const { plan, runtime } = Route.useRouteContext();
	const launcher = runtime.runSync(OAuthLauncher);
	const auth = runtime.runSync(AuthService);
	const launched = useRef(false);
	const [failedPlan, setFailedPlan] = useState<OAuthLaunchPlan>();
	const isNative = plan.client.nativeApplicationId !== null;

	function launch(target: OAuthLaunchPlan) {
		setFailedPlan(undefined);
		runtime.runFork(
			launcher
				.launch(target)
				.pipe(Effect.catchCause(() => Effect.sync(() => setFailedPlan(target)))),
		);
	}
	const launchAuth = useEffectEvent(launch);

	useEffect(() => {
		if (!isNative && !launched.current) {
			launched.current = true;
			launchAuth(plan);
		}
	}, [isNative, plan]);

	function changeServer() {
		return runtime.runPromise(
			Effect.gen(function* () {
				yield* auth.changeServer(yield* decodeServerOrigin(plan.pending.serverOrigin));
				yield* Effect.promise(() =>
					navigate({ replace: true, to: "/onboarding", search: { redirect: search.redirect } }),
				);
			}),
		);
	}

	const hostname = new URL(plan.pending.serverOrigin).hostname;

	if (failedPlan) {
		return (
			<AuthStatus
				title={t(kernelMessage("client.route.auth.browser-failed-title"))}
				message={t(kernelMessage("client.route.auth.browser-failed-detail"))}
				actions={
					<>
						<Button
							type="button"
							variant="primary"
							className="w-full"
							onClick={() => launch(failedPlan)}
						>
							{t(kernelMessage("common.action.try-again"))}
						</Button>
						{isNative && (
							<Button type="button" variant="ghost" onClick={() => void changeServer()}>
								{t(kernelMessage("client.route.auth.change-server"))}
							</Button>
						)}
					</>
				}
			/>
		);
	}

	if (isNative) {
		return (
			<AuthStatus
				title={t(kernelMessage("client.route.auth.sign-in-title"))}
				message={t(kernelMessage("client.route.auth.continue-detail", { hostname }))}
				actions={
					<>
						<Button type="button" variant="primary" className="w-full" onClick={() => launch(plan)}>
							{t(kernelMessage("client.route.auth.continue"))}
						</Button>
						<Button type="button" variant="ghost" onClick={() => void changeServer()}>
							{t(kernelMessage("client.route.auth.change-server"))}
						</Button>
					</>
				}
			/>
		);
	}

	return (
		<AuthStatus
			title={t(kernelMessage("client.route.auth.opening-title"))}
			message={t(kernelMessage("client.route.auth.opening-detail", { hostname }))}
		/>
	);
}
