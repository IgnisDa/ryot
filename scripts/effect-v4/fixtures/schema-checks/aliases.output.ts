import { Schema as S } from "effect";
import { Schema as Sdk } from "@ryot/sandbox-sdk/effect";
import { Schema as Workflow } from "@ryot/sandbox-sdk/workflow";

const first = S.Number.pipe(S.check(S.isInt()));
const second = Sdk.String.pipe(Sdk.check(Sdk.isMinLength(1)));
const third = Workflow.String.pipe(Workflow.check(Workflow.isNonEmpty()));
