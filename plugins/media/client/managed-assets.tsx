import {
	managedAssetKey,
	useManagedAssetUrl as useManagedLocatorUrl,
} from "@ryot-app/client-sdk/react";
import { EntityArtWell, type FieldSyncState } from "@ryot-app/client-ui-sdk/sync";

import type { MediaImageAsset } from "./media-image";

export const imageAssetKey = (asset: MediaImageAsset) =>
	asset.type === "remote" ? `remote:${asset.url}` : managedAssetKey(asset);

export function useManagedAssetUrl(asset: MediaImageAsset | undefined) {
	const managedUrl = useManagedLocatorUrl(asset?.type === "remote" ? undefined : asset);
	return asset?.type === "remote" ? asset.url : managedUrl;
}

type AssetShape = "rounded" | "circle";

type AssetFit = "cover" | "contain";

export function ManagedAssetImage(props: {
	readonly monogram: string;
	readonly className: string;
	readonly state: FieldSyncState;
	readonly fit?: AssetFit | undefined;
	readonly shape?: AssetShape | undefined;
	readonly asset: MediaImageAsset | undefined;
}) {
	const url = useManagedAssetUrl(props.asset);
	return (
		<EntityArtWell
			url={url}
			fit={props.fit}
			state={props.state}
			monogram={props.monogram}
			className={props.className}
			shape={props.shape ?? "rounded"}
		/>
	);
}
