expect(value).toMatchObject({ _tag: "Failure", failure: "failed" });
expect(value).toMatchObject({
	_tag: "Success",
	success: 1,
});

const left = "payload";
const shorthand = { _tag: "Failure", failure: left };
const wrongField = { _tag: "Left", right: 1 };
const tagOnly = { _tag: "Right", value: 1 };
const ordinary = { left: 1, right: 2 };

void [shorthand, wrongField, tagOnly, ordinary];
