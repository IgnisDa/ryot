use std::future::Future;

use anyhow::anyhow;
use async_graphql::Result;
use data_encoding::BASE64;
use database::{ImportSource, MediaLot, MediaSource};
use reqwest::{
    header::{HeaderValue, AUTHORIZATION},
    Client,
};
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    importer::{ImportFailStep, ImportFailedItem, ImportResult},
    miscellaneous::{audiobookshelf_models, itunes_podcast_episode_by_name},
    models::{
        media::{
            CommitMediaInput, ImportOrExportItemIdentifier, ImportOrExportMediaItem,
            ImportOrExportMediaItemSeen,
        },
        StringIdObject,
    },
    providers::google_books::GoogleBooksService,
    utils::get_base_http_client_new,
};

use super::DeployUrlAndKeyImportInput;

#[derive(Debug, Serialize, Deserialize)]
pub struct LibrariesListResponse {
    pub libraries: Vec<audiobookshelf_models::Item>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ListResponse {
    pub results: Vec<audiobookshelf_models::Item>,
}

pub async fn import<F>(
    input: DeployUrlAndKeyImportInput,
    isbn_service: &GoogleBooksService,
    db: &DatabaseConnection,
    commit_metadata: impl Fn(CommitMediaInput) -> F,
) -> Result<ImportResult>
where
    F: Future<Output = Result<StringIdObject>>,
{
    let mut media = vec![];
    let mut failed_items = vec![];
    let client = get_base_http_client_new(
        &format!("{}/api/", input.api_url),
        Some(vec![(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", input.api_key)).unwrap(),
        )]),
    );
    let libraries_resp = client
        .get("libraries")
        .send()
        .await
        .map_err(|e| anyhow!(e))?
        .json::<LibrariesListResponse>()
        .await
        .unwrap();
    for library in libraries_resp.libraries {
        tracing::debug!("Importing library {:?}", library.name.unwrap());
        let mut query = json!({ "expanded": "1" });
        if let Some(audiobookshelf_models::MediaType::Book) = library.media_type {
            query["filter"] = json!(format!("progress.{}", BASE64.encode(b"finished")));
        }
        let finished_items = client
            .get(&format!("libraries/{}/items", library.id))
            .query(&query)
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json::<ListResponse>()
            .await
            .unwrap();
        for item in finished_items.results {
            let metadata = item.media.clone().unwrap().metadata;
            let title = metadata.title.clone();
            let (identifier, lot, source, episodes) = if Some("epub".to_string())
                == item.media.as_ref().unwrap().ebook_format
            {
                match &metadata.isbn {
                    Some(isbn) => match isbn_service.id_from_isbn(isbn).await {
                        Some(id) => (id, MediaLot::Book, MediaSource::GoogleBooks, None),
                        _ => {
                            failed_items.push(ImportFailedItem {
                                error: Some("No Google Books ID found".to_string()),
                                identifier: title,
                                lot: None,
                                step: ImportFailStep::InputTransformation,
                            });
                            continue;
                        }
                    },
                    _ => {
                        failed_items.push(ImportFailedItem {
                            error: Some("No ISBN found".to_string()),
                            identifier: title,
                            lot: None,
                            step: ImportFailStep::InputTransformation,
                        });
                        continue;
                    }
                }
            } else if let Some(asin) = metadata.asin.clone() {
                (asin, MediaLot::AudioBook, MediaSource::Audible, None)
            } else if let Some(itunes_id) = metadata.itunes_id.clone() {
                let item_details = get_item_details(&client, &item.id, None).await?;
                match item_details.media.and_then(|m| m.episodes) {
                    Some(episodes) => {
                        let lot = MediaLot::Podcast;
                        let source = MediaSource::Itunes;
                        let mut to_return = vec![];
                        for episode in episodes {
                            let episode_details =
                                get_item_details(&client, &item.id, Some(episode.id.unwrap()))
                                    .await?;
                            if let Some(true) =
                                episode_details.user_media_progress.map(|u| u.is_finished)
                            {
                                commit_metadata(CommitMediaInput {
                                    identifier: itunes_id.clone(),
                                    lot,
                                    source,
                                    ..Default::default()
                                })
                                .await
                                .ok();
                                if let Ok(Some(pe)) =
                                    itunes_podcast_episode_by_name(&episode.title, &itunes_id, db)
                                        .await
                                {
                                    to_return.push(pe);
                                }
                            }
                        }
                        (itunes_id, lot, source, Some(to_return))
                    }
                    _ => {
                        failed_items.push(ImportFailedItem {
                            error: Some("No episodes found for podcast".to_string()),
                            identifier: title,
                            lot: Some(MediaLot::Podcast),
                            step: ImportFailStep::ItemDetailsFromSource,
                        });
                        continue;
                    }
                }
            } else {
                tracing::debug!("No ASIN, ISBN or iTunes ID found for item {:#?}", item);
                continue;
            };
            let mut seen_history = vec![];
            if let Some(podcasts) = episodes {
                for episode in podcasts {
                    seen_history.push(ImportOrExportMediaItemSeen {
                        provider_watched_on: Some(ImportSource::Audiobookshelf.to_string()),
                        podcast_episode_number: Some(episode),
                        ..Default::default()
                    });
                }
            } else {
                seen_history.push(ImportOrExportMediaItemSeen {
                    provider_watched_on: Some(ImportSource::Audiobookshelf.to_string()),
                    ..Default::default()
                });
            };
            media.push(ImportOrExportMediaItem {
                lot,
                source,
                source_id: metadata.title,
                identifier: "".to_string(),
                internal_identifier: Some(ImportOrExportItemIdentifier::NeedsDetails(identifier)),
                seen_history,
                collections: vec![],
                reviews: vec![],
            })
        }
    }
    Ok(ImportResult {
        media,
        failed_items,
        ..Default::default()
    })
}

async fn get_item_details(
    client: &Client,
    id: &str,
    episode: Option<String>,
) -> Result<audiobookshelf_models::Item> {
    let mut query = json!({ "expanded": "1", "include": "progress" });
    if let Some(episode) = episode {
        query["episode"] = json!(episode);
    }
    let item = client
        .get(&format!("items/{}", id))
        .query(&query)
        .send()
        .await
        .map_err(|e| anyhow!(e))?
        .json::<audiobookshelf_models::Item>()
        .await?;
    Ok(item)
}
