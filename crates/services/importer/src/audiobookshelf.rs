use std::future::Future;

use anyhow::anyhow;
use application_utils::{get_base_http_client, get_podcast_episode_number_by_name};
use async_graphql::Result;
use common_utils::ryot_log;
use data_encoding::BASE64;
use database_models::metadata;
use dependent_models::ImportResult;
use enums::{ImportSource, MediaLot, MediaSource};
use media_models::{
    CommitMediaInput, DeployUrlAndKeyImportInput, ImportOrExportMediaItem,
    ImportOrExportMediaItemSeen,
};
use providers::google_books::GoogleBooksService;
use reqwest::{
    header::{HeaderValue, AUTHORIZATION},
    Client,
};
use serde_json::json;
use specific_models::audiobookshelf as audiobookshelf_models;

use super::{ImportFailStep, ImportFailedItem};

pub async fn import<F>(
    input: DeployUrlAndKeyImportInput,
    isbn_service: &GoogleBooksService,
    commit_metadata: impl Fn(CommitMediaInput) -> F,
) -> Result<ImportResult>
where
    F: Future<Output = Result<metadata::Model>>,
{
    let mut media = vec![];
    let mut failed_items = vec![];
    let url = format!("{}/api", input.api_url);
    let client = get_base_http_client(Some(vec![(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", input.api_key)).unwrap(),
    )]));
    let libraries_resp = client
        .get(format!("{}/libraries", url))
        .send()
        .await
        .map_err(|e| anyhow!(e))?
        .json::<audiobookshelf_models::LibrariesListResponse>()
        .await
        .unwrap();
    for library in libraries_resp.libraries {
        ryot_log!(debug, "Importing library {:?}", library.name.unwrap());
        let mut query = json!({ "expanded": "1" });
        if let Some(audiobookshelf_models::MediaType::Book) = library.media_type {
            query["filter"] = json!(format!("progress.{}", BASE64.encode(b"finished")));
        }
        let finished_items = client
            .get(format!("{}/libraries/{}/items", url, library.id))
            .query(&query)
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json::<audiobookshelf_models::ListResponse>()
            .await
            .unwrap();
        let len = finished_items.results.len();
        for (idx, item) in finished_items.results.into_iter().enumerate() {
            let metadata = item.media.clone().unwrap().metadata;
            let title = metadata.title.clone();
            ryot_log!(debug, "Importing item {:?} ({}/{})", title, idx + 1, len);
            let (identifier, lot, source, episodes) =
                if Some("epub".to_string()) == item.media.as_ref().unwrap().ebook_format {
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
                    let item_details = get_item_details(&client, &url, &item.id, None).await?;
                    match item_details.media.and_then(|m| m.episodes) {
                        Some(episodes) => {
                            let lot = MediaLot::Podcast;
                            let source = MediaSource::Itunes;
                            let mut to_return = vec![];
                            for episode in episodes {
                                ryot_log!(debug, "Importing episode {:?}", episode.title);
                                let episode_details = get_item_details(
                                    &client,
                                    &url,
                                    &item.id,
                                    Some(episode.id.unwrap()),
                                )
                                .await?;
                                if let Some(true) =
                                    episode_details.user_media_progress.map(|u| u.is_finished)
                                {
                                    let podcast = commit_metadata(CommitMediaInput {
                                        identifier: itunes_id.clone(),
                                        lot,
                                        source,
                                        ..Default::default()
                                    })
                                    .await?;
                                    if let Some(pe) = podcast.podcast_specifics.and_then(|p| {
                                        get_podcast_episode_number_by_name(&p, &episode.title)
                                    }) {
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
                    ryot_log!(
                        debug,
                        "No ASIN, ISBN or iTunes ID found for item {:?}",
                        item
                    );
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
                identifier,
                seen_history,
                source_id: metadata.title,
                ..Default::default()
            })
        }
    }
    Ok(ImportResult {
        metadata: media,
        failed_items,
        ..Default::default()
    })
}

async fn get_item_details(
    client: &Client,
    url: &str,
    id: &str,
    episode: Option<String>,
) -> Result<audiobookshelf_models::Item> {
    let mut query = json!({ "expanded": "1", "include": "progress" });
    if let Some(episode) = episode {
        query["episode"] = json!(episode);
    }
    let item = client
        .get(format!("{}/items/{}", url, id))
        .query(&query)
        .send()
        .await
        .map_err(|e| anyhow!(e))?
        .json::<audiobookshelf_models::Item>()
        .await?;
    Ok(item)
}
