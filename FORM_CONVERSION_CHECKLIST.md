# Form Conversion Checklist for Issue #1629

## Objective

Convert all frontend forms to proper HTML `<form>` elements with keyboard submission support.

## Reference Implementation

See `apps/frontend/app/components/common/filter-presets.tsx` - `CreateFilterPresetModal` component for the pattern to follow.

## Conversion Pattern

### Before (Using useState + onClick)
```tsx
const [name, setName] = useState("");

return (
  <Modal>
    <TextInput value={name} onChange={(e) => setName(e.target.value)} />
    <Button onClick={() => handleSubmit(name)}>Submit</Button>
  </Modal>
);
```

### After (Using useForm + form element)
```tsx
const form = useForm({
  mode: "uncontrolled",
  initialValues: { name: "" },
  validate: {
    name: hasLength({ min: 3 }, "Must be at least 3 characters"),
  },
});

return (
  <Modal>
    <form onSubmit={form.onSubmit((values) => {
      handleSubmit(values.name);
      form.reset();
    })}>
      <TextInput
        data-autofocus
        {...form.getInputProps("name")}
      />
      <Button type="submit">Submit</Button>
    </form>
  </Modal>
);
```

## Key Changes Required

1. Import `useForm` and validation helpers from `@mantine/form`
2. Replace `useState` calls with `useForm` initialization
3. Wrap inputs in `<form>` element with `onSubmit={form.onSubmit(...)}`
4. Replace input `value` and `onChange` props with `{...form.getInputProps("fieldName")}`
5. Change submit button to `type="submit"` instead of `onClick` handler
6. Add form validation rules as needed
7. Use `form.reset()` after successful submission

---

## Files to Convert

### ✅ Already Converted (9 files)

These files correctly use `<form>` elements with `useForm`:

- [x] `apps/frontend/app/components/common/filter-presets.tsx` *(reference example)*
- [x] `apps/frontend/app/routes/_dashboard.media.people.update.$action.tsx`
- [x] `apps/frontend/app/routes/_dashboard.media.item.update.$action.tsx`
- [x] `apps/frontend/app/routes/_dashboard.media.groups.update.$action.tsx`
- [x] `apps/frontend/app/routes/_dashboard.fitness.exercises.update.$action.tsx`
- [x] `apps/frontend/app/routes/auth.tsx` *(uses conform-to library)*
- [x] `apps/frontend/app/components/common/review.tsx`
- [x] `apps/frontend/app/components/common/CollectionTemplateRenderer.tsx`
- [x] `apps/frontend/app/components/common/multi-select-creatable.tsx`

---

### 🔧 Needs Conversion (19 files)

These files use `useState` + `onClick` patterns and need conversion:

#### Dashboard Forms

- [x] `apps/frontend/app/components/routes/dashboard/forms/review-entity-form.tsx` ✅ **COMPLETED**
  - **Inputs**: Rating, NumberInput, Select, Textarea, SegmentedControl, Checkbox
  - **State**: ~~Uses extensive `useState` for form data~~ Now uses `useForm`
  - **Changes**: Converted all inputs to use form state, submit button now `type="submit"`, proper keyboard submission

- [x] `apps/frontend/app/components/routes/dashboard/forms/create-or-update-measurement-form.tsx` ✅ **COMPLETED**
  - **Inputs**: DateTimePicker, TextInput, NumberInput, Textarea
  - **State**: ~~Uses `useState` for input state~~ Now uses `useForm`
  - **Changes**: Converted to proper form with validation, supports keyboard submission, proper array handling for statistics

- [x] `apps/frontend/app/components/routes/dashboard/forms/create-or-update-collection-form.tsx` ✅ **COMPLETED**
  - **Inputs**: TextInput, Textarea, Checkbox, MultiSelect, nested informationTemplate fields
  - **State**: ~~Uses `useState` with immer~~ Now uses `useForm`
  - **Changes**: Converted to proper HTML form, removed immer/produce boilerplate, automatic validation

- [x] `apps/frontend/app/components/routes/dashboard/forms/add-entity-to-collections-form.tsx` ✅ **COMPLETED**
  - **Inputs**: MultiSelect for collections, dynamic custom fields based on templates
  - **State**: ~~Uses `useListState` for collections array~~ Now uses `useForm`
  - **Changes**: Converted to proper HTML form, replaced useListState with form array field, automatic validation

#### Progress Update Forms

- [x] `apps/frontend/app/components/routes/dashboard/forms/metadata-progress-update/in-progress-form.tsx` ✅ **COMPLETED**
  - **Inputs**: Slider, NumberInput (percentage and absolute value modes)
  - **State**: ~~Uses `useState` for progress~~ Now uses `useForm`
  - **Changes**: Converted to proper HTML form, validation for 0-100 range, better type safety

