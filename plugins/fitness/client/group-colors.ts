import { groupColorVariable } from "@ryot-app/plugin-ui-sdk";

import { supersetColor } from "../shared/superset-colors";

export const supersetColorVariable = (color: string, options?: { readonly soft?: boolean }) =>
	groupColorVariable(supersetColor(color), options);

export const supersetLetter = (index: number) => String.fromCharCode(65 + (index % 26));

export const supersetName = (index: number) => `Superset ${supersetLetter(index)}`;
