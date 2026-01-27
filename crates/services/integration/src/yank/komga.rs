use std::sync::Arc;

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

mod komga_book {
    use super::*;

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Media {
        pub pages_count: i32,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Metadata {
        pub number: String,
    }

    #[derive(Debug, Serialize, Deserialize)]
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
        pub series_id: String,
        pub metadata: Metadata,
        pub read_progress: Option<ReadProgress>,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Response {
        pub content: Vec<Item>,
    }
}

mod komga_series {
    use super::*;

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Link {
        pub url: String,
        pub label: String,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Metadata {
        pub links: Vec<Link>,
    }

    impl Metadata {
        fn extract_id(&self, url: String) -> Option<String> {
            reqwest::Url::parse(&url).ok().and_then(|parsed_url| {
                parsed_url
                    .path_segments()
                    .and_then(|segments| segments.collect_vec().get(1).cloned())
                    .map(String::from)
            })
        }

        pub fn find_providers(&self) -> Vec<(MediaSource, Option<String>)> {
            let mut provider_links = vec![];
            for link in self.links.iter() {
                let source = match link.label.to_lowercase().as_str() {
                    "anilist" => MediaSource::Anilist,
                    "myanimelist" => MediaSource::Myanimelist,
                    _ => continue,
                };
                let id = self.extract_id(link.url.clone());
                provider_links.push((source, id));
            }
            provider_links.sort_by_key(|a| a.1.clone());
            provider_links
        }
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Item {
        pub name: String,
        pub metadata: Metadata,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Response {
        pub content: Vec<Item>,
    }
}

fn get_http_client(api_key: &str) -> Client {
    get_base_http_client(Some(vec![(
        HeaderName::from_static("x-api-key"),
        HeaderValue::from_str(api_key).unwrap(),
    )]))
}

async fn find_provider_and_id(
    source: MediaSource,
    ss: &Arc<SupportingService>,
    series: &komga_series::Item,
) -> Result<(MediaSource, Option<String>)> {
    let providers = series.metadata.find_providers();
    if !providers.is_empty() {
        Ok(providers
            .iter()
            .find(|x| x.0 == source)
            .cloned()
            .or_else(|| providers.first().cloned())
            .unwrap_or_default())
    } else {
        let db_manga = Metadata::find()
            .filter(metadata::Column::Lot.eq(MediaLot::Manga))
            .filter(Expr::col(metadata::Column::Title).eq(&series.name))
            .one(&ss.db)
            .await?;

        Ok(db_manga
            .map(|manga| (manga.source, Some(manga.identifier)))
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
    source: MediaSource,
    ss: &Arc<SupportingService>,
) -> Result<ImportResult> {
    let mut result = ImportResult::default();
    let url = format!("{base_url}/api/v1");
    let client = get_http_client(&api_key);

    let books: komga_book::Response = client
        .get(format!(
            "{url}/books?read_status=IN_PROGRESS&sort=readProgress.lastModified,desc"
        ))
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
        let Some(read_progress) = book.read_progress else {
            continue;
        };

        if read_progress.completed {
            continue;
        }

        let series: komga_series::Item = match client
            .get(format!("{url}/series/{}", book.series_id))
            .send()
            .await?
            .error_for_status()
        {
            Ok(resp) => resp.json().await?,
            Err(e) => {
                ryot_log!(warn, "Failed to fetch series {}: {}", book.series_id, e);
                continue;
            }
        };

        let (source, id) = match find_provider_and_id(source, ss, &series).await {
            Ok(result) => result,
            Err(e) => {
                ryot_log!(warn, "Failed to find provider for {}: {}", series.name, e);
                continue;
            }
        };

        let Some(id) = id else {
            ryot_log!(
                debug,
                "No provider URL or database entry found for manga: {}",
                series.name
            );
            continue;
        };

        result
            .completed
            .push(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
                lot: MediaLot::Manga,
                source,
                identifier: id,
                seen_history: vec![ImportOrExportMetadataItemSeen {
                    progress: Some(calculate_percentage(
                        read_progress.page,
                        book.media.pages_count,
                    )),
                    providers_consumed_on: Some(vec!["Komga".to_string()]),
                    manga_chapter_number: Some(book.metadata.number.parse().unwrap_or_default()),
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
    source: MediaSource,
    ss: &Arc<SupportingService>,
) -> Result<ImportResult> {
    let mut result = ImportResult::default();
    let url = format!("{base_url}/api/v1");
    let client = get_http_client(&api_key);

    let series: komga_series::Response = client
        .post(format!("{url}/series/list?unpaged=true"))
        .json(&serde_json::json!({}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let unique_collection_updates: std::collections::HashMap<String, _> =
        stream::iter(series.content)
            .filter_map(|book| async move {
                match find_provider_and_id(source, ss, &book).await {
                    Ok((source, Some(id))) => Some((
                        id.clone(),
                        ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
                            identifier: id,
                            lot: MediaLot::Manga,
                            source,
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
