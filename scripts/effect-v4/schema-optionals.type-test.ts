import { Schema } from "effect";

type Equal<Left, Right> =
	(<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
		? true
		: false;
type Expect<Value extends true> = Value;

const schema = Schema.Tuple([
	Schema.String,
	Schema.NumberFromString,
	Schema.optionalKey(Schema.NumberFromString),
]);

type Type = Expect<
	Equal<(typeof schema)["Type"], readonly [string, number, number?]>
>;
type Encoded = Expect<
	Equal<(typeof schema)["Encoded"], readonly [string, string, string?]>
>;

void (0 as unknown as Type);
void (0 as unknown as Encoded);
