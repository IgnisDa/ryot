// Responsible for importing from https://github.com/bonukai/MediaTracker.

use async_graphql::Result;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use serde_with::{formats::Flexible, serde_as, TimestampMilliSeconds};
use surf::{http::headers::USER_AGENT, Client, Config, Url};

use crate::{
    graphql::{AUTHOR, PROJECT_NAME},
    importer::{
        media_tracker::utils::extract_review_information, ImportItemIdentifier, ImportItemRating,
        ImportItemSeen,
    },
    migrator::MetadataLot,
    utils::openlibrary,
};

use super::{
    DeployMediaTrackerImportInput, ImportFailStep, ImportFailedItem, ImportItem, ImportResult,
};

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

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ItemReview {
    id: i32,
    rating: Option<i32>,
    review: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ItemEpisode {
    id: i32,
    season_number: i32,
    episode_number: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ItemSeason {
    episodes: Vec<ItemEpisode>,
}

#[serde_as]
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ItemSeen {
    id: i32,
    #[serde_as(as = "TimestampMilliSeconds<i64, Flexible>")]
    date: DateTimeUtc,
    episode_id: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ItemDetails {
    seen_history: Vec<ItemSeen>,
    seasons: Vec<ItemSeason>,
    user_rating: Option<ItemReview>,
}

pub async fn import(input: DeployMediaTrackerImportInput) -> Result<ImportResult> {
    let client: Client = Config::new()
        .add_header(USER_AGENT, format!("{}/{}", AUTHOR, PROJECT_NAME))
        .unwrap()
        .add_header("Access-Token", input.api_key)
        .unwrap()
        .set_base_url(Url::parse(&format!("{}/api/", input.api_url)).unwrap())
        .try_into()
        .unwrap();

    let mut failed_items = vec![];

    // all items returned here are seen atleast once
    let mut rsp = client.get("items").await.unwrap();
    let data: Vec<Item> = rsp.body_json().await.unwrap();
    let len = data.len();

    let mut final_data = vec![];
    for (idx, d) in data.into_iter().enumerate() {
        let lot = MetadataLot::from(d.media_type.clone());
        let identifier = match d.media_type.clone() {
            MediaType::Book => openlibrary::get_key(&d.openlibrary_id.clone().unwrap()),
            MediaType::Movie => d.tmdb_id.unwrap().to_string(),
            MediaType::Tv => d.tmdb_id.unwrap().to_string(),
            MediaType::VideoGame => d.igdb_id.unwrap().to_string(),
            MediaType::Audiobook => d.audible_id.clone().unwrap(),
        };
        let mut rsp = client.get(format!("details/{}", d.id)).await.unwrap();
        let details: ItemDetails = rsp
            .body_json()
            .await
            .map_err(|_| {
                failed_items.push(ImportFailedItem {
                    lot,
                    step: ImportFailStep::ItemDetailsFromSource,
                    identifier: d.id.to_string(),
                });
            })
            .unwrap();
        tracing::trace!(
            "Got details for {type:?}: {id} ({idx}/{total})",
            type = d.media_type,
            id = d.id,
            idx = idx,
            total = len
        );
        final_data.push(ImportItem {
            source_id: d.id.to_string(),
            lot,
            identifier: ImportItemIdentifier::NeedsDetails(identifier),
            reviews: Vec::from_iter(details.user_rating.map(|r| {
                let review = if let Some(s) = r.review.map(|s| extract_review_information(&s)) {
                    s
                } else {
                    failed_items.push(ImportFailedItem {
                        lot,
                        step: ImportFailStep::ReviewTransformation,
                        identifier: d.id.to_string(),
                    });
                    None
                };
                ImportItemRating {
                    id: r.id.to_string(),
                    review,
                    rating: r.rating,
                }
            })),
            seen_history: details
                .seen_history
                .iter()
                .map(|s| {
                    let (season_number, episode_number) = if let Some(c) = s.episode_id {
                        let episode = details
                            .seasons
                            .iter()
                            .flat_map(|e| e.episodes.to_owned())
                            .find(|e| e.id == c)
                            .unwrap();
                        (Some(episode.season_number), Some(episode.episode_number))
                    } else {
                        (None, None)
                    };
                    ImportItemSeen {
                        id: s.id.to_string(),
                        ended_on: Some(s.date),
                        season_number,
                        episode_number,
                    }
                })
                .collect(),
        });
    }
    Ok(ImportResult {
        media: final_data,
        failed_items,
    })
}

pub mod utils {
    use chrono::{NaiveDateTime, TimeZone, Utc};
    use regex::Regex;

    use crate::importer::ImportItemReview;

    // Wrote with the help of ChatGPT.
    pub fn extract_review_information(input: &str) -> Option<ImportItemReview> {
        let regex_str =
            r"(?m)^(?P<date>\d{2}/\d{2}/\d{4}):(?P<spoiler>\s*\[SPOILERS\])?\n\n(?P<text>[\s\S]*)$";
        let regex = Regex::new(regex_str).unwrap();
        if let Some(captures) = regex.captures(input) {
            let date_str = captures.name("date").unwrap().as_str();
            let date = NaiveDateTime::parse_from_str(
                &format!("{} 00:00:00", date_str),
                "%d/%m/%Y %H:%M:%S",
            )
            .ok()
            .and_then(|d| Utc.from_local_datetime(&d).earliest())
            .unwrap();
            let spoiler = captures
                .name("spoiler")
                .map_or(false, |m| m.as_str().trim() == "[SPOILERS]");
            let text = captures.name("text").unwrap().as_str().to_owned();
            Some(ImportItemReview {
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
        use sea_orm::prelude::DateTimeUtc;

        static TEXT_1: &str = "The movie was fantastic! Highly recommend.";
        static TEXT_2: &str = "The ending was unexpected.";
        static TEXT_3: &str =
            "Short and sweet romance.\n\nDefinitely worth the 7-8hrs I spent reading it.";
        static TEXT_4: &str =
            "This is a great book.\nThe characters are well-developed.\n\nI couldn't put it down!";

        #[rstest]
        #[case(
            format!("01/05/2023:\n\n{TEXT_1}"),
            Utc.with_ymd_and_hms(2023, 5, 1, 0, 0, 0).unwrap(),
            false,
            TEXT_1
        )]
        #[case(
            format!("01/05/2023: [SPOILERS]\n\n{TEXT_2}"),
            Utc.with_ymd_and_hms(2023, 5, 1, 0, 0, 0).unwrap(),
            true,
            TEXT_2
        )]
        #[case(
            format!("14/04/2023:\n\n{TEXT_3}"),
            Utc.with_ymd_and_hms(2023, 4, 14, 0, 0, 0).unwrap(),
            false,
            TEXT_3
        )]
        #[case(
            format!("12/08/2019:\n\n{TEXT_4}"),
            Utc.with_ymd_and_hms(2019, 8, 12, 0, 0, 0).unwrap(),
            false,
            TEXT_4
        )]
        #[case(
            format!("12/09/2018: [SPOILERS]\n\n{TEXT_4}"),
            Utc.with_ymd_and_hms(2018, 9, 12, 0, 0, 0).unwrap(),
            true,
            TEXT_4
        )]
        fn test_extract_review_information(
            #[case] input: String,
            #[case] expected_date: DateTimeUtc,
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

        #[test]
        fn test_extract_review_information_invalid() {
            let info = extract_review_information("");
            assert!(info.is_none());
        }
    }
}
