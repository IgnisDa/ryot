use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use common_models::DefaultCollection;
use common_utils::{get_base_http_client, ryot_log};
use database_models::{metadata, prelude::Metadata};
use dependent_models::{
    CollectionToEntityDetails, ImportCompletedItem, ImportOrExportMetadataItem, ImportResult,
};
use enum_models::{MediaLot, MediaSource};
use futures::{StreamExt, stream};
use itertools::Itertools;
use media_models::ImportOrExportMetadataItemSeen;
use reqwest::{
    Client,
    header::{HeaderName, HeaderValue},
};
use rust_decimal::{Decimal, dec, prelude::FromPrimitive};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, prelude::Expr};
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;
use url::Url;

mod komga_book {
    use super::*;

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Media {
        pub pages_count: i32,
    }

    #[derive(Debug, Serialize, Deserialize)]
    pub struct Link {
        pub url: String,
        pub label: String,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Metadata {
        pub number: String,
        pub links: Vec<Link>,
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ReadProgress {
        pub page: i32,
        pub completed: bool,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Item {
        pub id: String,
        pub media: Media,
        pub name: String,
        pub metadata: Metadata,
        pub read_progress: Option<ReadProgress>,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Response {
        pub content: Vec<Item>,
    }

    impl Metadata {
        fn extract_id(&self, url: &str, label: &str) -> Option<String> {
            let parsed_url = Url::parse(url).ok()?;
            if label.to_lowercase().contains("google") {
                parsed_url
                    .query_pairs()
                    .find(|(k, _)| k == "id")
                    .map(|(_, v)| v.into_owned())
            } else {
                parsed_url
                    .path_segments()
                    .and_then(|segments| segments.collect_vec().get(1).cloned())
                    .map(String::from)
            }
        }

        pub fn find_providers(&self) -> Vec<(MediaSource, MediaLot, Option<String>)> {
            let mut provider_links = vec![];
            for link in self.links.iter() {
                let (source, lot) = match link.label.to_lowercase().as_str() {
                    "anilist" => (MediaSource::Anilist, MediaLot::Manga),
                    "hardcover" => (MediaSource::Hardcover, MediaLot::Book),
                    "openlibrary" => (MediaSource::Openlibrary, MediaLot::Book),
                    "myanimelist" => (MediaSource::Myanimelist, MediaLot::Manga),
                    "mangaupdates" => (MediaSource::MangaUpdates, MediaLot::Manga),
                    "googlebooks" | "google books" => (MediaSource::GoogleBooks, MediaLot::Book),
                    _ => continue,
                };
                let id = self.extract_id(&link.url, &link.label);
                provider_links.push((source, lot, id));
            }
            provider_links.sort_by_key(|a| (a.2.is_none(), a.2.clone()));
            provider_links
        }
    }
}

fn get_http_client(api_key: &str) -> Client {
    get_base_http_client(Some(vec![(
        HeaderName::from_static("x-api-key"),
        HeaderValue::from_str(api_key).unwrap(),
    )]))
}

async fn find_provider_and_id(
    ss: &Arc<SupportingService>,
    item: &komga_book::Item,
) -> Result<(MediaSource, MediaLot, Option<String>)> {
    let providers = item.metadata.find_providers();
    if !providers.is_empty() {
        Ok(providers.first().cloned().unwrap_or_default())
    } else {
        let db_entry = Metadata::find()
            .filter(metadata::Column::Lot.is_in([MediaLot::Manga, MediaLot::Book]))
            .filter(Expr::col(metadata::Column::Title).eq(&item.name))
            .one(&ss.db)
            .await?;

        Ok(db_entry
            .map(|m| (m.source, m.lot, Some(m.identifier)))
            .unwrap_or_default())
    }
}

fn calculate_percentage(current_page: i32, total_page: i32) -> Decimal {
    if total_page == 0 {
        return dec!(0);
    }
    let percentage = (current_page as f64 / total_page as f64) * 100.0;
    Decimal::from_f64(percentage).unwrap_or(dec!(0))
}

pub async fn yank_progress(
    base_url: String,
    api_key: String,
    ss: &Arc<SupportingService>,
) -> Result<ImportResult> {
    let mut result = ImportResult::default();
    let url = format!("{base_url}/api/v1");
    let client = get_http_client(&api_key);

    let books: komga_book::Response = client
        .post(format!(
            "{url}/books/list?sort=readProgress.lastModified,desc"
        ))
        .json(&serde_json::json!({}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    ryot_log!(
        debug,
        "Got {} books with read progress",
        books.content.len()
    );

    for book in books.content {
        let Some(read_progress) = book.read_progress.clone() else {
            continue;
        };
        if read_progress.completed {
            continue;
        }

        let (source, lot, id) = match find_provider_and_id(ss, &book).await {
            Ok(result) => result,
            Err(e) => {
                ryot_log!(warn, "Failed to find provider for {}: {}", book.name, e);
                continue;
            }
        };

        let Some(id) = id else {
            ryot_log!(
                debug,
                "No provider URL or database entry found for: {}",
                book.name
            );
            continue;
        };

        result
            .completed
            .push(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
                lot,
                source,
                identifier: id,
                seen_history: vec![ImportOrExportMetadataItemSeen {
                    providers_consumed_on: Some(vec!["Komga".to_string()]),
                    manga_chapter_number: Some(book.metadata.number.parse().unwrap_or_default()),
                    progress: Some(calculate_percentage(
                        read_progress.page,
                        book.media.pages_count,
                    )),
                    ..Default::default()
                }],
                ..Default::default()
            }));
    }

    Ok(result)
}

pub async fn sync_to_owned_collection(
    base_url: String,
    api_key: String,
    ss: &Arc<SupportingService>,
) -> Result<ImportResult> {
    let mut result = ImportResult::default();
    let url = format!("{base_url}/api/v1");
    let client = get_http_client(&api_key);

    let item: komga_book::Response = client
        .post(format!("{url}/books/list?unpaged=true"))
        .json(&serde_json::json!({}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let unique_collection_updates: HashMap<String, _> = stream::iter(item.content)
        .filter_map(|book| async move {
            match find_provider_and_id(ss, &book).await {
                Ok((source, lot, Some(id))) => Some((
                    id.clone(),
                    ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
                        lot,
                        source,
                        identifier: id,
                        collections: vec![CollectionToEntityDetails {
                            collection_name: DefaultCollection::Owned.to_string(),
                            ..Default::default()
                        }],
                        ..Default::default()
                    }),
                )),
                _ => {
                    ryot_log!(
                        debug,
                        "No URL or database entry found for manga: {}",
                        book.name
                    );
                    None
                }
            }
        })
        .collect()
        .await;

    result
        .completed
        .extend(unique_collection_updates.into_values());
    Ok(result)
}
