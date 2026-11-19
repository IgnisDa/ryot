import type { AuthoredPluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import type { ManifestText } from "@ryot-app/contract/modules/plugins/manifest-text";
import { manifestCatalogs } from "@ryot-app/contract/testing";

/** The English of every fixture display text, for the catalog `manifestCatalogs` builds. */
export const manifestEnglish: Record<string, string> = {};

const slugOf = (text: string) =>
	text
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, " ")
		.trim()
		.split(/\s+/)
		.slice(0, 8)
		.join("-")
		.slice(0, 96)
		.replace(/-+$/, "") || "text";

/** Fixture display text whose English is recorded in `manifestEnglish`. */
export const manifestText = (text: string): ManifestText => {
	const base = `e2e.text-${slugOf(text)}`;
	let key = base;
	for (let suffix = 2; key in manifestEnglish && manifestEnglish[key] !== text; suffix += 1) {
		key = `${base}-${suffix}`;
	}
	manifestEnglish[key] = text;
	return { key };
};

/** The catalogs of a fixture manifest, plus fixture text that only its client code renders. */
export const fixtureCatalogs = (
	manifest: AuthoredPluginManifest,
	clientTexts: readonly ManifestText[],
) => {
	const catalogs = manifestCatalogs(manifest, manifestEnglish);
	return {
		...catalogs,
		en: {
			...catalogs.en,
			...Object.fromEntries(
				clientTexts.map(({ key }) => [
					key,
					[{ type: 0 as const, value: manifestEnglish[key] ?? key }],
				]),
			),
		},
	};
};
