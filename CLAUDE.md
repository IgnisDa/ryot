# Rules for Ryot

- The project uses `moon` for monorepo management. All front-end related commands (like
  typecheck, running tests etc.) should use moon commands. You can read
  `apps/docs/src/contributing.md` for an overview on the architecture.
- When running tests, the backend needs to be compiled in release mode. Since this takes a
  lot of time, we prefer to run tests only after the feature has been implemented. Always
  ask for the user's approval to run tests.
- After adding a graphql query/mutation to the backend, always run the command to
  regenerate graphql types. You can check the relevant moon.yml for the correct command.
- Do not add code comments unless strictly necessary.
- When adding code, attributes should be ordered by line length (ascending). For
  example:

  ```tsx
  <TextInput
    label="New Password (Generated)"
    value={resetPassword}
    readOnly
    description="This is the new password for the user"
  />
  ```

  It should be:

  ```tsx
  <TextInput
    readOnly
    value={resetPassword}
    label="New Password (Generated)"
    description="This is the new password for the user"
  />
  ```

  Another example in Rust:

  ```rs
  #[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
  pub struct PersonDetailsGroupedByRole {
      pub items: Vec<PersonDetailsItemWithCharacter>,
      pub name: String,
  }
  ```

  It should be:

  ```rs
  #[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
  pub struct PersonDetailsGroupedByRole {
      pub name: String,
      pub items: Vec<PersonDetailsItemWithCharacter>,
  }
  ```

  When lengths are equal, the attributes should be arranged alphabetically.

- The migration files should be named `m<date>_changes_for_issue_<number>`. Read the other
  migration files for examples.
- We do not have down migrations since we always roll forward. It should just be an empty
  block with `Ok(())`.
- Since this is an open-source project, we have a slightly different approach to writing
  migrations. When adding a migration with a schema change, if the table you are working
  with already exists, then the same change should be applied to the migration where this
  table was first created. We need to do this so that new instances of Ryot can have the
  same table structure right off the bat.
