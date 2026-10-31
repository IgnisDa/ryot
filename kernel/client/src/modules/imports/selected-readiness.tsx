import type { IngestionReadiness } from "@ryot-app/contract/modules/plugins/ingestion-readiness";
import {
	type DeclarationReference,
	sameDeclaration,
} from "@ryot-app/contract/modules/plugins/references";
import { type RyotQueryResult, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { evaluateImportSourceReadiness } from "@ryot-app/ryotql-recipes/import-sources";
import { evaluateIntegrationProviderReadiness } from "@ryot-app/ryotql-recipes/integration-providers";
import { Result } from "effect";
import type { ReactNode } from "react";

import { integrationProvidersQuery } from "#/modules/integrations/service";

import { IngestionReadinessNotice } from "./readiness-presentation";
import { importSourcesQuery } from "./service";

type SelectedReadinessProps = {
	readonly integrationId?: string;
	readonly reference: DeclarationReference;
	readonly children: (ready: boolean) => ReactNode;
	readonly settings: Readonly<Record<string, unknown>>;
};

export function SelectedImportReadiness(props: SelectedReadinessProps) {
	const query = useRyotQuery(importSourcesQuery);
	const source = query.data?.find((item) => sameDeclaration(item.reference, props.reference));
	const evaluation = Result.try(() =>
		source === undefined ? undefined : evaluateImportSourceReadiness(source, props.settings),
	);
	return (
		<SelectedReadiness
			query={query}
			scope={source?.pluginScope}
			readiness={Result.getOrUndefined(evaluation)}
			evaluationFailed={Result.isFailure(evaluation)}
			missingLabel="This source is no longer available."
		>
			{props.children}
		</SelectedReadiness>
	);
}

export function SelectedIntegrationReadiness(props: SelectedReadinessProps) {
	const query = useRyotQuery(integrationProvidersQuery);
	const provider = query.data?.find((item) => sameDeclaration(item.reference, props.reference));
	const evaluation = Result.try(() =>
		provider === undefined
			? undefined
			: evaluateIntegrationProviderReadiness(provider, props.settings, props.integrationId),
	);
	return (
		<SelectedReadiness
			query={query}
			scope={provider?.pluginScope}
			readiness={Result.getOrUndefined(evaluation)}
			evaluationFailed={Result.isFailure(evaluation)}
			missingLabel="This service is no longer available."
		>
			{props.children}
		</SelectedReadiness>
	);
}

function SelectedReadiness(props: {
	readonly missingLabel: string;
	readonly evaluationFailed: boolean;
	readonly children: (ready: boolean) => ReactNode;
	readonly readiness: undefined | IngestionReadiness;
	readonly scope: null | "user" | "system" | undefined;
	readonly query: Pick<RyotQueryResult<unknown>, "status" | "refetch" | "isFetching">;
}) {
	const { query, readiness } = props;
	let notice: ReactNode;
	if (query.status === "error" || props.evaluationFailed) {
		notice = (
			<p role="status" className="text-sm text-text-muted">
				Could not check setup.{" "}
				<Button variant="secondary" onClick={query.refetch}>
					Try again
				</Button>
			</p>
		);
	} else if (readiness === undefined) {
		notice = (
			<p role="status" className="text-sm text-text-muted">
				{query.status === "success" ? props.missingLabel : "Checking setup..."}
			</p>
		);
	} else {
		notice = <IngestionReadinessNotice readiness={readiness} scope={props.scope ?? null} />;
	}
	return (
		<>
			{notice}
			{query.status === "error" ? null : (
				<Button variant="secondary" onClick={query.refetch} disabled={query.isFetching}>
					Check setup again
				</Button>
			)}
			{props.children(
				query.status === "success" &&
					!query.isFetching &&
					!props.evaluationFailed &&
					readiness?.ready === true,
			)}
		</>
	);
}
