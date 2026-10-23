import { managedAssetKey, useAssetUrl } from "@ryot-app/plugin-client-sdk/react";
import { EntityArtWell, type FieldSyncState } from "@ryot-app/plugin-ui-sdk/sync";

import type { MediaImageAsset } from "./image";

export const imageAssetKey = (asset: MediaImageAsset) =>
	asset.type === "remote" ? `remote:${asset.url}` : managedAssetKey(asset);

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
	const url = useAssetUrl(props.asset);
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
