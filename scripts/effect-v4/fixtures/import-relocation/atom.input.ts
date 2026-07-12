import {
	RegistryProvider as Provider,
	useAtomRefresh,
	useAtomSet as setAtom,
	useAtomValue,
	Atom as StateAtom,
	type AtomHttpApi as ApiType,
	Result as LoadResult,
} from "@effect-atom/atom-react";

export type Api = ApiType;
export const result = LoadResult.builder;
export const bindings = [Provider, useAtomRefresh, setAtom, useAtomValue, StateAtom];
export const shadowed = (LoadResult: string) => LoadResult;
