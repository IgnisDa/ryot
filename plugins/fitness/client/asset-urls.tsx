import type { AssetLocator, ManagedAssetLocator } from "@ryot-app/plugin-client-sdk";
import { managedAssetKey, useAssetUrl } from "@ryot-app/plugin-client-sdk/react";
import { EntityArtWell } from "@ryot-app/plugin-ui-sdk/sync";
import type { ComponentProps } from "react";

export const managedAssetBatch = (assets: readonly (AssetLocator | undefined)[]) => {
	const managed = assets.filter(
		(asset): asset is ManagedAssetLocator => asset !== undefined && asset.type !== "remote",
	);
	return [...new Map(managed.map((asset) => [managedAssetKey(asset), asset])).values()].sort(
		(left, right) => managedAssetKey(left).localeCompare(managedAssetKey(right)),
	);
};

export function AssetArtWell(
	props: Pick<ComponentProps<typeof EntityArtWell>, "className" | "fit"> &
		Partial<Pick<ComponentProps<typeof EntityArtWell>, "state">> & {
			readonly name: string;
			readonly asset: AssetLocator | undefined;
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
