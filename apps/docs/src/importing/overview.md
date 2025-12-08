# Importing

Importing is meant to be a one-time operation. They are irreversible, i.e., importing from
the same source twice will create duplicates. I recommend you to make a
[database backup](../exporting.md#exporting-the-entire-database)
before starting an import.

An import can fail at various steps for a specific item. Ryot creates a report when an
import completes/fails. You can see them in the "Import" tab of the imports and exports page.

## Notes

- This will only import items that have been completed. To import items that are in
  progress, you need to set up an [integration](../integrations/overview.md) or update
  the progress manually.
- Imports are very difficult to have 100% success rate. Though we try our best,
  you might have to manually import some data from your previous provider.
- Imports might take a long time since Ryot needs to fetch all metadata from the sources
  before it can start importing progress. Estimated finish time is displayed in the UI.
- I recommend turning on debug logging for the duration of the import using the
  `RUST_LOG=ryot=debug` environment variable. This will help you help you see import
  progress in the docker logs.
- If your importing goes wrong, you can always reset the user data from the user settings.
  Keep in mind that this will delete ALL data for that user.
