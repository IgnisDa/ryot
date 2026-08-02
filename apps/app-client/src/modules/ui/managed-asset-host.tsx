import { useAtomValue } from "@effect/atom-react";
import type { ManagedAssetLocator } from "@ryot/contract/modules/uploads/schemas";
import type { ReactNode } from "react";

import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";

import { managedAssetResolutionAtom } from "./managed-asset-resolution";
import type { ManagedAssetResolutionState } from "./managed-assets";

const NO_MANAGED_ASSETS: ManagedAssetResolutionState = { status: "ready", urls: new Map() };

type ManagedAssetsProps = {
	readonly label: string;
	readonly assets: readonly ManagedAssetLocator[];
	readonly children: (resolution: ManagedAssetResolutionState) => ReactNode;
};

function ResolvedManagedAssets(props: ManagedAssetsProps) {
	const scope = useApiScope();
	const state = useAtomValue(managedAssetResolutionAtom({ scope, assets: props.assets }));
	useInternalRequestFailureLogging(
		`${props.label} managed asset resolution ${state.status}`,
		state.status === "unavailable" ? state.cause : undefined,
	);
	return <>{props.children(state)}</>;
}

export function ManagedAssets(props: ManagedAssetsProps) {
	return props.assets.length === 0 ? (
		<>{props.children(NO_MANAGED_ASSETS)}</>
	) : (
		<ResolvedManagedAssets {...props} />
	);
}
