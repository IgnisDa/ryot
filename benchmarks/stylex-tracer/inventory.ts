/* oxlint-disable perfectionist/sort-objects -- Inventory keys follow the generated report schema. */
export type InventoryClassification =
	| "permanent-stylex"
	| "experiment-only"
	| "general-safeguard"
	| "tailwind-removable"
	| "candidate-ui"
	| "disposable-ui";

export type InventoryItem = {
	readonly classification: InventoryClassification;
	readonly path: string;
	readonly lines: readonly [number, number];
	readonly symbol: string;
	readonly responsibility: string;
	readonly disposition: string;
	readonly dependencies: readonly string[];
};

export const accountingInventory: readonly InventoryItem[] = [
	{
		classification: "permanent-stylex",
		path: "packages/client-plugin-compiler/src/stylex-tracer.ts",
		lines: [667, 856],
		symbol: "createStylexTracerBundleAdapter",
		responsibility:
			"Bounded trusted/archive materialization, custom resolution, Babel StyleX transform, rule collection, and cleanup.",
		disposition: "Retain after removing tracer naming and narrow it to the adopted client scope.",
		dependencies: ["@babel/core", "@stylexjs/babel-plugin", "@stylexjs/stylex"],
	},
	{
		classification: "permanent-stylex",
		path: "packages/client-plugin-compiler/src/stylex-tracer.ts",
		lines: [857, 869],
		symbol: "compileStylexTracerStyles",
		responsibility: "Process extracted StyleX rules and combine reset, fonts, and build marker.",
		disposition: "Retain extraction; reconsider experiment marker/reset placement for production.",
		dependencies: ["@stylexjs/babel-plugin"],
	},
	{
		classification: "permanent-stylex",
		path: "packages/client-plugin-compiler/src/stylex-tracer.ts",
		lines: [202, 437],
		symbol: "validateStylexAuthoringConvention and AST helpers",
		responsibility:
			"Enforce checked StyleX declaration shapes before Babel transformation by probing the parsed AST.",
		disposition:
			"Retain if the convention is adopted; review the broad object/property probing whenever the parser AST shape changes.",
		dependencies: ["oxc-parser"],
	},
	{
		classification: "permanent-stylex",
		path: "packages/client-plugin-compiler/src/stylex-tracer.ts",
		lines: [60, 178],
		symbol: "deriveStylexTracerBuildFingerprint and tracerDependencyInputs",
		responsibility:
			"Hash compiler, trusted source, package, runtime, lockfile, and font inputs at module startup.",
		disposition:
			"Retain build invalidation but replace tracer naming and review the broad startup read set for an adopted scope.",
		dependencies: ["@ryot-app/ts-utils"],
	},
	{
		classification: "permanent-stylex",
		path: "packages/client-plugin-compiler/src/dependencies.ts",
		lines: [85, 96],
		symbol: "resolveStylexTracerTypeScriptEntries",
		responsibility: "Provide TypeScript entries for the StyleX runtime and trusted UI modules.",
		disposition: "Retain with the adopted public authoring surface.",
		dependencies: ["@stylexjs/stylex"],
	},
	{
		classification: "experiment-only",
		path: "packages/client-plugin-compiler/src/stylex-tracer.ts",
		lines: [19, 58],
		symbol: "tracer modules, reset, options, and adapter identity",
		responsibility:
			"Exact experiment allowlist, tracer reset, pinned options, and tracer build identity.",
		disposition:
			"Remove tracer-specific names and coexistence identity; retain only adopted options/reset requirements.",
		dependencies: ["@stylexjs/stylex", "@stylexjs/babel-plugin"],
	},
	{
		classification: "experiment-only",
		path: "kernel/backend/src/modules/plugins/stylex-tracer-activation.ts",
		lines: [1, 31],
		symbol: "StylexTracerActivation",
		responsibility: "Exact-slug, opt-in backend activation seam.",
		disposition: "Delete after adoption or rejection.",
		dependencies: [],
	},
	{
		classification: "experiment-only",
		path: "kernel/client/src/routes/_authenticated/stylex-tracer-kernel.tsx",
		lines: [1, 19],
		symbol: "Route",
		responsibility: "Opt-in kernel demonstration route.",
		disposition: "Delete after the decision.",
		dependencies: ["@stylexjs/unplugin"],
	},
	{
		classification: "experiment-only",
		path: "plugins/stylex-tracer/client/page.tsx",
		lines: [1, 86],
		symbol: "StylexTracerPage",
		responsibility: "Archived proof-page adapter and local token demonstration.",
		disposition: "Delete after the decision; it is not product UI.",
		dependencies: ["@stylexjs/stylex", "@ryot-app/client-ui-sdk/stylex-tracer"],
	},
	{
		classification: "general-safeguard",
		path: "packages/client-plugin-compiler/src/compile.ts",
		lines: [273, 512],
		symbol: "compileClientPlugin input preparation",
		responsibility: "Graph/path checks, limits, UTF-8 decoding, and content-addressed asset names.",
		disposition: "Retain independent of styling engine.",
		dependencies: ["@ryot-app/client-plugin-contract"],
	},
	{
		classification: "general-safeguard",
		path: "packages/client-plugin-compiler/src/source-imports.ts",
		lines: [1, 173],
		symbol: "validateOriginalClientImports",
		responsibility: "Validate original imports before transforms can erase policy evidence.",
		disposition: "Retain; StyleX extends its exact policy but does not own the safeguard.",
		dependencies: ["oxc-parser"],
	},
	{
		classification: "general-safeguard",
		path: "packages/client-plugin-compiler/src/semantic-check.ts",
		lines: [35, 89],
		symbol: "checkClientPluginTypes",
		responsibility: "TypeScript semantic checking of original reachable sources.",
		disposition: "Retain independent of styling engine.",
		dependencies: ["@ryot-app/typescript-compiler"],
	},
	{
		classification: "general-safeguard",
		path: "packages/client-plugin-compiler/src/compile.ts",
		lines: [697, 821],
		symbol: "reachable limits and artifact construction",
		responsibility:
			"Reachability limits, asset deduplication, hashing, document construction, and artifact limits.",
		disposition: "Retain independent of styling engine.",
		dependencies: ["@ryot-app/client-plugin-contract"],
	},
	{
		classification: "tailwind-removable",
		path: "packages/client-plugin-compiler/src/styles.ts",
		lines: [194, 276],
		symbol: "compileClientStyles",
		responsibility:
			"Inject Tailwind, scan candidates, build utilities, and combine legacy theme/palette CSS.",
		disposition:
			"Remove only for an in-scope StyleX-only client; preserve generic stylesheet asset rewriting separately.",
		dependencies: ["tailwindcss", "@tailwindcss/oxide", "postcss"],
	},
	{
		classification: "tailwind-removable",
		path: "packages/client-plugin-compiler/src/dependencies.ts",
		lines: [196, 214],
		symbol: "ordinary compiler dependency branch",
		responsibility:
			"Read SDK scan sources, Tailwind entry, theme stylesheet, and palette stylesheet.",
		disposition:
			"Remove from the adopted in-scope client path; excluded repository consumers still use Tailwind.",
		dependencies: ["tailwindcss", "@ryot-app/client-ui-sdk"],
	},
	{
		classification: "candidate-ui",
		path: "packages/client-ui-sdk/src/stylex-tracer/controls.tsx",
		lines: [1, 198],
		symbol: "StyleXTracerButton and StyleXTracerTextField",
		responsibility: "Semantic accessible controls with constrained StyleX overrides.",
		disposition:
			"Candidate patterns, not production-ready components without API/design-system review.",
		dependencies: ["@stylexjs/stylex", "react"],
	},
	{
		classification: "candidate-ui",
		path: "packages/client-ui-sdk/src/stylex-tracer/tokens.stylex.ts",
		lines: [1, 56],
		symbol: "tracerTokens and tracerTheme",
		responsibility: "Typed token and theme authoring proof.",
		disposition:
			"Retain the authoring pattern only; replace demonstration values under a real token contract.",
		dependencies: ["@stylexjs/stylex"],
	},
	{
		classification: "disposable-ui",
		path: "packages/client-ui-sdk/src/stylex-tracer/panel.tsx",
		lines: [1, 318],
		symbol: "StyleXTracerPanel",
		responsibility: "Interactive demonstration panel, portal, shortcut, theme, and viewport proof.",
		disposition: "Delete after the decision; product behavior was not established.",
		dependencies: ["@stylexjs/stylex", "@tanstack/react-hotkeys", "react-dom"],
	},
	{
		classification: "disposable-ui",
		path: "benchmarks/stylex-tracer/fixture/tailwind/page.tsx",
		lines: [1, 168],
		symbol: "TailwindTracerPage",
		responsibility: "Benchmark-only semantic comparison adapter.",
		disposition: "Delete when benchmark evidence is no longer retained.",
		dependencies: ["tailwindcss"],
	},
] as const;
