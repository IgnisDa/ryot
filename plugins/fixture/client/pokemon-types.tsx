import { useMessages } from "@ryot-app/plugin-client-sdk/react";

import { catalogMessage } from "../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../shared/plugin-identity";

export type PokemonTypesProps = { readonly name: string; readonly types: readonly string[] };

const PokemonTypes = ({ name, types }: PokemonTypesProps) => {
	const text = useMessages(PLUGIN_PACKAGE_ID, catalogMessage);
	const title = text("pokemon-types.title", { name });
	return (
		<section className="rounded-lg border border-border bg-surface p-4 text-text">
			<h3 className="font-display text-lg">{title}</h3>
			<div aria-label={title} className="mt-2 flex flex-wrap gap-2">
				{types.length === 0 && (
					<span className="text-sm text-text-muted">{text("common.status.unavailable")}</span>
				)}
				{types.map((type) => (
					<span
						key={type}
						className="rounded-full border border-accent bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-text"
					>
						{type}
					</span>
				))}
			</div>
		</section>
	);
};

export default PokemonTypes;
