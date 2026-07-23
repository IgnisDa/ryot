use std::{result::Result as StdResult, sync::Arc};

use anyhow::{Context, Result};
use application_utils::get_podcast_episode_number_by_name;
use common_utils::{get_http_client_with_tls_config, ryot_log};
use data_encoding::BASE64;
use dependent_entity_utils::commit_metadata;
use dependent_models::{ImportCompletedItem, ImportOrExportMetadataItem, ImportResult};
use dependent_provider_utils::get_identifier_from_book_isbn;
use enum_models::{ImportSource, MediaLot, MediaSource};
use external_models::audiobookshelf as audiobookshelf_models;
use futures::stream::{self, StreamExt};
use google_books_provider::GoogleBooksService;
use hardcover_provider::HardcoverService;
use importer_models::{ImportFailStep, ImportFailedItem};
use media_models::{
    DeployUrlAndKeyImportInput, ImportOrExportMetadataItemSeen, PartialMetadataWithoutId,
};
use openlibrary_provider::OpenlibraryService;
use reqwest::{
    Client,
    header::{AUTHORIZATION, HeaderValue},
};
use supporting_service::SupportingService;

struct ImportServices<'a> {
    ss: &'a Arc<SupportingService>,
    hardcover_service: &'a HardcoverService,
    google_books_service: &'a GoogleBooksService,
    open_library_service: &'a OpenlibraryService,
}

pub async fn import(
    input: DeployUrlAndKeyImportInput,
    ss: &Arc<SupportingService>,
    hardcover_service: &HardcoverService,
    google_books_service: &GoogleBooksService,
    open_library_service: &OpenlibraryService,
) -> Result<ImportResult> {
    let mut completed = vec![];
    let mut failed = vec![];
    let url = format!("{}/api", input.api_url);
    let client = get_http_client_with_tls_config(
        Some(vec![(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", input.api_key)).unwrap(),
        )]),
        input.allow_insecure_connections.unwrap_or(false),
    );

    let services = ImportServices {
        ss,
        hardcover_service,
        google_books_service,
        open_library_service,
    };

    let libraries_resp = client
        .get(format!("{url}/libraries"))
        .send()
        .await?
        .json::<audiobookshelf_models::LibrariesListResponse>()
        .await
        .unwrap();
    for library in libraries_resp.libraries {
        ryot_log!(debug, "Importing library {:?}", library.name.unwrap());
        let mut query = serde_json:: json!({ "expanded": "1" });
        if let Some(audiobookshelf_models::MediaType::Book) = library.media_type {
            query["filter"] = serde_json::json!(format!("progress.{}", BASE64.encode(b"finished")));
        }
        let finished_items = client
            .get(format!("{}/libraries/{}/items", url, library.id))
            .query(&query)
            .send()
            .await?
            .json::<audiobookshelf_models::ListResponse>()
            .await
            .unwrap();
        let len = finished_items.results.len();

        let results: Vec<_> = stream::iter(finished_items.results.into_iter().enumerate())
            .map(|(idx, item)| process_item(idx, item, len, &client, &url, &services))
            .buffer_unordered(5)
            .collect()
            .await;

        for result in results {
            match result {
                Ok(item) => completed.push(item),
                Err(error_item) => failed.push(error_item),
            }
        }
    }
    Ok(ImportResult { completed, failed })
}

