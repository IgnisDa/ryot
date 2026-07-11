import { createFileRoute, redirect } from "@tanstack/react-router";
import { Effect } from "effect";

import { AuthService } from "#/modules/auth/service";
import { sanitizeRedirect } from "#/modules/server/redirect";
import { ServerService } from "#/modules/server/service";
import { AuthStatus } from "#/routes/auth";

export const Route = createFileRoute("/auth_/callback")({
	component: CompletingSignIn,
	pendingComponent: CompletingSignIn,
	errorComponent: CouldNotCompleteSignIn,
	validateSearch: (search) => ({
		redirect: sanitizeRedirect(search.redirect),
		token: typeof search.token === "string" && search.token !== "" ? search.token : undefined,
	}),
	beforeLoad: async ({ context, search }) => {
		const token = search.token;
		const server = context.runtime.runSync(
			Effect.flatMap(ServerService, (service) => service.selected),
		);
		if (server === null) {
			// oxlint-disable-next-line typescript/only-throw-error
			throw redirect({ replace: true, to: "/onboarding", search: { redirect: search.redirect } });
		}
		if (token === undefined) {
			// oxlint-disable-next-line typescript/only-throw-error
			throw redirect({ replace: true, to: "/auth", search: { redirect: search.redirect } });
		}
		const exchanged = await context.runtime.runPromise(
			Effect.flatMap(AuthService, (service) => service.verifyOneTimeToken(server, token)).pipe(
				Effect.match({ onSuccess: () => true, onFailure: () => false }),
			),
		);
		if (!exchanged) {
			// oxlint-disable-next-line typescript/only-throw-error
			throw redirect({ replace: true, to: "/auth", search: { redirect: search.redirect } });
		}
		// oxlint-disable-next-line typescript/only-throw-error
		throw redirect({ replace: true, to: search.redirect ?? "/", search: { redirect: undefined } });
	},
});

function CompletingSignIn() {
	return <AuthStatus title="Completing sign-in" message="Finishing up with your provider..." />;
}

function CouldNotCompleteSignIn() {
	return (
		<AuthStatus
			title="Could not complete sign-in"
			message="This sign-in link could not be used. Start again from the sign-in screen."
		/>
	);
}
