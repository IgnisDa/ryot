import {
	CommitConflictCode,
	UserCommand,
	UserCommandResult,
} from "@ryot-app/contract/modules/mutations/user-command";
import { Schema } from "effect";

import { hostResultSchema, type SandboxHostError } from "../wire";
import { optionalSubmissionOptions } from "./writes";

export const commitUserChangesArgsSchema = Schema.Tuple([UserCommand, optionalSubmissionOptions]);
export const commitUserChangesResultSchema = hostResultSchema(UserCommandResult);

const CommitConflict = Schema.Struct({ code: CommitConflictCode });

export const isCommitConflict = (error: SandboxHostError) => Schema.is(CommitConflict)(error.data);
