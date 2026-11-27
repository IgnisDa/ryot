import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { createFileRoute } from "@tanstack/react-router";

import { usePageTitle } from "#/modules/navigation/page-title";
import { mainContentProps } from "#/modules/navigation/skip-link";

export const Route = createFileRoute("/_authenticated/")({ component: NoWorkspaces });

function NoWorkspaces() {
	const t = useT();
	usePageTitle(t(kernelMessage("client.route.no-workspaces.title")));
	return (
		<main {...mainContentProps} className="ui-page">
			<section
				aria-labelledby="no-workspaces-title"
				className="ui-stack ui-card mx-auto w-[min(100%,480px)]"
			>
				<div>
					<h1 className="ui-heading" id="no-workspaces-title">
						{t(kernelMessage("client.route.no-workspaces.heading"))}
					</h1>
					<p role="status" className="ui-subtitle">
						{t(kernelMessage("client.route.no-workspaces.detail"))}
					</p>
				</div>
				<a className="ui-link" href="/settings/account">
					{t(kernelMessage("client.route.no-workspaces.account-settings"))}
				</a>
			</section>
		</main>
	);
}
