import { Schema } from "effect";

import { strictStruct as makeStrictStruct } from "../../schema/utils";

const schema = makeStrictStruct({ value: Schema.String }).annotations({ identifier: "Strict" });
