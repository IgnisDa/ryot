import { PgDialect } from "drizzle-orm/pg-core";

import { createQueryCompiler, createScalarExpressionCompiler } from "./expression-compiler";
import { createExpressionTypeResolver } from "./expression-type-resolver";

export const dialect = new PgDialect();

export const createScalarTestCompiler = (
	input: Omit<Parameters<typeof createScalarExpressionCompiler>[0], "getTypeInfo">,
) => {
	const getTypeInfo = createExpressionTypeResolver({
		context: input.context,
		computedFields: input.computedFields,
	});

	return createScalarExpressionCompiler({ ...input, getTypeInfo });
};

export const createQueryTestCompiler = (
	input: Omit<Parameters<typeof createQueryCompiler>[0], "getTypeInfo">,
) => {
	const getTypeInfo = createExpressionTypeResolver({
		context: input.context,
		computedFields: input.computedFields,
	});

	return createQueryCompiler({ ...input, getTypeInfo });
};
