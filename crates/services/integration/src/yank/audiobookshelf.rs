use std::sync::Arc;

use anyhow::{Result, anyhow};
use application_utils::{get_base_http_client, get_podcast_episode_number_by_name};
use common_models::DefaultCollection;
use common_utils::ryot_log;
use dependent_models::{
    CollectionToEntityDetails, ImportCompletedItem, ImportOrExportMetadataItem, ImportResult,
};
use dependent_utils::{commit_metadata, get_identifier_from_book_isbn};
use enum_models::{MediaLot, MediaSource};
use external_models::audiobookshelf::{self, LibrariesListResponse, ListResponse};
use google_books_provider::GoogleBooksService;
use hardcover_provider::HardcoverService;
use media_models::{ImportOrExportMetadataItemSeen, PartialMetadataWithoutId};
use openlibrary_provider::OpenlibraryService;
use reqwest::{
    Client,
    header::{AUTHORIZATION, HeaderValue},
};
use rust_decimal_macros::dec;
use supporting_service::SupportingService;

fn get_http_client(access_token: &String) -> Client {
    get_base_http_client(Some(vec![(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {access_token}")).unwrap(),
    )]))
}

pub async fn yank_progress(
    base_url: String,
    access_token: String,
    ss: &Arc<SupportingService>,
    hardcover_service: &HardcoverService,
    google_books_service: &GoogleBooksService,
    open_library_service: &OpenlibraryService,
) -> Result<ImportResult> {
    let url = format!("{base_url}/api");
    let client = get_http_client(&access_token);

    let resp = client
        .get(format!("{url}/me/items-in-progress"))
        .send()
        .await
        .map_err(|e| anyhow!(e))?
        .json::<audiobookshelf::Response>()
        .await
        .map_err(|e| anyhow!(e))?;

    ryot_log!(debug, "Got response for items in progress {:?}", resp);

    let mut result = ImportResult::default();

    for item in resp.library_items.iter() {
        let metadata = item.media.clone().unwrap().metadata;

        let update_information = 'ui: {
            if let Some(asin) = metadata.asin.clone() {
                break 'ui Some((
                    item.id.clone(),
                    asin,
                    MediaLot::AudioBook,
                    MediaSource::Audible,
                    None,
                ));
            }
            if let (Some(itunes_id), Some(pe)) = (metadata.itunes_id.clone(), &item.recent_episode)
            {
                let lot = MediaLot::Podcast;
                let source = MediaSource::Itunes;
                let (podcast, _) = commit_metadata(
                    PartialMetadataWithoutId {
                        lot,
                        source,
                        identifier: itunes_id.clone(),
                        ..Default::default()
                    },
                    ss,
                    Some(true),
                )
                .await
                .unwrap();
                if let Some(episode) = podcast
                    .podcast_specifics
                    .and_then(|p| get_podcast_episode_number_by_name(&p, &pe.title))
                {
                    break 'ui Some((
                        format!("{}/{}", item.id, pe.id),
                        itunes_id,
                        lot,
                        source,
                        Some(episode),
                    ));
                }
            };
            if let Some(isbn) = metadata.isbn.clone() {
                if let Some(id) = get_identifier_from_book_isbn(
                    &isbn,
                    hardcover_service,
                    google_books_service,
                    open_library_service,
                )
                .await
                {
                    break 'ui Some((item.id.clone(), id.0, MediaLot::Book, id.1, None));
                };
            };
            None
        };

        let Some((progress_id, identifier, lot, source, podcast_episode_number)) =
            update_information
        else {
            ryot_log!(
                debug,
                "No ASIN, ISBN or iTunes ID found for item {:?}",
                item
            );
            continue;
        };
        match client
            .get(format!("{url}/me/progress/{progress_id}"))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json::<audiobookshelf::ItemProgress>()
            .await
            .map_err(|e| anyhow!(e))
        {
            Ok(resp) => {
                ryot_log!(
                    debug,
                    "Got response for individual item progress {:?}",
                    resp
                );
                let mut progress = resp.progress;
                if let Some(ebook_progress) = resp.ebook_progress {
                    if ebook_progress > progress {
                        progress = ebook_progress;
                    }
                }
                if progress == dec!(1) && resp.is_finished {
                    ryot_log!(debug, "Item {:?} is finished", item);
                    continue;
                }
                result
                    .completed
                    .push(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
                        lot,
                        source,
                        identifier,
                        seen_history: vec![ImportOrExportMetadataItemSeen {
                            podcast_episode_number,
                            progress: Some(progress * dec!(100)),
                            providers_consumed_on: Some(vec!["Audiobookshelf".to_string()]),
                            ..Default::default()
                        }],
                        ..Default::default()
                    }));
            }
            Err(e) => {
                ryot_log!(debug, "Error getting progress for item {:?}: {:?}", item, e);
                continue;
            }
        };
    }
    Ok(result)
}

pub async fn sync_to_owned_collection(
    access_token: String,
    hardcover_service: &HardcoverService,
    google_books_service: &GoogleBooksService,
    open_library_service: &OpenlibraryService,
) -> Result<ImportResult> {
    let client = get_http_client(&access_token);

    let mut result = ImportResult::default();
    let libraries_resp = client
        .get("libraries")
        .send()
        .await
        .map_err(|e| anyhow!(e))?
        .json::<LibrariesListResponse>()
        .await
        .unwrap();
    for library in libraries_resp.libraries {
        let items = client
            .get(format!("libraries/{}/items", library.id))
            .send()
            .await
            .map_err(|e| anyhow!(e))?
            .json::<ListResponse>()
            .await
            .unwrap();
        for item in items.results.into_iter() {
            let metadata = item.media.clone().unwrap().metadata;
            let (identifier, lot, source) =
                if Some("epub".to_string()) == item.media.as_ref().unwrap().ebook_format {
                    match &metadata.isbn {
                        Some(isbn) => match get_identifier_from_book_isbn(
                            isbn,
                            hardcover_service,
                            google_books_service,
                            open_library_service,
                        )
                        .await
                        {
                            Some(data) => (data.0, MediaLot::Book, data.1),
                            _ => continue,
                        },
                        _ => continue,
                    }
                } else if let Some(asin) = metadata.asin.clone() {
                    (asin, MediaLot::AudioBook, MediaSource::Audible)
                } else if let Some(itunes_id) = metadata.itunes_id.clone() {
                    (itunes_id, MediaLot::Podcast, MediaSource::Itunes)
                } else {
                    continue;
                };
            result
                .completed
                .push(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
                    lot,
                    source,
                    identifier,
                    collections: vec![CollectionToEntityDetails {
                        collection_name: DefaultCollection::Owned.to_string(),
                        ..Default::default()
                    }],
                    ..Default::default()
                }));
        }
    }
    Ok(result)
}
