import { camelCase, startCase } from "@ryot-app/ts-utils/lodash";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/**
 * Change case to a presentable format.
 */
export const changeCase = (name: string) => startCase(camelCase(name.toLowerCase()));
