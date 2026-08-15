import {
	managedAssetKey,
	useManagedAssetUrl as useManagedLocatorUrl,
} from "@ryot-app/client-sdk/react";
import { EntityArtWell, type FieldSyncState } from "@ryot-app/client-ui-sdk/sync";

import type { ShowImageAsset } from "./media-image";

export const imageAssetKey = (asset: ShowImageAsset) =>
	asset.type === "remote" ? `remote:${asset.url}` : managedAssetKey(asset);

export function useManagedAssetUrl(asset: ShowImageAsset | undefined) {
	const managedUrl = useManagedLocatorUrl(asset?.type === "remote" ? undefined : asset);
	return asset?.type === "remote" ? asset.url : managedUrl;
}

type AssetShape = "rounded" | "circle";

export function ManagedAssetImage(props: {
	readonly monogram: string;
	readonly className: string;
	readonly state: FieldSyncState;
	readonly shape?: AssetShape | undefined;
	readonly asset: ShowImageAsset | undefined;
}) {
	const url = useManagedAssetUrl(props.asset);
	return (
		<EntityArtWell
			url={url}
			state={props.state}
			monogram={props.monogram}
			className={props.className}
			shape={props.shape ?? "rounded"}
		/>
	);
}
