import type { NavigateFunction } from "@remix-run/react";
import { atom, useAtom } from "jotai";
import type { ReactNode } from "react";

const filtersModalData = atom<{
	title?: string;
	cookieName: string;
	children: ReactNode;
	navigate: NavigateFunction;
} | null>(null);

export const useFiltersModalData = () => useAtom(filtersModalData);
