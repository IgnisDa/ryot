# Rules for Ryot

- The project uses moon for mono repo management. So all commands (like typecheck, running tests etc) should use moon commands.
- After adding a graphql query/mutation to the backend, always run the command to regenerate graphql types. You can check the relevant moon.yml for the correct command.
- Do not add code comments unless strictly necessary.
- When adding code, please make sure attributes are always ordered by the line length. For example:

  ```tsx
  <TextInput
    label="New Password (Generated)"
    value={resetPassword}
    readOnly
    description="This is the new password for the user"
  />
  ```

  should be:

  ```tsx
  <TextInput
    readOnly
    value={resetPassword}
    label="New Password (Generated)"
    description="This is the new password for the user"
  />
  ```

  Another example in rust:

  ```rs
  #[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
  pub struct PersonDetailsGroupedByRole {
      pub items: Vec<PersonDetailsItemWithCharacter>,
      pub name: String,
  }
  ```

  should be:

  ```rs
  #[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
  pub struct PersonDetailsGroupedByRole {
      pub name: String,
      pub items: Vec<PersonDetailsItemWithCharacter>,
  }
  ```
