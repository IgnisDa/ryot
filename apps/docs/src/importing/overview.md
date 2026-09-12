# Importing

Open **Settings > Import data** to start an import.

Imports continue if you close Ryot or restart the server. Each import uses the plugin and
configuration that were active when it started, so later configuration changes apply only to new
imports. If an administrator changes an environment variable, cancel the current import and start
a new one to use the new value.

::: warning
Imports are one-time operations. A repeated import can create duplicates. Make a
[whole-server backup](../backups.md#whole-server-backups) first.
:::

## Limitations

- Most imports add completed items only. Use an [integration](../integrations/overview.md) or update
  progress manually for in-progress items.
- Provider data cannot always be matched. Review the report after the import and add failed items
  manually.
- Metadata requests can make large imports slow.
- Set `SERVER_LOG_LEVEL=debug` temporarily to show import progress in file or OTLP logs.

## Import reports

Each import shows its progress step by step. A percentage appears only when Ryot knows the exact
total. Results separate created, updated, unchanged, skipped, and failed records. Reading the source
or fetching provider data does not mean your history was saved yet.

Warnings and errors show which record failed and why. Use **Download issues** to save the full list,
including why the import stopped. The download does not include your uploaded data or credentials.

Deleting an import report removes its details, not the data the import added.

## Cancel an import

Open the active import in **Settings > Import data**, open **Import actions**, and select **Cancel
import**. The import may show **Cancelling** for a short time while current work stops and temporary
files are cleaned up.

Cancellation stops future work. Items already added remain in your library, and the import record
keeps its partial counts and failures.

::: danger
Resetting user data can recover from a bad import, but it permanently deletes all data for that
user.
:::
