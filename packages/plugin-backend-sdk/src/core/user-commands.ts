import { UserCommand, UserCommandResult } from "@ryot-app/contract/modules/mutations/user-command";
import { Schema } from "effect";

import { hostResultSchema } from "../wire";
import { optionalSubmissionOptions } from "./writes";

export const commitUserChangesArgsSchema = Schema.Tuple([UserCommand, optionalSubmissionOptions]);
export const commitUserChangesResultSchema = hostResultSchema(UserCommandResult);
