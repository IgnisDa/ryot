import { Effect as Fx, Result as Outcome } from "@ryot/sandbox-sdk/effect";

const owned = Outcome.fail("failed");

const run = Fx.gen(function* () {
	const result = yield* Fx.result(Fx.succeed(1));
	return Outcome.isSuccess(result) ? result.success : result.failure;
});

const shadowed = (Outcome: { left: (value: string) => string }, Fx: { either: string }) => [
	Outcome.left("ordinary"),
	Fx.either,
];
const queryAst = { left: "column", right: "value" };
const savedView = { left: "filter", right: "expression" };
const childProcessCommand = { left: "command", right: "args" };
const ordinary = { left: 1, right: 2 };

void [
	owned,
	run,
	shadowed,
	queryAst.left,
	queryAst.right,
	savedView.left,
	savedView.right,
	childProcessCommand.left,
	childProcessCommand.right,
	ordinary.left,
	ordinary.right,
];
