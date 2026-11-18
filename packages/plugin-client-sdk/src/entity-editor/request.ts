import type {
	EntityEditorSaveRequest,
	EntityEditorSubmission,
} from "@ryot-app/contract/modules/entities/editor";
import { createUuid } from "@ryot-app/ts-utils/uuid";

export const retryableEntityEditorSaveRequest = (
	previous: undefined | EntityEditorSaveRequest,
	submission: EntityEditorSubmission,
	now: Date,
): EntityEditorSaveRequest =>
	previous !== undefined && JSON.stringify(previous.submission) === JSON.stringify(submission)
		? previous
		: { submission, idempotencyKey: createUuid(), submittedAt: now.toISOString() };