async fn process_item(
    idx: usize,
    item: audiobookshelf_models::Item,
    total: usize,
    client: &Client,
    url: &str,
    services: &ImportServices<'_>,
) -> StdResult<ImportCompletedItem, ImportFailedItem> {
    let metadata = item.media.clone().unwrap().metadata;
    let title = metadata.title.clone();
    ryot_log!(debug, "Importing item {:?} ({}/{})", title, idx + 1, total);
    let (identifier, lot, source, episodes) =
        if item.media.as_ref().unwrap().ebook_format.as_deref() == Some("epub") {
            match &metadata.isbn {
                Some(isbn) => match get_identifier_from_book_isbn(
                    isbn,
                    services.hardcover_service,
                    services.google_books_service,
                    services.open_library_service,
                )
                .await
                {
                    Some((identifier, source)) => (identifier, MediaLot::Book, source, None),
                    _ => {
                        return Err(ImportFailedItem {
                            identifier: title,
                            lot: Some(MediaLot::Book),
                            step: ImportFailStep::InputTransformation,
                            error: Some("No Google Books ID found".to_string()),
                        });
                    }
                },
                _ => {
                    return Err(ImportFailedItem {
                        identifier: title,
                        lot: Some(MediaLot::Book),
                        error: Some("No ISBN found".to_string()),
                        step: ImportFailStep::InputTransformation,
                    });
                }
            }
        } else if let Some(asin) = metadata.asin.clone() {
            (asin, MediaLot::AudioBook, MediaSource::Audible, None)
        } else if let Some(itunes_id) = metadata.itunes_id.clone() {
            let item_details = get_item_details(client, url, &item.id, None)
                .await
                .map_err(|e| ImportFailedItem {
                    identifier: title.clone(),
                    error: Some(format!("item_id={}: {e:#}", item.id)),
                    lot: Some(MediaLot::Podcast),
                    step: ImportFailStep::ItemDetailsFromSource,
                })?;
            match item_details.media.and_then(|m| m.episodes) {
                Some(episodes) => {
                    let lot = MediaLot::Podcast;
                    let source = MediaSource::Itunes;
                    let mut to_return = vec![];
                    for episode in episodes {
                        ryot_log!(debug, "Importing episode {:?}", episode.title);
                        let episode_id = episode.id.clone();
                        let episode_details =
                            get_item_details(client, url, &item.id, Some(episode.id.unwrap()))
                                .await
                                .map_err(|e| ImportFailedItem {
                                    identifier: title.clone(),
                                    error: Some(format!(
                                        "item_id={},episode_id={}: {e:#}",
                                        item.id,
                                        episode_id.as_deref().unwrap_or("?"),
                                    )),
                                    lot: Some(MediaLot::Podcast),
                                    step: ImportFailStep::ItemDetailsFromSource,
                                })?;
                        if let Some(true) =
                            episode_details.user_media_progress.map(|u| u.is_finished)
                        {
                            let (podcast, _) = commit_metadata(
                                PartialMetadataWithoutId {
                                    lot,
                                    source,
                                    identifier: itunes_id.clone(),
                                    ..Default::default()
                                },
                                services.ss,
                                Some(true),
                            )
                            .await
                            .map_err(|e| ImportFailedItem {
                                identifier: title.clone(),
                                error: Some(format!("item_id={}: {e:#}", item.id)),
                                lot: Some(MediaLot::Podcast),
                                step: ImportFailStep::DatabaseCommit,
                            })?;
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
                    return Err(ImportFailedItem {
                        identifier: title,
                        lot: Some(MediaLot::Podcast),
                        step: ImportFailStep::ItemDetailsFromSource,
                        error: Some(format!(
                            "item_id={}: No episodes found for podcast",
                            item.id
                        )),
                    });
                }
            }
        } else {
            ryot_log!(debug, "No ASIN, ISBN or iTunes ID found {:?}", item);
            return Err(ImportFailedItem {
                identifier: title,
                step: ImportFailStep::InputTransformation,
                lot: None,
                error: Some(format!(
                    "item_id={}: No ASIN, ISBN or iTunes ID found",
                    item.id
                )),
            });
        };
    let mut seen_history = vec![];
    if let Some(podcasts) = episodes {
        for episode in podcasts {
            seen_history.push(ImportOrExportMetadataItemSeen {
                podcast_episode_number: Some(episode),
                providers_consumed_on: Some(vec![ImportSource::Audiobookshelf.to_string()]),
                ..Default::default()
            });
        }
    } else {
        seen_history.push(ImportOrExportMetadataItemSeen {
            providers_consumed_on: Some(vec![ImportSource::Audiobookshelf.to_string()]),
            ..Default::default()
        });
    };
    Ok(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
        lot,
        source,
        identifier,
        seen_history,
        source_id: metadata.title,
        ..Default::default()
    }))
}

async fn get_item_details(
    client: &Client,
    url: &str,
    id: &str,
    episode: Option<String>,
) -> Result<audiobookshelf_models::Item> {
    let mut query = serde_json::json!({ "expanded": "1", "include": "progress" });
    if let Some(episode) = episode {
        query["episode"] = serde_json::json!(episode);
    }
    let request_url = format!("{url}/items/{id}");
    let response = client
        .get(&request_url)
        .query(&query)
        .send()
        .await
        .with_context(|| format!("Network error requesting audiobookshelf API at {request_url}"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        anyhow::bail!("Audiobookshelf returned HTTP {status} (url: {request_url}): {body}");
    }
    let item = serde_json::from_str::<audiobookshelf_models::Item>(&body).with_context(|| {
        format!("Failed to parse JSON from Audiobookshelf response for {request_url}")
    })?;
    Ok(item)
}
