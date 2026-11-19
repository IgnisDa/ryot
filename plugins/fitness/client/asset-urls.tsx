import type { AssetLocator, ManagedAssetLocator } from "@ryot-app/plugin-client-sdk";
import { managedAssetKey, useAssetUrl } from "@ryot-app/plugin-client-sdk/react";
import { EntityArtWell } from "@ryot-app/plugin-ui-sdk/sync";
import type { ComponentProps } from "react";

export const managedAssetBatch = (assets: readonly (undefined | AssetLocator)[]) => {
	const managed = assets.filter(
		(asset): asset is ManagedAssetLocator => asset !== undefined && asset.type !== "remote",
	);
	return [...new Map(managed.map((asset) => [managedAssetKey(asset), asset])).values()].sort(
		(left, right) => managedAssetKey(left).localeCompare(managedAssetKey(right)),
	);
};

export function AssetArtWell(
	props: Partial<Pick<ComponentProps<typeof EntityArtWell>, "state">> &
		Pick<ComponentProps<typeof EntityArtWell>, "fit" | "className"> & {
			readonly name: string;
			readonly asset: undefined | AssetLocator;
		},
) {
	const url = useAssetUrl(props.asset);
	return (
		<EntityArtWell
			url={url}
			shape="rounded"
			fit={props.fit}
			monogram={props.name}
			className={props.className}
			state={props.state ?? (props.asset === undefined ? "absent" : "ready")}
		/>
	);
}
