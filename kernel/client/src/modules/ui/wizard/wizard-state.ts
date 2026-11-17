import type { Message } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Match } from "effect";

/**
 * The shape the catalog wizards share: pick an entry, fill in the schema it declares, then confirm.
 * Entries may be contributed by a plugin or owned by the kernel. Features supply their own headings
 * for these steps.
 */
export const WIZARD_STEPS = ["pick", "configure", "review"] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

export type WizardStepHeadings = Record<WizardStep, string>;

export type WizardState = { readonly step: WizardStep; readonly slug: string | undefined };

export type WizardAction =
	| { readonly type: "back" }
	| { readonly type: "review-requested" }
	| { readonly slug: string; readonly type: "picked" }
	| { readonly step: WizardStep; readonly type: "recover-at" };

const previousStep = {
	pick: "pick",
	configure: "pick",
	review: "configure",
} as const satisfies Record<WizardStep, WizardStep>;

export const createWizardState = (): WizardState => ({ step: "pick", slug: undefined });

export const wizardStepLabel = <Step extends string>(
	step: Step,
	steps: readonly Step[],
	headings: Record<Step, string>,
): Message =>
	kernelMessage("client.ui.wizard.step", {
		total: steps.length,
		heading: headings[step],
		current: steps.indexOf(step) + 1,
	});

export const wizardReducer = (state: WizardState, action: WizardAction): WizardState =>
	Match.value(action).pipe(
		Match.when({ type: "back" }, () => ({ ...state, step: previousStep[state.step] })),
		Match.when({ type: "picked" }, (picked): WizardState => ({
			step: "configure",
			slug: picked.slug,
		})),
		Match.when({ type: "recover-at" }, (recovery) =>
			state.slug === undefined ? state : { ...state, step: recovery.step },
		),
		Match.when({ type: "review-requested" }, (): WizardState =>
			state.step === "configure" && state.slug !== undefined ? { ...state, step: "review" } : state,
		),
		Match.exhaustive,
	);
