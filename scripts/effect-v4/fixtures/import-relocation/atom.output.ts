import {
    RegistryProvider as Provider,
    useAtomRefresh,
    useAtomSet as setAtom,
    useAtomValue,
} from "@effect/atom-react";

import { Atom as StateAtom, AsyncResult } from "effect/unstable/reactivity";
import type { AtomHttpApi as ApiType } from "effect/unstable/reactivity";

export type Api = ApiType;
export const result = AsyncResult.builder;
export const bindings = [Provider, useAtomRefresh, setAtom, useAtomValue, StateAtom];
export const shadowed = (LoadResult: string) => LoadResult;
