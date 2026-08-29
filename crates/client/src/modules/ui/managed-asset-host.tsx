import { useAtomValue } from "@effect/atom-react";
import type { ManagedAssetLocator } from "@ryot-app/contract/modules/uploads/schemas";
import type { ReactNode } from "react";

import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";

import { ManagedAssetUrls } from "./managed-asset-context";
import { managedAssetResolutionAtom } from "./managed-asset-resolution";

type ManagedAssetHostProps = {
	readonly label: string;
	readonly children: ReactNode;
	readonly assets: readonly ManagedAssetLocator[];
};

function ResolvedManagedAssets(props: ManagedAssetHostProps) {
	const scope = useApiScope();
	const state = useAtomValue(managedAssetResolutionAtom({ scope, assets: props.assets }));
	useInternalRequestFailureLogging(
		`${props.label} managed asset resolution ${state.status}`,
		state.status === "unavailable" ? state.cause : undefined,
	);
	return <ManagedAssetUrls urls={state.urls}>{props.children}</ManagedAssetUrls>;
}

export function ManagedAssetHost(props: ManagedAssetHostProps) {
	return props.assets.length === 0 ? props.children : <ResolvedManagedAssets {...props} />;
}
