use async_graphql::{Enum, InputObject, SimpleObject};
use enum_meta::{meta, Meta};
use sea_orm::FromJsonQueryResult;
use serde::{Deserialize, Serialize};
use strum::{Display, EnumIter};

use crate::traits::MediaProviderLanguages;

pub mod resolver;

#[derive(Debug, PartialEq, Eq, Clone, Copy, Serialize, Deserialize, Enum)]
pub enum CollectionExtraInformationLot {
    String,
    Number,
    Date,
    DateTime,
}

#[derive(
    Debug,
    PartialEq,
    Eq,
    Clone,
    Serialize,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
    InputObject,
)]
#[graphql(input_name = "CollectionExtraInformationInput")]
pub struct CollectionExtraInformation {
    pub name: String,
    pub description: String,
    pub lot: CollectionExtraInformationLot,
    pub default_value: Option<String>,
    pub required: Option<bool>,
}

#[derive(Display, EnumIter)]
pub enum DefaultCollection {
    Watchlist,
    #[strum(serialize = "In Progress")]
    InProgress,
    Completed,
    Monitoring,
    Custom,
    Owned,
    Reminders,
    Recommendations,
}

meta! {
    DefaultCollection, (Option<Vec<CollectionExtraInformation>>, &'static str);
    Watchlist, (None, "Things I want to watch in the future.");
    InProgress, (None, "Media items that I am currently watching.");
    Completed, (None, "Media items that I have completed.");
    Custom, (None, "Items that I have created manually.");
    Recommendations, (None, "Items that are recommended to me based on my consumption.");
    Monitoring, (Some(
        vec![
            CollectionExtraInformation {
                name: "Days".to_string(),
                description: "How many days do you want to monitor for?".to_string(),
                lot: CollectionExtraInformationLot::Number,
                default_value: Some("30".to_string()),
                required: None,
            },
        ]
    ), "Items that I am keeping an eye on.");
    Owned, (Some(
        vec![
            CollectionExtraInformation {
                name: "Owned on".to_string(),
                description: "When did you get this media?".to_string(),
                lot: CollectionExtraInformationLot::Date,
                default_value: None,
                required: None,
            }
        ]
    ), "Items that I have in my inventory.");
    Reminders, (Some(
        vec![
            CollectionExtraInformation {
                name: "Reminder".to_string(),
                description: "When do you want to be reminded?".to_string(),
                lot: CollectionExtraInformationLot::Date,
                default_value: None,
                required: Some(true),
            },
            CollectionExtraInformation {
                name: "Text".to_string(),
                description: "What do you want to be reminded about?".to_string(),
                lot: CollectionExtraInformationLot::String,
                default_value: None,
                required: Some(true),
            }
        ]
    ), "Items that I want to be reminded about.");
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
