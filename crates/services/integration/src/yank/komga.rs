use std::{
    collections::{HashMap, hash_map::Entry},
    sync::{Mutex, OnceLock},
};

use anyhow::{Context, Result, anyhow, bail};
use application_utils::get_base_http_client;
use async_graphql::futures_util::{StreamExt, stream};
use common_models::DefaultCollection;
use common_utils::{ryot_log, sleep_for_n_seconds};
use database_models::{metadata, prelude::Metadata};
use dependent_models::{
    CollectionToEntityDetails, ImportCompletedItem, ImportOrExportMetadataItem, ImportResult,
};
use enum_models::{MediaLot, MediaSource};
use eventsource_stream::Eventsource;
use itertools::Itertools;
use media_models::{ImportOrExportMetadataItemSeen, UniqueMediaIdentifier};
use reqwest::Url;
use rust_decimal::{Decimal, prelude::FromPrimitive};
use rust_decimal_macros::dec;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use sea_query::Expr;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use tokio::sync::{mpsc, mpsc::UnboundedReceiver, mpsc::error::TryRecvError};

mod komga_book {
    use super::*;

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Link {
        pub label: String,
        pub url: String,
    }

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
        pub name: String,
        pub series_id: String,
        pub media: Media,
        pub number: i32,
        pub metadata: Metadata,
        pub read_progress: ReadProgress,
    }
}

