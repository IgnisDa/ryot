# Rules for Ryot

- The project uses `moon` for monorepo management. All frontend related commands (like
  typecheck, running tests etc.) should use moon commands. You can read
  `apps/docs/src/contributing.md` for a overview on project architecture.
- When running tests, the backend needs to be compiled in release mode. Since this takes a
  lot of time, thus we prefer to run tests only after the feature has been implemented.
  Always ask the user approval to run tests.
- After adding a graphql query/mutation to the backend, always run the command to
  regenerate graphql types. You can check the relevant moon.yml for the correct command.
- Do not add code comments unless strictly necessary.
- When adding code, please make sure attributes are always ordered by the line length. For
  example:

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

  For equal length, make sure the attribute names are alphabetically arranged.

- The migration files should be named `m<date>_changes_for_issue_<number>`.
- We do not have down migrations since we always roll forward. It should just be an empty
  block with `Ok(())`.
- Since this an open-source project, we have a slightly different approach to writing
  migrations. When adding a migration with a schema change, if the table you are working
  with already exists, then the same change should be applied to the migration where this
  table was first created. We need to do this so that new instances of Ryot can have the
  same table structure right off the bat.
