import { useAssetUrl, useFormatters, useMessages } from "@ryot-app/plugin-client-sdk/react";
import { EntityArtWell, type FieldSyncState } from "@ryot-app/plugin-ui-sdk/sync";

import { catalogMessage } from "../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";
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
	readonly asset: undefined | PokemonArtworkAsset;
}) => {
	const url = useAssetUrl(asset);
	return (
		<EntityArtWell url={url} state={state} shape="rounded" monogram={name} className={className} />
	);
};

export const PokemonDetails = ({ height, weight, abilities }: PokemonDetailsData) => {
	const text = useMessages(PLUGIN_PACKAGE_ID, catalogMessage);
	const formatters = useFormatters();
	return (
		<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
			<dt className="text-text-muted">{text("property.abilities")}</dt>
			<dd>
				{abilities && abilities.length > 0
					? formatters.list({ type: "unit", style: "short" }).format(abilities)
					: text("common.status.unavailable")}
			</dd>
			<dt className="text-text-muted">{text("property.height")}</dt>
			<dd>
				{height === null
					? text("common.status.unavailable")
					: text("pokemon-details.height-value", { value: height })}
			</dd>
			<dt className="text-text-muted">{text("property.weight")}</dt>
			<dd>
				{weight === null
					? text("common.status.unavailable")
					: text("pokemon-details.weight-value", { value: weight })}
			</dd>
		</dl>
	);
};
