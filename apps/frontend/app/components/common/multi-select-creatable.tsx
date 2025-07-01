import { Combobox, Group, Pill, PillsInput, useCombobox } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { useState } from "react";

type MultiSelectCreatableProps = {
	label: string;
	data: string[];
	value: string[];
	required?: boolean;
	description?: string;
	setValue: (value: string[]) => void;
};

export const MultiSelectCreatable = (props: MultiSelectCreatableProps) => {
	const combobox = useCombobox({
		onDropdownClose: () => combobox.resetSelectedOption(),
		onDropdownOpen: () => combobox.updateSelectedOptionIndex("active"),
	});

	const [search, setSearch] = useState("");
	const [data, setData] = useState(props.data);

	const exactOptionMatch = data.some((item) => item === search);

	const handleValueSelect = (val: string) => {
		if (val === "$create") {
			setData((current) => [...current, search]);
			props.setValue([...props.value, search]);
		} else {
			props.setValue(
				props.value.includes(val)
					? props.value.filter((v) => v !== val)
					: [...props.value, val],
			);
		}
		setSearch("");
	};

	const handleValueRemove = (val: string) =>
		props.setValue(props.value.filter((v) => v !== val));

	const values = props.value.map((item) => (
		<Pill key={item} withRemoveButton onRemove={() => handleValueRemove(item)}>
			{item}
		</Pill>
	));

	const options = data
		.filter((item) => item.toLowerCase().includes(search.trim().toLowerCase()))
		.map((item) => (
			<Combobox.Option
				key={item}
				value={item}
				active={props.value.includes(item)}
			>
				<Group gap="sm">
					{props.value.includes(item) ? <IconCheck size={12} /> : null}
					<span>{item}</span>
				</Group>
			</Combobox.Option>
		));

	return (
		<Combobox
			store={combobox}
			withinPortal={false}
			onOptionSubmit={handleValueSelect}
		>
			<Combobox.DropdownTarget>
				<PillsInput
					label={props.label}
					required={props.required}
					description={props.description}
					onClick={() => combobox.openDropdown()}
				>
					<Pill.Group>
						{values}
						<Combobox.EventsTarget>
							<PillsInput.Field
								value={search}
								placeholder="Search values"
								onFocus={() => combobox.openDropdown()}
								onBlur={() => combobox.closeDropdown()}
								onChange={(event) => {
									combobox.updateSelectedOptionIndex();
									setSearch(event.currentTarget.value);
								}}
								onKeyDown={(event) => {
									if (event.key === "Backspace" && search.length === 0) {
										event.preventDefault();
										handleValueRemove(props.value[props.value.length - 1]);
									}
								}}
							/>
						</Combobox.EventsTarget>
					</Pill.Group>
				</PillsInput>
			</Combobox.DropdownTarget>

			<Combobox.Dropdown>
				<Combobox.Options>
					{options}
					{!exactOptionMatch && search.trim().length > 0 && (
						<Combobox.Option value="$create">+ Create {search}</Combobox.Option>
					)}
					{exactOptionMatch &&
						search.trim().length > 0 &&
						options.length === 0 && (
							<Combobox.Empty>Nothing found</Combobox.Empty>
						)}
				</Combobox.Options>
			</Combobox.Dropdown>
		</Combobox>
	);
};
