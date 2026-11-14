# Pages

Pages are custom screens built from source files. Open **Settings → Pages** to create or manage them.

1. Choose **New page**, enter a name and a unique slug.
2. Set the entry file, plugin dependencies and declared RyotQL query document. Use `{}` for dependencies and `{"queries": {}}` for a page without queries.
3. Enter a destination path under `client/` or `shared/`, then upload a file or paste its source and choose **Add pasted file**. Repeat for supporting files and assets. Adding the same path replaces that file. Assets are preserved as bytes.
4. Choose **Create draft**, then **Compile draft**. Compilation errors show the file, line and diagnostic. Replace the affected files, save the draft and compile again.
5. Choose **Preview compiled draft** to open the compiled page. Previews are always read-only. Changing or replacing the draft invalidates its preview; save and compile again to preview those changes.
6. Choose **Publish** when ready, then **Create view and open** to add the published page to navigation.

A minimal `client/page.tsx` file looks like this:

```tsx
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";

export default function Page() {
  return (
    <PluginScreenFrame title="My page">
      <p>Hello!</p>
    </PluginScreenFrame>
  );
}
```

Draft changes do not change the published page until you publish again. Page code controls query arguments, filters, sorting and paging; saved views have no separate page settings or query bindings.

Pages start without permission to run write operations. Use **Grant write access** to allow a published page to run operations, or **Revoke write access** to withdraw that permission. Assistant edits revoke the grant. Granting access never enables writes in a draft preview.

If someone changes the draft while you are editing, saving reports a conflict. **Reload latest draft (discard local changes)** explicitly loads their draft; save your local files elsewhere first if you need to keep them.

Delete any saved views or publications using a page before deleting it. Page changes are unavailable in demo sessions.
