import { Schema as S } from "effect";
import { Schema as Sdk } from "@ryot/sandbox-sdk/effect";
import { Schema as Workflow } from "@ryot/sandbox-sdk/workflow";

const first = S.Number.pipe(S.int());
const second = Sdk.String.pipe(Sdk.minLength(1));
const third = Workflow.String.pipe(Workflow.nonEmptyString());
