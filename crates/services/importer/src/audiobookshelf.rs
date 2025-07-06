use std::{result::Result as StdResult, sync::Arc};

use anyhow::anyhow;
use application_utils::{get_base_http_client, get_podcast_episode_number_by_name};
use async_graphql::Result;
use common_utils::ryot_log;
use data_encoding::BASE64;
use dependent_models::ImportOrExportMetadataItem;
use dependent_models::{ImportCompletedItem, ImportResult};
use dependent_utils::{commit_metadata, get_identifier_from_book_isbn};
use enum_models::{ImportSource, MediaLot, MediaSource};
use external_models::audiobookshelf as audiobookshelf_models;
use futures::stream::{self, StreamExt};
use media_models::{
    DeployUrlAndKeyImportInput, ImportOrExportMetadataItemSeen, PartialMetadataWithoutId,
};
use providers::{
    google_books::GoogleBooksService, hardcover::HardcoverService, openlibrary::OpenlibraryService,
};
use reqwest::{
    Client,
    header::{AUTHORIZATION, HeaderValue},
};
use serde_json::json;
use supporting_service::SupportingService;

use super::{ImportFailStep, ImportFailedItem};

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
    let client = get_base_http_client(Some(vec![(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", input.api_key)).unwrap(),
    )]));

    let services = ImportServices {
        ss,
        hardcover_service,
        google_books_service,
        open_library_service,
    };

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
                            step: ImportFailStep::InputTransformation,
                            error: Some("No Google Books ID found".to_string()),
                            ..Default::default()
                        });
                    }
                },
                _ => {
                    return Err(ImportFailedItem {
                        identifier: title,
                        error: Some("No ISBN found".to_string()),
                        step: ImportFailStep::InputTransformation,
                        ..Default::default()
                    });
                }
            }
        } else if let Some(asin) = metadata.asin.clone() {
            (asin, MediaLot::AudioBook, MediaSource::Audible, None)
        } else if let Some(itunes_id) = metadata.itunes_id.clone() {
            let item_details = get_item_details(client, url, &item.id, None)
                .await
                .map_err(|e| ImportFailedItem {
                    error: Some(e.message),
                    identifier: title.clone(),
                    step: ImportFailStep::ItemDetailsFromSource,
                    ..Default::default()
                })?;
            match item_details.media.and_then(|m| m.episodes) {
                Some(episodes) => {
                    let lot = MediaLot::Podcast;
                    let source = MediaSource::Itunes;
                    let mut to_return = vec![];
                    for episode in episodes {
                        ryot_log!(debug, "Importing episode {:?}", episode.title);
                        let episode_details =
                            get_item_details(client, url, &item.id, Some(episode.id.unwrap()))
                                .await
                                .map_err(|e| ImportFailedItem {
                                    error: Some(e.message),
                                    identifier: title.clone(),
                                    step: ImportFailStep::ItemDetailsFromSource,
                                    ..Default::default()
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
                                error: Some(e.message),
                                step: ImportFailStep::ItemDetailsFromSource,
                                ..Default::default()
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
                        error: Some("No episodes found for podcast".to_string()),
                    });
                }
            }
        } else {
            ryot_log!(debug, "No ASIN, ISBN or iTunes ID found {:?}", item);
            return Err(ImportFailedItem {
                identifier: title,
                step: ImportFailStep::InputTransformation,
                error: Some("No ASIN, ISBN or iTunes ID found".to_string()),
                ..Default::default()
            });
        };
    let mut seen_history = vec![];
    if let Some(podcasts) = episodes {
        for episode in podcasts {
            seen_history.push(ImportOrExportMetadataItemSeen {
                podcast_episode_number: Some(episode),
                provider_watched_on: Some(ImportSource::Audiobookshelf.to_string()),
                ..Default::default()
            });
        }
    } else {
        seen_history.push(ImportOrExportMetadataItemSeen {
            provider_watched_on: Some(ImportSource::Audiobookshelf.to_string()),
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
