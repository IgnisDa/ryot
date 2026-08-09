import { toTitleCase as toBaseTitleCase } from "./title-case";

export const toTitleCase = (value: string) => toBaseTitleCase(value.replace(/[_-]+/g, " "));
