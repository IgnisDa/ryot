import type { DiscoveryInput } from "@ryot-app/contract/schema/agent-tool";
import { capabilityOwner } from "@ryot-app/contract/schema/capability";
import { sortBy } from "@ryot-app/ts-utils/lodash";

export type Discoverable = {
	readonly id: string;
	readonly fields: string;
	readonly description: string;
};

const tokens = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

const score = (item: Discoverable, terms: readonly string[]) => {
	const id = item.id.toLowerCase();
	const description = item.description.toLowerCase();
	const fields = item.fields.toLowerCase();
	return terms.reduce(
		(total, term) =>
			total +
			(id.includes(term) ? 5 : 0) +
			(description.includes(term) ? 3 : 0) +
			(fields.includes(term) ? 1 : 0),
		0,
	);
};

export const discover = <A>(
	items: readonly A[],
	discoverable: (item: A) => Discoverable,
	input: DiscoveryInput,
): null | { readonly total: number; readonly selected: readonly A[] } => {
	const terms = tokens(input.query ?? "");
	if (terms.length === 0 && input.namespace == null) {
		return null;
	}
	const candidates = items.filter(
		(item) => input.namespace == null || capabilityOwner(discoverable(item).id) === input.namespace,
	);
	const ranked =
		terms.length === 0
			? candidates
			: sortBy(
					candidates
						.map((item) => ({ item, score: score(discoverable(item), terms) }))
						.filter((entry) => entry.score > 0),
					[(entry) => -entry.score, (entry) => discoverable(entry.item).id],
				).map((entry) => entry.item);
	return { total: ranked.length, selected: ranked.slice(0, input.limit ?? 10) };
};

export const discoveryInstruction = "Search with a query, a namespace, or both.";
