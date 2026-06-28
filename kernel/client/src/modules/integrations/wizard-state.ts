import { Match } from "effect";

export const WIZARD_STEPS = ["pick", "configure", "review"] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

export type WizardState = {
	readonly step: WizardStep;
	readonly slug: string | undefined;
};

export type WizardAction =
	| { readonly type: "back" }
	| { readonly type: "review-requested" }
	| { readonly type: "picked"; readonly slug: string }
	| { readonly type: "recover-at"; readonly step: WizardStep };

const stepHeadings = {
	pick: "Choose a service",
	review: "Review and connect",
	configure: "Provide the details",
} as const satisfies Record<WizardStep, string>;

const previousStep = {
	pick: "pick",
	review: "configure",
	configure: "pick",
} as const satisfies Record<WizardStep, WizardStep>;

export const createWizardState = (): WizardState => ({ step: "pick", slug: undefined });

export const wizardStepLabel = (step: WizardStep) =>
	`Step ${WIZARD_STEPS.indexOf(step) + 1} of ${WIZARD_STEPS.length} · ${stepHeadings[step]}`;

export const wizardReducer = (state: WizardState, action: WizardAction): WizardState =>
	Match.value(action).pipe(
		Match.when({ type: "back" }, () => ({ ...state, step: previousStep[state.step] })),
		Match.when(
			{ type: "picked" },
			(picked): WizardState => ({ step: "configure", slug: picked.slug }),
		),
		Match.when({ type: "recover-at" }, (recovery) =>
			state.slug === undefined ? state : { ...state, step: recovery.step },
		),
		Match.when(
			{ type: "review-requested" },
			(): WizardState =>
				state.step === "configure" && state.slug !== undefined
					? { ...state, step: "review" }
					: state,
		),
		Match.exhaustive,
	);
