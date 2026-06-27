import { EntityArtWell, type FieldSyncState } from "@ryot-app/client-ui-sdk/sync";
import type { AssetLocator } from "@ryot-app/contract/modules/uploads/schemas";

import { resolveAssetUrl } from "#/modules/assets/managed-assets";

export function ManagedImage(props: {
	readonly monogram: string;
	readonly className: string;
	readonly state: FieldSyncState;
	readonly asset: AssetLocator | null;
	readonly urls: ReadonlyMap<string, string>;
}) {
	return (
		<EntityArtWell
			state={props.state}
			monogram={props.monogram}
			className={props.className}
			url={props.asset === null ? undefined : resolveAssetUrl(props.asset, props.urls)}
		/>
	);
}
