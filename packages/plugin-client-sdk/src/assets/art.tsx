import type { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { EntityArtWell } from "@ryot-app/plugin-ui-sdk/sync";
import type { ComponentProps } from "react";

import { useAssetUrl } from "./provider";

type ArtWellProps = ComponentProps<typeof EntityArtWell>;

export function AssetArtWell({
	asset,
	state,
	shape = "rounded",
	...props
}: Omit<ArtWellProps, "url" | "state"> & {
	readonly asset: undefined | AssetLocator;
	readonly state?: undefined | ArtWellProps["state"];
}) {
	const url = useAssetUrl(asset);
	return (
		<EntityArtWell
			{...props}
			url={url}
			shape={shape}
			state={state ?? (asset === undefined ? "absent" : "ready")}
		/>
	);
}
