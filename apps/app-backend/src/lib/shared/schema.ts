import { Schema } from "effect";

export const withoutSchemaServices = <S extends Schema.Constraint>(schema: S) =>
	Schema.make<S & Schema.ConstraintCodec<S["Type"], S["Encoded"]>>(schema.ast);
