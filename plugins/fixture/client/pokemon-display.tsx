import { useManagedAssetUrl } from "@ryot-app/client-sdk/react";
import { EntityArtWell, type FieldSyncState } from "@ryot-app/client-ui-sdk/sync";

import type { PokemonArtworkAsset, PokemonDetailsData } from "./pokemon-schema";

export const PokemonArtwork = ({
	name,
	state,
	asset,
	className,
}: {
	readonly name: string;
	readonly className: string;
	readonly state: FieldSyncState;
	readonly asset: PokemonArtworkAsset | undefined;
}) => {
	const managedUrl = useManagedAssetUrl(asset?.type === "remote" ? undefined : asset);
	return (
		<EntityArtWell
			state={state}
			shape="rounded"
			monogram={name}
			className={className}
			url={asset?.type === "remote" ? asset.url : managedUrl}
		/>
	);
};

export const PokemonDetails = ({ height, weight, abilities }: PokemonDetailsData) => (
	<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
		<dt className="text-text-muted">Abilities</dt>
		<dd>{abilities && abilities.length > 0 ? abilities.join(", ") : "Unavailable"}</dd>
		<dt className="text-text-muted">Height</dt>
		<dd>{height === null ? "Unavailable" : `${height} dm`}</dd>
		<dt className="text-text-muted">Weight</dt>
		<dd>{weight === null ? "Unavailable" : `${weight} hg`}</dd>
	</dl>
);
