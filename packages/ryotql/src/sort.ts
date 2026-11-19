import type { BrowseSort } from "@ryot-app/contract/modules/filters/sort";
import type {
	OrderBy,
	Predicate,
	ScalarExpression,
} from "@ryot-app/contract/modules/ryotql/authored";
import { Result } from "effect";

import { ascending, conditional, descending, literal } from "./index";

export type SortTarget = BrowseSort & {
	readonly key: string;
	readonly branches: readonly [SortBranch, ...SortBranch[]];
};
type SortBranch = { readonly value: ScalarExpression; readonly when?: Predicate | undefined };
const sortValue = (branches: readonly SortBranch[]) =>
	branches.reduceRight<ScalarExpression>(
		(otherwise, branch) =>
			branch.when === undefined ? branch.value : conditional(branch.when, branch.value, otherwise),
		literal(null),
	);

/** Orders by a sort choice, then entity ID; rows without a value sort last. */
export const compileSort = (
	targets: readonly SortTarget[],
	choice: string,
	entityId: ScalarExpression,
): Result.Result<readonly OrderBy[], Error> => {
	for (const target of targets) {
		if (choice === `${target.key}-asc`) {
			return Result.succeed([ascending(sortValue(target.branches)), ascending(entityId)]);
		}
		if (choice === `${target.key}-desc`) {
			return Result.succeed([descending(sortValue(target.branches)), ascending(entityId)]);
		}
	}
	return Result.fail(new Error(`Sort choice '${choice}' is not available`));
};
