use enum_meta::{meta, Meta};
use strum::{Display, EnumIter};

use crate::traits::MediaProviderLanguages;

pub mod resolver;

#[derive(Display, EnumIter)]
pub enum DefaultCollection {
    Custom,
    #[strum(serialize = "In Progress")]
    InProgress,
    Watchlist,
}

meta! {
    DefaultCollection, &'static str;
    Custom, "Items that I have created manually.";
    InProgress, "Media items that I am currently watching.";
    Watchlist, "Things I want to watch in the future.";
}

#[derive(Debug, Clone)]
pub struct CustomService {}

impl MediaProviderLanguages for CustomService {
    fn supported_languages() -> Vec<String> {
        ["us"].into_iter().map(String::from).collect()
    }

    fn default_language() -> String {
        "us".to_owned()
    }
}
