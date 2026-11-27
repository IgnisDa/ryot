import {
	CommitConflictCode,
	UserCommand,
	UserCommandResult,
} from "@ryot-app/contract/modules/mutations/user-command";
import { Schema } from "effect";

import { hostResultSchema, type SandboxHostError } from "../wire";

export const commitUserChangesArgsSchema = Schema.Tuple([UserCommand]);
export const commitUserChangesResultSchema = hostResultSchema(UserCommandResult);

const CommitConflict = Schema.Struct({ code: CommitConflictCode });

export const isCommitConflict = (error: SandboxHostError) => Schema.is(CommitConflict)(error.data);
