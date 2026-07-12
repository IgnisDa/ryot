import * as EffectPackage from "effect";
import { Schema } from "effect";

const value = Schema.optionalWith(Schema.String, { default: () => currentValue() });

void value;
