// Responsible for importing from https://github.com/bonukai/MediaTracker.

use async_graphql::Result;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use serde_with::{formats::Flexible, serde_as, TimestampMilliSeconds};
use surf::{http::headers::USER_AGENT, Client, Config, Url};
use uuid::Uuid;

use crate::{
    importer::{
        DeployMediaTrackerImportInput, ImportFailStep, ImportFailedItem, ImportOrExportItem,
        ImportResult,
    },
    migrator::{MetadataLot, MetadataSource},
    models::{
        media::{
            BookSpecifics, CreateOrUpdateCollectionInput, ImportOrExportItemIdentifier,
            ImportOrExportItemRating, ImportOrExportItemReview, ImportOrExportItemSeen,
            MediaDetails, MediaSpecifics, MetadataCreator, Visibility,
        },
        IdObject,
    },
    providers::openlibrary::get_key,
    utils::USER_AGENT_STR,
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
#[serde(rename_all = "lowercase")]
enum ListPrivacy {
    Private,
    Public,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListResponse {
    id: i32,
    name: String,
    #[serde(default)]
    items: Vec<ListItemResponse>,
    description: Option<String>,
    privacy: ListPrivacy,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListItemResponse {
    media_item: Item,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Item {
    id: i32,
    media_type: MediaType,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ItemReview {
    id: i32,
    rating: Option<Decimal>,
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
    #[serde_as(as = "Option<TimestampMilliSeconds<i64, Flexible>>")]
    date: Option<DateTimeUtc>,
    episode_id: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
enum ItemNumberOfPages {
    Nothing(String),
    Something(i32),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ItemDetails {
    seen_history: Vec<ItemSeen>,
    seasons: Vec<ItemSeason>,
    user_rating: Option<ItemReview>,
    audible_id: Option<String>,
    igdb_id: Option<i32>,
    tmdb_id: Option<i32>,
    openlibrary_id: Option<String>,
    goodreads_id: Option<i32>,
    title: String,
    overview: Option<String>,
    authors: Option<Vec<String>>,
    number_of_pages: Option<ItemNumberOfPages>,
}

pub async fn import(input: DeployMediaTrackerImportInput) -> Result<ImportResult> {
    let client: Client = Config::new()
        .add_header(USER_AGENT, USER_AGENT_STR)
        .unwrap()
        .add_header("Access-Token", input.api_key)
        .unwrap()
        .set_base_url(Url::parse(&format!("{}/api/", input.api_url)).unwrap())
        .try_into()
        .unwrap();

    let mut rsp = client.get("user").await.unwrap();
    let data: IdObject = rsp.body_json().await.unwrap();

    let user_id: i32 = data.id;

    let mut rsp = client
        .get("lists")
        .query(&serde_json::json!({ "userId": user_id }))
        .unwrap()
        .await
        .unwrap();
    let mut lists: Vec<ListResponse> = rsp.body_json().await.unwrap();

    let all_collections = lists
        .iter()
        .map(|l| CreateOrUpdateCollectionInput {
            name: l.name.clone(),
            description: l.description.as_ref().and_then(|s| match s.as_str() {
                "" => None,
                x => Some(x.to_owned()),
            }),
            visibility: Some(match l.privacy {
                ListPrivacy::Private => Visibility::Private,
                ListPrivacy::Public => Visibility::Public,
            }),
            update_id: None,
        })
        .collect();
    for list in lists.iter_mut() {
        let mut rsp = client
            .get("list/items")
            .query(&serde_json::json!({ "listId": list.id }))
            .unwrap()
            .await
            .unwrap();
        let items: Vec<ListItemResponse> = rsp.body_json().await.unwrap();
        list.items = items;
    }

    let mut failed_items = vec![];

    // all items returned here are seen atleast once
    let mut rsp = client.get("items").await.unwrap();
    let mut data: Vec<Item> = rsp.body_json().await.unwrap();

    // There are a few items that are added to lists but have not been seen, so will
    // add them manually.
    lists.iter().for_each(|l| {
        l.items.iter().for_each(|i| {
            data.push(Item {
                id: i.media_item.id,
                media_type: i.media_item.media_type.clone(),
            })
        })
    });

    tracing::trace!("Loaded data for {total:?} lists", total = lists.len());

    let data_len = data.len();

    let mut final_data = vec![];
    // TODO: Technically this can be done in parallel, by executing requests in
    // batches. Example: https://users.rust-lang.org/t/can-tokio-semaphore-be-used-to-limit-spawned-tasks/59899.
    for (idx, d) in data.into_iter().enumerate() {
        let lot = MetadataLot::from(d.media_type.clone());
        let mut rsp = client.get(format!("details/{}", d.id)).await.unwrap();
        let details: ItemDetails = match rsp.body_json().await {
            Ok(s) => s,
            Err(e) => {
                tracing::error!("Encountered error for id = {id:?}: {e:?}", id = d.id);
                failed_items.push(ImportFailedItem {
                    lot,
                    step: ImportFailStep::ItemDetailsFromSource,
                    identifier: d.id.to_string(),
                    error: Some(e.to_string()),
                });
                continue;
            }
        };
        let (identifier, source) = match d.media_type.clone() {
            MediaType::Book => {
                if let Some(_g_id) = details.goodreads_id {
                    (Uuid::new_v4().to_string(), MetadataSource::Custom)
                } else {
                    (
                        get_key(&details.openlibrary_id.clone().unwrap()),
                        MetadataSource::Openlibrary,
                    )
                }
            }
            MediaType::Movie => (details.tmdb_id.unwrap().to_string(), MetadataSource::Tmdb),
            MediaType::Tv => (details.tmdb_id.unwrap().to_string(), MetadataSource::Tmdb),
            MediaType::VideoGame => (details.igdb_id.unwrap().to_string(), MetadataSource::Igdb),
            MediaType::Audiobook => (details.audible_id.clone().unwrap(), MetadataSource::Audible),
        };
        tracing::trace!(
            "Got details for {type:?}: {id} ({idx}/{total})",
            type = d.media_type,
            id = d.id,
            idx = idx,
            total = data_len
        );
        let need_details = details.goodreads_id.is_none();

        let mut collections = vec![];
        for list in lists.iter() {
            for item in list.items.iter() {
                if item.media_item.id == d.id {
                    collections.push(list.name.clone());
                }
            }
        }

        let num_pages = details.number_of_pages.and_then(|d| match d {
            ItemNumberOfPages::Nothing(_) => None,
            ItemNumberOfPages::Something(s) => Some(s),
        });

        let item = ImportOrExportItem {
            source_id: d.id.to_string(),
            source,
            lot,
            collections,
            identifier: match need_details {
                false => ImportOrExportItemIdentifier::AlreadyFilled(Box::new(MediaDetails {
                    identifier,
                    title: details.title,
                    description: details.overview,
                    production_status: "Released".to_owned(),
                    lot,
                    source: MetadataSource::Custom,
                    creators: details
                        .authors
                        .unwrap_or_default()
                        .into_iter()
                        .map(|a| MetadataCreator {
                            name: a,
                            role: "Author".to_owned(),
                            image_urls: vec![],
                        })
                        .collect(),
                    genres: vec![],
                    images: vec![],
                    publish_year: None,
                    publish_date: None,
                    specifics: MediaSpecifics::Book(BookSpecifics { pages: num_pages }),
                })),
                true => ImportOrExportItemIdentifier::NeedsDetails(identifier),
            },
            reviews: Vec::from_iter(details.user_rating.map(|r| {
                let review = if let Some(s) = r
                    .clone()
                    .review
                    .map(|s| utils::extract_review_information(&s))
                {
                    s
                } else {
                    Some(ImportOrExportItemReview {
                        date: None,
                        spoiler: Some(false),
                        text: r.review,
                    })
                };
                ImportOrExportItemRating {
                    review,
                    rating: r.rating.map(|d| d.saturating_mul(dec!(20))),
                    show_season_number: None,
                    show_episode_number: None,
                    podcast_episode_number: None,
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
                    ImportOrExportItemSeen {
                        started_on: None,
                        ended_on: s.date,
                        show_season_number: season_number,
                        show_episode_number: episode_number,
                        // DEV: Since this source does not support podcasts
                        podcast_episode_number: None,
                    }
                })
                .collect(),
        };
        final_data.push(item);
    }
    Ok(ImportResult {
        media: final_data,
        failed_items,
        collections: all_collections,
    })
}

pub mod utils {
    use super::*;

    use chrono::{NaiveDateTime, TimeZone, Utc};
    use regex::Regex;

    // Written with the help of ChatGPT.
    pub fn extract_review_information(input: &str) -> Option<ImportOrExportItemReview> {
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
            Some(ImportOrExportItemReview {
                date: Some(date),
                spoiler: Some(spoiler),
                text: Some(text),
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
            assert_eq!(info.date.unwrap(), expected_date);
            assert_eq!(info.spoiler, Some(expected_is_spoiler));
            assert_eq!(info.text.unwrap(), expected_text.to_owned());
        }

        #[test]
        fn test_extract_review_information_invalid() {
            let info = extract_review_information("");
            assert!(info.is_none());
        }
    }
}
