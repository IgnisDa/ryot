# RyotQL Recipes

- Keep a recipe's result schema, decoder, and decoded type in the same module as the recipe. Reusable wire codecs belong in `@ryot-app/contract`.
- Saved-view layouts project one table shape. Cards come from registered entity presentations, not from projected display slots.
- Saved-view projections always select `populationStatus` and `translationStatus` under reserved keys declared once in `saved-views.ts`, and decode them into each item's `sync`. They are intrinsic entity state, not configurable presentation slots, so they never appear in `mappings` and a layout can neither map nor omit them. `validateMappedFields` checks only mapped fields, which is what makes the extra selections legal.
- A projection takes the entity `TableReference`, not a bare entity-ID expression: the reserved sync columns have to come from the same table alias as the row, and no call site may spell them itself.
