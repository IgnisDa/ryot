import { useRyotQuery } from "@ryot-app/client-sdk/react";
import { Button } from "@ryot-app/client-ui-sdk";
import type { ReactNode } from "react";

import { selectedIntegrationReadinessQuery } from "#/modules/integrations/service";

import { IngestionReadinessNotice } from "./readiness-presentation";
import { selectedImportReadinessQuery } from "./service";

type SelectedReadinessProps = {
	readonly slug: string;
	readonly settings: Readonly<Record<string, unknown>>;
	readonly integrationId?: string;
	readonly children: (ready: boolean) => ReactNode;
};

export function SelectedImportReadiness(props: SelectedReadinessProps) {
	const query = useRyotQuery(selectedImportReadinessQuery, {
		slug: props.slug,
		settings: props.settings,
	});
	const statusLabel =
		query.status === "success" ? "This source is no longer available." : "Checking setup...";
	return (
		<>
			{query.data === undefined ? (
				<p role="status" className="text-sm text-text-muted">
					{query.status === "error" ? (
						<>
							Could not check setup.{" "}
							<Button variant="secondary" onClick={query.refetch}>
								Try again
							</Button>
						</>
					) : (
						statusLabel
					)}
				</p>
			) : (
				<IngestionReadinessNotice scope={query.data.pluginScope} readiness={query.data.readiness} />
			)}
			{query.data?.readiness.ready === false ? (
				<Button variant="secondary" onClick={query.refetch}>
					Check setup again
				</Button>
			) : null}
			{props.children(query.status === "success" && query.data?.readiness.ready === true)}
		</>
	);
}

export function SelectedIntegrationReadiness(props: SelectedReadinessProps) {
	const query = useRyotQuery(selectedIntegrationReadinessQuery, {
		slug: props.slug,
		settings: props.settings,
		...(props.integrationId === undefined ? {} : { integrationId: props.integrationId }),
	});
	const statusLabel =
		query.status === "success" ? "This service is no longer available." : "Checking setup...";
	return (
		<>
			{query.data === undefined ? (
				<p role="status" className="text-sm text-text-muted">
					{query.status === "error" ? (
						<>
							Could not check setup.{" "}
							<Button variant="secondary" onClick={query.refetch}>
								Try again
							</Button>
						</>
					) : (
						statusLabel
					)}
				</p>
			) : (
				<IngestionReadinessNotice scope={query.data.pluginScope} readiness={query.data.readiness} />
			)}
			{query.data?.readiness.ready === false ? (
				<Button variant="secondary" onClick={query.refetch}>
					Check setup again
				</Button>
			) : null}
			{props.children(query.status === "success" && query.data?.readiness.ready === true)}
		</>
	);
}
