import { Match } from "effect";

export const IMPORT_WIZARD_STEPS = ["source", "input", "review"] as const;

export type ImportWizardStep = (typeof IMPORT_WIZARD_STEPS)[number];

export type ImportWizardState = {
	readonly step: ImportWizardStep;
	readonly sourceSlug: string | undefined;
};

export type ImportWizardAction =
	| { readonly type: "back" }
	| { readonly type: "reset" }
	| { readonly type: "review-requested" }
	| { readonly type: "source-chosen"; readonly slug: string }
	| { readonly type: "recover-at"; readonly step: ImportWizardStep };

const stepHeadings = {
	source: "Choose a service",
	review: "Review and start",
	input: "Provide the details",
} as const satisfies Record<ImportWizardStep, string>;

const previousStep = {
	source: "source",
	review: "input",
	input: "source",
} as const satisfies Record<ImportWizardStep, ImportWizardStep>;

export const importWizardStepLabel = (step: ImportWizardStep) =>
	`Step ${IMPORT_WIZARD_STEPS.indexOf(step) + 1} of ${IMPORT_WIZARD_STEPS.length} · ${stepHeadings[step]}`;

export const createImportWizardState = (): ImportWizardState => ({
	step: "source",
	sourceSlug: undefined,
});

export const importWizardReducer = (
	state: ImportWizardState,
	action: ImportWizardAction,
): ImportWizardState =>
	Match.value(action).pipe(
		Match.when({ type: "reset" }, createImportWizardState),
		Match.when({ type: "back" }, () => ({ ...state, step: previousStep[state.step] })),
		Match.when(
			{ type: "source-chosen" },
			(chosen): ImportWizardState => ({ step: "input", sourceSlug: chosen.slug }),
		),
		Match.when({ type: "recover-at" }, (recovery) =>
			state.sourceSlug === undefined ? state : { ...state, step: recovery.step },
		),
		Match.when(
			{ type: "review-requested" },
			(): ImportWizardState =>
				state.step === "input" && state.sourceSlug !== undefined
					? { ...state, step: "review" }
					: state,
		),
		Match.exhaustive,
	);
