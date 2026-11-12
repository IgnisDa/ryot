import type { PluginPageSearchUpdate } from "@ryot-app/plugin-client-contract";
import type { UseNavigateResult } from "@tanstack/react-router";

const searchString = (value: string) => (value.startsWith("?") ? value.slice(1) : value);
export function navigatePageSearch(
	navigate: UseNavigateResult<string>,
	input: {
		readonly replace: boolean;
		readonly entryKey: string;
		readonly update: PluginPageSearchUpdate;
		readonly location: { readonly pathname: string; readonly searchStr: string };
	},
) {
	const next = mergePageSearch(input.location.searchStr, input.update);
	void navigate({
		replace: input.replace,
		href: `${input.location.pathname}${next === "" ? "" : `?${next}`}`,
		state: (current) => ({
			...current,
			ryotEntryKey: input.replace ? input.entryKey : crypto.randomUUID(),
		}),
	});
}

function mergePageSearch(current: string, update: PluginPageSearchUpdate) {
	const next = new URLSearchParams(searchString(current));
	for (const [key, value] of Object.entries(update)) {
		if (value === null) {
			next.delete(key);
		} else {
			next.set(key, value);
		}
	}
	return next.toString();
}
