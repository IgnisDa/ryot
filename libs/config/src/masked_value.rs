use crate::{IgdbImageSize, OpenlibraryCoverImageSize};

pub trait MaskedValue {
    fn masked_value(&self) -> Self;
}

macro_rules! impl_masked_value {
    ($($t:ty),*) => {
        $(
            impl MaskedValue for $t {
                fn masked_value(&self) -> Self {
                    *self
                }
            }
        )*
    };
}

impl_masked_value!(
    i32,
    u32,
    usize,
    bool,
    i64,
    u64,
    IgdbImageSize,
    OpenlibraryCoverImageSize
);

impl MaskedValue for String {
    fn masked_value(&self) -> Self {
        "****".to_string()
    }
}

impl MaskedValue for Vec<String> {
    fn masked_value(&self) -> Self {
        vec!["****".to_string()]
    }
}
