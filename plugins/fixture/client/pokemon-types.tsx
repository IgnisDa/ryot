export type PokemonTypesProps = {
	readonly name: string;
	readonly types: readonly string[];
};

const PokemonTypes = ({ name, types }: PokemonTypesProps) => (
	<section className="rounded-lg border border-border bg-surface p-4 text-text">
		<h3 className="font-display text-lg">{name} types</h3>
		<div className="mt-2 flex flex-wrap gap-2" aria-label={`${name} types`}>
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

export default PokemonTypes;