- [x] `apps/frontend/app/components/routes/dashboard/forms/metadata-progress-update/new-progress-form.tsx` ✅ **COMPLETED**
  - **Inputs**: WatchTimeSelect, CustomDatePicker (start/finish), ProviderSelect
  - **State**: ~~Uses `useState` with immer~~ Now uses `useForm`
  - **Changes**: Converted to proper HTML form, removed immer, validation for custom dates, props parameter refactor

- [ ] `apps/frontend/app/components/routes/dashboard/forms/metadata-progress-update/media-types/show-form.tsx`
  - **Type**: Show-specific progress form
  - **Action**: Convert to `useForm`

- [ ] `apps/frontend/app/components/routes/dashboard/forms/metadata-progress-update/media-types/podcast-form.tsx`
  - **Type**: Podcast-specific progress form
  - **Action**: Convert to `useForm`

- [ ] `apps/frontend/app/components/routes/dashboard/forms/metadata-progress-update/media-types/manga-form.tsx`
  - **Type**: Manga-specific progress form
  - **Action**: Convert to `useForm`

- [ ] `apps/frontend/app/components/routes/dashboard/forms/metadata-progress-update/media-types/anime-form.tsx`
  - **Type**: Anime-specific progress form
  - **Action**: Convert to `useForm`

#### Fitness Action Components

- [ ] `apps/frontend/app/components/routes/fitness.action/bulk-delete-modal.tsx`
  - **Inputs**: Checkbox components for set selection
  - **State**: Uses `useState` for selectedSets
  - **Action**: Convert to form with checkbox group

#### Settings Pages

- [ ] `apps/frontend/app/routes/_dashboard.settings.preferences.tsx`
  - **Inputs**: DragDropContext, Select, NumberInput, Switch, TextInput, MultiSelect, TagsInput
  - **State**: Large form with multiple `useState` calls
  - **Action**: Convert to comprehensive `useForm` implementation

- [ ] `apps/frontend/app/routes/_dashboard.settings.users.tsx`
  - **Inputs**: TextInput for user registration
  - **State**: Uses useDisclosure and state
  - **Action**: Convert modal form to `useForm`

- [ ] `apps/frontend/app/routes/_dashboard.settings.security.tsx`
  - **Type**: Security settings form
  - **Action**: Review and convert to proper form

- [ ] `apps/frontend/app/routes/_dashboard.settings.sharing.tsx`
  - **Type**: Sharing settings form
  - **Action**: Review and convert to proper form

- [ ] `apps/frontend/app/routes/_dashboard.settings.notifications.tsx`
  - **Type**: Notifications settings form
  - **Action**: Review and convert to proper form

- [ ] `apps/frontend/app/routes/_dashboard.settings.integrations.tsx`
  - **Type**: Integrations settings form
  - **Action**: Review and convert to proper form

#### Import/Export

- [ ] `apps/frontend/app/routes/_dashboard.settings.imports-and-exports._index.tsx`
  - **Inputs**: FileInput, TextInput, Select
  - **Current**: Uses React Router `<Form>` component
  - **Action**: Review - may already be acceptable with React Router Form

#### Exercise Management

- [ ] `apps/frontend/app/routes/_dashboard.fitness.exercises.item.$id._index.tsx`
  - **State**: Uses `useState` for changingExerciseSettings
  - **Action**: Convert modal forms to `useForm`

---

## Conversion Priority

### High Priority (Quick Wins)
1. ✅ `filter-presets.tsx` (already done)
2. `bulk-delete-modal.tsx` (simple checkbox form)
3. `create-or-update-measurement-form.tsx` (standalone form)
4. `settings.users.tsx` (simple user registration modal)

### Medium Priority (Standard Forms)
5. `review-entity-form.tsx` (review submission form)
6. `create-or-update-collection-form.tsx`
7. `add-entity-to-collections-form.tsx`
8. All progress update forms (show, podcast, manga, anime)

### Lower Priority (Complex Forms)
9. `settings.preferences.tsx` (large form with many fields)
10. Other settings pages
11. Exercise management forms

---

## Testing Checklist

After converting each form, verify:

- [ ] Form can be submitted by pressing Enter in text inputs
- [ ] Validation errors display correctly
- [ ] Form resets after successful submission
- [ ] Loading states work during submission
- [ ] Cancel button still works (if applicable)
- [ ] Modal closes after submission (if applicable)
- [ ] All existing functionality is preserved

---

## Summary Statistics

- **Total files analyzed**: 58
- **Already converted**: 9 (15.5%)
- **Needs conversion**: 19 (32.8%)
- **Not applicable**: 30 (51.7%)

**Progress**: 15/28 complete (53.6%)
