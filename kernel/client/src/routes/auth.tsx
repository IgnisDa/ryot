import { createFileRoute } from "@tanstack/react-router";

import { changeSelectedServer } from "../modules/auth/server-change";
import { sanitizeRedirect } from "../modules/server/redirect";
import { getServerSelection } from "../persistence/storage";

export const Route = createFileRoute("/auth")({
	component: AuthDestination,
	validateSearch: (search) => ({ redirect: sanitizeRedirect(search.redirect) }),
});

function AuthDestination() {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const server = getServerSelection();

	async function selectAnotherServer() {
		await changeSelectedServer(server);
		await navigate({ replace: true, to: "/onboarding", search: { redirect: search.redirect } });
	}

	return (
		<main className="auth-shell">
			<section className="auth-card" aria-labelledby="auth-title">
				<p className="overline">Server connected</p>
				<h1 id="auth-title">Authentication comes next.</h1>
				<p>Your server is ready. Sign-in will be added in the next kernel slice.</p>
				<button
					type="button"
					className="secondary-button"
					onClick={() => void selectAnotherServer()}
				>
					Change server
				</button>
			</section>
		</main>
	);
}
