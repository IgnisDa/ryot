import { createFileRoute } from "@tanstack/react-router";

import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";

export const Route = createFileRoute("/_authenticated/")({ component: NoWorkspaces });

function NoWorkspaces() {
	usePageTitle("No workspaces");
	return (
		<main {...mainContentProps} className="ui-page">
			<section
				aria-labelledby="no-workspaces-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				<div>
					<h1 id="no-workspaces-title" className="ui-heading">
						No workspaces enabled
					</h1>
					<p role="status" className="ui-subtitle">
						Your account does not have an enabled workspace.
					</p>
				</div>
				<a className="ui-link" href="/settings/account">
					Account settings
				</a>
			</section>
		</main>
	);
}
