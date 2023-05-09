// Responsible for importing from https://github.com/bonukai/MediaTracker.

use async_graphql::Result;
use serde::{Deserialize, Serialize};
use surf::{http::headers::USER_AGENT, Client, Config, Url};

use crate::{
    graphql::{AUTHOR, PROJECT_NAME},
    migrator::MetadataLot,
    utils::openlibrary,
};

use super::{ImportItem, ImportResult, MediaTrackerImportInput};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
enum MediaType {
    Book,
    Movie,
    Tv,
    VideoGame,
    Audiobook,
}

impl From<MediaType> for MetadataLot {
    fn from(value: MediaType) -> Self {
        match value {
            MediaType::Book => Self::Book,
            MediaType::Movie => Self::Movie,
            MediaType::Tv => Self::Show,
            MediaType::VideoGame => Self::VideoGame,
            MediaType::Audiobook => Self::AudioBook,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Item {
    id: i32,
    media_type: MediaType,
    audible_id: Option<String>,
    igdb_id: Option<i32>,
    tmdb_id: Option<i32>,
    openlibrary_id: Option<String>,
}

pub async fn import(input: MediaTrackerImportInput) -> Result<ImportResult> {
    let client: Client = Config::new()
        .add_header(USER_AGENT, format!("{}/{}", AUTHOR, PROJECT_NAME))
        .unwrap()
        .add_header("Access-Token", input.api_key)
        .unwrap()
        .set_base_url(Url::parse(&format!("{}/api/", input.api_url)).unwrap())
        .try_into()
        .unwrap();
    let mut rsp = client.get("items").await.unwrap();
    let data: Vec<Item> = rsp.body_json().await.unwrap();

    let media = data
        .iter()
        .map(|d| {
            let identifier = match d.media_type.clone() {
                MediaType::Book => openlibrary::get_key(&d.openlibrary_id.clone().unwrap()),
                MediaType::Movie => d.tmdb_id.unwrap().to_string(),
                MediaType::Tv => d.tmdb_id.unwrap().to_string(),
                MediaType::VideoGame => d.igdb_id.unwrap().to_string(),
                MediaType::Audiobook => d.audible_id.clone().unwrap(),
            };
            ImportItem {
                lot: MetadataLot::from(d.media_type.clone()),
                identifier,
            }
        })
        .collect();
    Ok(ImportResult { media })
}

pub mod utils {
    use chrono::NaiveDate;
    use regex::Regex;

    #[derive(Debug)]
    pub struct ReviewInformation {
        date: NaiveDate,
        spoiler: bool,
        text: String,
    }

    // Wrote with the help of ChatGPT.
    pub fn extract_review_information(input: &str) -> Option<ReviewInformation> {
        let regex_str =
            r"(?m)^(?P<date>\d{2}/\d{2}/\d{4}):(?P<spoiler>\s*\[SPOILERS\])?\n\n(?P<text>[\s\S]*)$";
        let regex = Regex::new(regex_str).unwrap();
        if let Some(captures) = regex.captures(input) {
            let date_str = captures.name("date").unwrap().as_str();
            let date = NaiveDate::parse_from_str(date_str, "%d/%m/%Y").ok()?;
            let spoiler = captures
                .name("spoiler")
                .map_or(false, |m| m.as_str().trim() == "[SPOILERS]");
            let text = captures.name("text").unwrap().as_str().to_owned();
            Some(ReviewInformation {
                date,
                spoiler,
                text,
            })
        } else {
            None
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use rstest::rstest;

        static TEXT_1: &str = "The movie was fantastic! Highly recommend.";
        static TEXT_2: &str = "The ending was unexpected.";
        static TEXT_3: &str =
            "Short and sweet romance.\n\nDefinitely worth the 7-8hrs I spent reading it.";
        static TEXT_4: &str =
            "This is a great book.\nThe characters are well-developed.\n\nI couldn't put it down!";

        #[rstest]
        #[case(
            format!("01/05/2023:\n\n{TEXT_1}"),
            NaiveDate::from_ymd_opt(2023, 5, 1).unwrap(),
            false,
            TEXT_1
        )]
        #[case(
            format!("01/05/2023: [SPOILERS]\n\n{TEXT_2}"),
            NaiveDate::from_ymd_opt(2023, 5, 1).unwrap(),
            true,
            TEXT_2
        )]
        #[case(
            format!("14/04/2023:\n\n{TEXT_3}"),
            NaiveDate::from_ymd_opt(2023, 4, 14).unwrap(),
            false,
            TEXT_3
        )]
        #[case(
            format!("12/08/2019:\n\n{TEXT_4}"),
            NaiveDate::from_ymd_opt(2019, 8, 12).unwrap(),
            false,
            TEXT_4
        )]
        #[case(
            format!("12/09/2018: [SPOILERS]\n\n{TEXT_4}"),
            NaiveDate::from_ymd_opt(2018, 9, 12).unwrap(),
            true,
            TEXT_4
        )]
        fn test_extract_review_information(
            #[case] input: String,
            #[case] expected_date: NaiveDate,
            #[case] expected_is_spoiler: bool,
            #[case] expected_text: &str,
        ) {
            let info = extract_review_information(input.as_str());
            assert!(info.is_some());

            let info = info.unwrap();
            assert_eq!(info.date, expected_date);
            assert_eq!(info.spoiler, expected_is_spoiler);
            assert_eq!(info.text, expected_text);
        }
    }
}
