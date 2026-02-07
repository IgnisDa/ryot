import { Schema as S } from "effect";
import { Schema as SdkSchema } from "@ryot/sandbox-sdk/effect";
import { Schema as WorkflowSchema } from "@ryot/sandbox-sdk/workflow";
import { Schema as OtherSchema } from "other";

const direct = S.String.pipe(S.check(S.makeFilter((value) => value.length > 0)));
const sdk = SdkSchema.String.pipe(SdkSchema.check(SdkSchema.makeFilter((value) => value.length > 0)));
const workflow = WorkflowSchema.String.pipe(WorkflowSchema.check(WorkflowSchema.makeFilter((value) => value.length > 0)));
const other = OtherSchema.filter((value) => value.length > 0);
const shadowed = (Schema: any) => Schema.filter((value: string) => value.length > 0);
for (const Schema of schemas) Schema.filter((value: string) => value.length > 0);
