import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import type { BackgroundSubmissionOutcome } from "@ryot-app/plugin-client-contract";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import { useEffect, useRef, useState } from "react";

import type { RyotClientError } from "../client/errors";
import { useRyot, useRyotSchedule } from "./provider";
import { type RyotSubmission, snapshotRyotSubmission } from "./submission";

const SETTLEMENT_BUFFER = 16;

export type RyotBackgroundSubmission<
	Input,
	OperationInput extends Schema.Codec<unknown, unknown>,
> = {
	readonly slug: string;
	readonly packageId: PluginPackageId;
	readonly inputSchema: OperationInput;
	readonly label: (input: Input) => string;
	readonly input: (submission: RyotSubmission<Input>) => OperationInput["Type"];
};

export const createRyotBackgroundSubmission = <
	Input,
	OperationInput extends Schema.Codec<unknown, unknown>,
>(
	definition: RyotBackgroundSubmission<Input, OperationInput>,
) => definition;

export type RyotBackgroundSubmissionState<Input> =
	| { readonly status: "idle" }
	| { readonly status: "rejected"; readonly error: RyotClientError }
	| { readonly status: "sending"; readonly submission: RyotSubmission<Input> }
	| {
			readonly status: "accepted";
			readonly submissionId: string;
			readonly submission: RyotSubmission<Input>;
	  }
	| {
			readonly status: "settled";
			readonly submissionId: string;
			readonly submission: RyotSubmission<Input>;
			readonly outcome: BackgroundSubmissionOutcome;
	  };

export const useBackgroundSubmission = <
	Input,
	OperationInput extends Schema.Codec<unknown, unknown>,
>(
	definition: RyotBackgroundSubmission<Input, OperationInput>,
	options?: { readonly createId?: () => string },
) => {
	const client = useRyot();
	const schedule = useRyotSchedule();
	const [state, setState] = useState<RyotBackgroundSubmissionState<Input>>({ status: "idle" });
	const latest = useRef<undefined | { submissionId: string | undefined }>(undefined);
	const settled = useRef(new Map<string, BackgroundSubmissionOutcome>());

	useEffect(
		() =>
			client.operations.backgroundSettled(({ outcome, submissionId }) => {
				const current = latest.current;
				if (current?.submissionId === submissionId) {
					setState((previous) =>
						previous.status === "accepted" || previous.status === "settled"
							? { outcome, submissionId, status: "settled", submission: previous.submission }
							: previous,
					);
					return;
				}
				settled.current.set(submissionId, outcome);
				for (const key of settled.current.keys()) {
					if (settled.current.size <= SETTLEMENT_BUFFER) {
						break;
					}
					settled.current.delete(key);
				}
			}),
		[client],
	);

	const submit = (
		input: Input,
		callbacks: {
			readonly onAccepted?: () => void;
			readonly onRejected?: (error: RyotClientError) => void;
		} = {},
	) => {
		const submission = snapshotRyotSubmission(
			input,
			(options?.createId ?? (() => crypto.randomUUID()))(),
			schedule.now(),
		);
		const attempt: { submissionId: string | undefined } = { submissionId: undefined };
		latest.current = attempt;
		setState({ submission, status: "sending" });
		schedule.run(
			client.operations
				.submitBackground({
					slug: definition.slug,
					packageId: definition.packageId,
					inputSchema: definition.inputSchema,
					input: definition.input(submission),
					idempotencyKey: submission.submissionId,
					label: definition.label(submission.input),
				})
				.pipe(
					Effect.match({
						onFailure: (error) => {
							if (latest.current === attempt) {
								setState({ error, status: "rejected" });
							}
							callbacks.onRejected?.(error);
						},
						onSuccess: (submissionId) => {
							if (latest.current === attempt) {
								attempt.submissionId = submissionId;
								const outcome = settled.current.get(submissionId);
								settled.current.delete(submissionId);
								setState(
									outcome === undefined
										? { submission, submissionId, status: "accepted" }
										: { outcome, submission, submissionId, status: "settled" },
								);
							}
							callbacks.onAccepted?.();
						},
					}),
				),
			() => {},
		);
		return submission;
	};

	return {
		state,
		submit,
		isSending: state.status === "sending",
		error: state.status === "rejected" ? state.error : null,
		last: state.status === "settled" ? state.outcome : null,
	};
};