mod komga_series {
    use super::*;

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Link {
        pub label: String,
        pub url: String,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Metadata {
        pub links: Vec<Link>,
    }

    impl Metadata {
        /// Provided with a url this will extract the ID number from it. For example the
        /// url https://myanimelist.net/manga/116778 will extract 116778
        ///
        /// Currently only works for MAL and anilist as MangaUpdates doesn't store the ID
        /// in the url
        ///
        /// # Arguments
        ///
        /// * `url`: The url to extract from
        ///
        /// returns: The ID number if the extraction is successful
        fn extract_id(&self, url: String) -> Option<String> {
            Url::parse(&url).ok().and_then(|parsed_url| {
                parsed_url
                    .path_segments()
                    .and_then(|segments| segments.collect::<Vec<_>>().get(1).cloned())
                    .map(String::from)
            })
        }

        /// Extracts the list of providers with a MediaSource,ID Tuple
        ///
        /// Currently only works for MAL and Anilist as MangaUpdates doesn't store the ID
        /// in the url
        ///
        /// Requires that the metadata is stored with the label Anilist or MAL other
        /// spellings wont work
        ///
        /// returns: list of providers with a MediaSource, ID Tuple
        pub fn find_providers(&self) -> Vec<(MediaSource, Option<String>)> {
            let mut provider_links = vec![];
            for link in self.links.iter() {
                // NOTE: manga_updates doesn't work here because the ID isn't in the url
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
        pub id: String,
        pub name: String,
        pub books_count: Decimal,
        pub books_read_count: Option<i32>,
        pub books_unread_count: Decimal,
        pub metadata: Metadata,
    }

    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Response {
        pub content: Vec<Item>,
    }
}

mod komga_events {
    use super::*;

    #[derive(Debug, Serialize, Deserialize, Clone)]
    #[serde(rename_all = "camelCase")]
    pub struct Data {
        pub book_id: String,
        pub user_id: String,
    }
}

struct KomgaEventHandler {
    task: OnceLock<()>,
    receiver: Mutex<Option<UnboundedReceiver<komga_events::Data>>>,
}

impl KomgaEventHandler {
    pub const fn new() -> Self {
        Self {
            task: OnceLock::new(),
            receiver: Mutex::new(None),
        }
    }

    pub fn get_receiver(&self) -> &Mutex<Option<UnboundedReceiver<komga_events::Data>>> {
        &self.receiver
    }

    pub fn get_task(&self) -> &OnceLock<()> {
        &self.task
    }
}

type ProcessEventReturn = (UniqueMediaIdentifier, ImportOrExportMetadataItemSeen);

/// Generates the sse listener for komga. This is intended to be run from another
/// thread if you run this in the main thread it will lock it up
///
/// # Arguments
///
/// * `sender`: The unbounded sender, lifetime of this sender is the lifetime of this
///   function so the sender doesn't need global lifetime
/// * `base_url`: URL for komga
/// * `komga_username`: The komga username
/// * `komga_password`: The komga password
///
/// returns: Never Returns
async fn sse_listener(
    sender: mpsc::UnboundedSender<komga_events::Data>,
    base_url: String,
    komga_username: String,
    komga_password: String,
) -> Result<(), Box<dyn std::error::Error>> {
    let url = format!("{}/sse/v1", base_url);
    let client = get_base_http_client(None);

    loop {
        let response = client
            .get(format!("{}/events", url))
            .basic_auth(komga_username.to_string(), Some(komga_password.to_string()))
            .send()
            .await
            .context("Failed to send request")?;

        let mut stream = response.bytes_stream().eventsource();

        while let Some(event) = stream.next().await {
            let event = event.context("Failed to get next event")?;
            ryot_log!(debug, ?event, "Received SSE event");

            // We could also handle ReadProgressDeleted here but I don't
            // think we want to handle any deletions like this
            if event.event == "ReadProgressChanged" {
                match serde_json::from_str::<komga_events::Data>(&event.data) {
                    Ok(read_progress) => {
                        if sender.send(read_progress).is_err() {
                            ryot_log!(debug, "Receiver dropped, exiting SSE listener");
                            break;
                        }
                    }
                    Err(e) => {
                        ryot_log!(warn, error = ?e, data = ?event.data,
                                "Failed to parse ReadProgressChanged event data");
                    }
                }
            } else {
                ryot_log!(trace, event_type = ?event.event, "Received unhandled event type");
            }
        }

        ryot_log!(trace, "SSE listener finished");
        sleep_for_n_seconds(30).await;
    }
}

/// Fetches an API request to the provided client URL like
/// `https://acme.com/api_endpoint/api_id`
///
/// # Arguments
///
/// * `client`: Pre-populated client. Use `get_base_http_client` to construct this
/// * `cookie`: The komga cookie with the remember-me included
/// * `api_endpoint`: Endpoint which comes after the base_url doesn't require a
///   prepended `/`
/// * `api_id`: The ID of the object you are searching for added to the end of the
///   api_endpoint doesn't require a prepended `/`
///
/// returns: This only preforms basic error handling on the json parsing
async fn fetch_api<T: DeserializeOwned>(
    username: &String,
    password: &String,
    client: &reqwest::Client,
    api_endpoint: &str,
    api_id: &str,
) -> Result<T> {
    client
        .get(format!("{}/{}", api_endpoint, api_id))
        .basic_auth(username, Some(password))
        .send()
        .await?
        .error_for_status()?
        .json::<T>()
        .await
        .map_err(|e| anyhow!("Failed to parse JSON: {}", e))
}

/// Finds the metadata provider and ID of the provided series
///
/// # Arguments
///
/// * `series`: The series object from which we want to grab the provider from. There
///   should be a links section which is populated with urls from which we
///   can extract the series ID. If not a simple search of the db for a manga
///   with the same title will be preformed
///
/// returns: This contains the MediaSource and the ID of the series.
async fn find_provider_and_id(
    source: MediaSource,
    db: &DatabaseConnection,
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
            .one(db)
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

async fn process_events(
    username: &String,
    password: &String,
    base_url: &String,
    source: MediaSource,
    db: &DatabaseConnection,
    data: komga_events::Data,
) -> Result<ProcessEventReturn> {
    let url = format!("{}/api/v1", base_url);
    let client = get_base_http_client(None);

    let book: komga_book::Item = fetch_api(
        username,
        password,
        &client,
        &format!("{}/books", &url),
        &data.book_id,
    )
    .await?;
    let series: komga_series::Item = fetch_api(
        username,
        password,
        &client,
        &format!("{}/series", &url),
        &book.series_id,
    )
    .await?;

    let (source, id) = find_provider_and_id(source, db, &series).await?;

    let Some(id) = id else {
        let msg = format!(
            "No MAL URL or database entry found for manga: {}",
            series.name
        );
        ryot_log!(debug, msg);
        bail!(msg)
    };

    Ok((
        UniqueMediaIdentifier {
            source,
            identifier: id,
            lot: MediaLot::Manga,
        },
        ImportOrExportMetadataItemSeen {
            progress: Some(calculate_percentage(
                book.read_progress.page,
                book.media.pages_count,
            )),
            provider_watched_on: Some("Komga".to_string()),
            manga_chapter_number: Some(book.metadata.number.parse().unwrap_or_default()),
            ..Default::default()
        },
    ))
}

pub async fn yank_progress(
    base_url: String,
    username: String,
    password: String,
    source: MediaSource,
    db: &DatabaseConnection,
) -> Result<ImportResult> {
    let mut result = ImportResult::default();
    // DEV: This object needs global lifetime so we can continue to use the receiver if
    // we ever create more SSE Objects we may want to implement a higher level
    // Controller or make a housekeeping function to make sure the background threads
    // are running correctly and kill them when the app is killed.
    static SSE_LISTS: KomgaEventHandler = KomgaEventHandler::new();

    let mutex_receiver = SSE_LISTS.get_receiver();
    let mut receiver = {
        let mut guard = mutex_receiver.lock().unwrap();
        guard.take()
    };

    if receiver.is_none() {
        let (tx, rx) = mpsc::unbounded_channel::<komga_events::Data>();
        receiver = Some(rx);

        let base_url = base_url.to_string();
        let mutex_task = SSE_LISTS.get_task();
        let komga_username = username.to_string();
        let komga_password = password.to_string();

        mutex_task.get_or_init(|| {
            tokio::spawn(async move {
                if let Err(e) = sse_listener(tx, base_url, komga_username, komga_password).await {
                    ryot_log!(debug, "SSE listener error: {}", e);
                }
            });
        });
    }

    // Use hashmap here so we don't dupe pulls for a single book
    let mut unique_media_items: HashMap<String, ProcessEventReturn> = HashMap::new();

    if let Some(mut recv) = receiver {
        loop {
            match recv.try_recv() {
                Ok(event) => {
                    ryot_log!(debug, "Received event {:?}", event);
                    match unique_media_items.entry(event.book_id.clone()) {
                        Entry::Vacant(entry) => {
                            if let Ok(processed_event) = process_events(
                                &username,
                                &password,
                                &base_url,
                                source,
                                db,
                                event.clone(),
                            )
                            .await
                            {
                                entry.insert(processed_event);
                            } else {
                                ryot_log!(
                                    warn,
                                    "Failed to process event for book_id: {}",
                                    event.book_id
                                );
                            }
                        }
                        _ => continue,
                    }
                }
                Err(TryRecvError::Empty) => break,
                Err(e) => bail!("Receiver error: {}", e),
            }
        }

        // Put the receiver back
        mutex_receiver.lock().unwrap().replace(recv);
    }

    let media_items = unique_media_items.into_values().collect_vec();
    ryot_log!(debug, "Media Items: {:?}", media_items);
    media_items.into_iter().for_each(|(commit, hist)| {
        result
            .completed
            .push(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
                lot: commit.lot,
                source: commit.source,
                seen_history: vec![hist],
                identifier: commit.identifier,
                ..Default::default()
            }));
    });

    Ok(result)
}

pub async fn sync_to_owned_collection(
    base_url: String,
    username: String,
    password: String,
    source: MediaSource,
    db: &DatabaseConnection,
) -> Result<ImportResult> {
    let mut result = ImportResult::default();
    let url = &format!("{}/api/v1", base_url);
    let client = get_base_http_client(None);

    let series: komga_series::Response = client
        .get(format!("{}/{}", url, "series?unpaged=true"))
        .basic_auth(username, Some(password))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    // Hashmap for if you have the same manga in multiple languages it will appear
    // multiple times this prevents us from double committing an identifier
    let unique_collection_updates: HashMap<String, _> = stream::iter(series.content)
        .filter_map(|book| async move {
            match find_provider_and_id(source, db, &book).await {
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
                    tracing::debug!("No URL or database entry found for manga: {}", book.name);
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
