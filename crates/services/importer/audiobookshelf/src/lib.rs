use std::{collections::HashSet, result::Result as StdResult, sync::Arc, time::Duration};

use anyhow::{Context, Result};
use application_utils::get_podcast_episode_number_by_name;
use common_utils::{USER_AGENT_STR, ryot_log, sleep_for_n_seconds};
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
    Client, ClientBuilder,
    header::{AUTHORIZATION, HeaderMap, HeaderValue, USER_AGENT},
};
use supporting_service::SupportingService;

struct ImportServices<'a> {
    ss: &'a Arc<SupportingService>,
    hardcover_service: &'a HardcoverService,
    google_books_service: &'a GoogleBooksService,
    open_library_service: &'a OpenlibraryService,
    finished_podcast_episodes: &'a HashSet<(String, String)>,
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
    let client = build_client(
        &input.api_key,
        input.allow_insecure_connections.unwrap_or(false),
    );

    let me = client
        .get(format!("{url}/me"))
        .send()
        .await?
        .json::<audiobookshelf_models::MeResponse>()
        .await
        .unwrap();
    let finished_podcast_episodes = me
        .media_progress
        .into_iter()
        .filter(|progress| progress.is_finished)
        .filter_map(|progress| Some((progress.library_item_id?, progress.episode_id?)))
        .collect::<HashSet<_>>();

    let services = ImportServices {
        ss,
        hardcover_service,
        google_books_service,
        open_library_service,
        finished_podcast_episodes: &finished_podcast_episodes,
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
            .buffer_unordered(1)
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
            let item_details =
                get_item_details(client, url, &item.id)
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
                        let Some(episode_id) = episode.id.clone() else {
                            continue;
                        };
                        if !services
                            .finished_podcast_episodes
                            .contains(&(item.id.clone(), episode_id))
                        {
                            continue;
                        }
                        ryot_log!(debug, "Importing episode {:?}", episode.title);
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
                        if let Some(pe) = podcast
                            .podcast_specifics
                            .and_then(|p| get_podcast_episode_number_by_name(&p, &episode.title))
                        {
                            to_return.push(pe);
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

const MAX_ITEM_DETAILS_ATTEMPTS: u32 = 3;

async fn get_item_details(
    client: &Client,
    url: &str,
    id: &str,
) -> Result<audiobookshelf_models::Item> {
    let query = serde_json::json!({ "expanded": "1" });
    let request_url = format!("{url}/items/{id}");
    let mut last_error = None;
    for attempt in 0..MAX_ITEM_DETAILS_ATTEMPTS {
        match fetch_item_details(client, &request_url, &query).await {
            Ok(item) => return Ok(item),
            Err(error) => {
                last_error = Some(error);
                if attempt + 1 < MAX_ITEM_DETAILS_ATTEMPTS {
                    let sleep_time = u64::pow(2, attempt + 1);
                    ryot_log!(
                        debug,
                        "Attempt {}/{} failed for {}, retrying in {}s",
                        attempt + 1,
                        MAX_ITEM_DETAILS_ATTEMPTS,
                        request_url,
                        sleep_time
                    );
                    sleep_for_n_seconds(sleep_time).await;
                }
            }
        }
    }
    Err(last_error.unwrap())
}

async fn fetch_item_details(
    client: &Client,
    request_url: &str,
    query: &serde_json::Value,
) -> Result<audiobookshelf_models::Item> {
    let response = client
        .get(request_url)
        .query(query)
        .send()
        .await
        .with_context(|| format!("Network error requesting audiobookshelf API at {request_url}"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        anyhow::bail!("Audiobookshelf returned HTTP {status} (url: {request_url}): {body}");
    }
    serde_json::from_str::<audiobookshelf_models::Item>(&body).with_context(|| {
        format!("Failed to parse JSON from Audiobookshelf response for {request_url}")
    })
}

// Longer timeout than the shared client since podcast item lookups can be slow.
fn build_client(bearer_token: &str, danger_accept_invalid_certs: bool) -> Client {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(USER_AGENT_STR));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {bearer_token}")).unwrap(),
    );
    ClientBuilder::new()
        .default_headers(headers)
        .timeout(Duration::from_secs(60))
        .danger_accept_invalid_certs(danger_accept_invalid_certs)
        .build()
        .unwrap()
}
