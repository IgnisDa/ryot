// The single-use generic functions are the strict type-equality mechanism (they let
// `Equal` distinguish `any` from other types), so the rule is a false positive here.
// oxlint-disable typescript/no-unnecessary-type-parameters
export type Equal<X, Y> =
	(<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

export type Expect<T extends true> = T;
