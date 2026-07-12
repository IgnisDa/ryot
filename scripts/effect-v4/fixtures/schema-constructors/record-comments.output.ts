import { Schema } from "effect";

const key = Schema.String;
const value = Schema.Number;

const ordered = Schema.Record(Schema.String, Schema.Number);
const shorthand = Schema.Record(key, value);
const comments = Schema.Record(// key comment
Schema.String, // value comment
Schema.Number);
