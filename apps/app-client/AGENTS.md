# App Client Guidelines

## Forms

All form text inputs must be submittable via the Enter key. Use `onSubmitEditing` on the last field to trigger submission, and `returnKeyType="go"` to label the action key appropriately. For multi-field forms, intermediate fields should use `returnKeyType="next"` and move focus to the next field on submit.
