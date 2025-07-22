use anyhow::{Result, anyhow};
use application_utils::get_base_http_client;
use async_trait::async_trait;
use common_models::{EntityAssets, MetadataSearchSourceSpecifics, NamedObject, SearchDetails};
use common_utils::{PAGE_SIZE, convert_date_to_year, convert_string_to_date};
use convert_case::{Case, Casing};
use dependent_models::SearchResults;
use enum_models::{MediaLot, MediaSource};
use media_models::{
    AnimeSpecifics, MangaSpecifics, MetadataDetails, MetadataSearchItem, PartialMetadataWithoutId,
};
use rand::{rng, seq::SliceRandom};
use reqwest::{
    Client,
    header::{HeaderName, HeaderValue},
};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::json;
use traits::MediaProvider;

static URL: &str = "https://api.myanimelist.net/v2";

#[derive(Debug, Clone)]
pub struct MalService {
    client: Client,
}

#[derive(Debug, Clone)]
pub struct NonMediaMalService {}

impl NonMediaMalService {
    pub async fn new() -> Result<Self> {
        Ok(Self {})
    }
}

#[async_trait]
impl MediaProvider for NonMediaMalService {}

#[derive(Debug, Clone)]
pub struct MalAnimeService {
    base: MalService,
}

impl MalAnimeService {
    pub async fn new(config: &config::MalConfig) -> Result<Self> {
        let client = get_client_config(&config.client_id).await;
        Ok(Self {
            base: MalService { client },
        })
    }
}

#[async_trait]
impl MediaProvider for MalAnimeService {
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let details = details(&self.base.client, "anime", identifier).await?;
        Ok(details)
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let (items, total, next_page) = search(&self.base.client, "anime", query, page).await?;
        Ok(SearchResults {
            details: SearchDetails { total, next_page },
            items,
        })
    }
}

#[derive(Debug, Clone)]
pub struct MalMangaService {
    base: MalService,
}

impl MalMangaService {
    pub async fn new(config: &config::MalConfig) -> Result<Self> {
        let client = get_client_config(&config.client_id).await;
        Ok(Self {
            base: MalService { client },
        })
    }
}

#[async_trait]
impl MediaProvider for MalMangaService {
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let details = details(&self.base.client, "manga", identifier).await?;
        Ok(details)
    }

    async fn metadata_search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let (items, total, next_page) = search(&self.base.client, "manga", query, page).await?;
        Ok(SearchResults {
            details: SearchDetails { total, next_page },
            items,
        })
    }
}

async fn get_client_config(client_id: &str) -> Client {
    get_base_http_client(Some(vec![(
        HeaderName::from_static("x-mal-client-id"),
        HeaderValue::from_str(client_id).unwrap(),
    )]))
}

async fn search(
    client: &Client,
    media_type: &str,
    query: &str,
    page: Option<i32>,
) -> Result<(Vec<MetadataSearchItem>, i32, Option<i32>)> {
    let page = page.unwrap_or(1);
    let offset = (page - 1) * PAGE_SIZE;
    #[derive(Serialize, Deserialize, Debug)]
    struct SearchPaging {
        next: Option<String>,
    }
    #[derive(Serialize, Deserialize, Debug)]
    struct SearchResponse {
        data: Vec<ItemData>,
        paging: SearchPaging,
    }
    let search: SearchResponse = client
        .get(format!("{}/{}", URL, media_type))
        .query(&json!({ "q": query, "limit": PAGE_SIZE, "offset": offset, "fields": "start_date" }))
        .send()
        .await
        .map_err(|e| anyhow!(e))?
        .json()
        .await
        .map_err(|e| anyhow!(e))?;
    let items = search
        .data
        .into_iter()
        .map(|d| MetadataSearchItem {
            identifier: d.node.id.to_string(),
            title: d.node.title,
            publish_year: d.node.start_date.and_then(|d| convert_date_to_year(&d)),
            image: Some(d.node.main_picture.large),
        })
        .collect();
    Ok((items, 100, search.paging.next.map(|_| page + 1)))
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemImage {
    large: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemNode {
    id: i128,
    title: String,
    main_picture: ItemImage,
    nsfw: Option<String>,
    synopsis: Option<String>,
    genres: Option<Vec<NamedObject>>,
    studios: Option<Vec<NamedObject>>,
    start_date: Option<String>,
    mean: Option<Decimal>,
    status: Option<String>,
    num_episodes: Option<i32>,
    num_chapters: Option<i32>,
    num_volumes: Option<i32>,
    related_anime: Option<Vec<ItemData>>,
    related_manga: Option<Vec<ItemData>>,
    recommendations: Option<Vec<ItemData>>,
}

#[derive(Serialize, Deserialize, Debug)]
struct ItemData {
    node: ItemNode,
}

async fn details(client: &Client, media_type: &str, id: &str) -> Result<MetadataDetails> {
    let details: ItemNode = client
        .get(format!("{}/{}/{}", URL, media_type, id))
        .query(&json!({ "fields": "start_date,end_date,synopsis,genres,status,num_episodes,num_volumes,num_chapters,recommendations,related_manga,related_anime,mean,nsfw" }))
        .send()
        .await
        .map_err(|e| anyhow!(e))?
        .json()
        .await
        .map_err(|e| anyhow!(e))?;
    let lot = match media_type {
        "manga" => MediaLot::Manga,
        "anime" => MediaLot::Anime,
        _ => unreachable!(),
    };
    let manga_specifics =
        details
            .num_volumes
            .zip(details.num_chapters)
            .map(|(v, c)| MangaSpecifics {
                volumes: Some(v),
                chapters: Some(Decimal::from(c)),
                ..Default::default()
            });
    let anime_specifics = details.num_episodes.map(|e| AnimeSpecifics {
        episodes: Some(e),
        ..Default::default()
    });
    let mut suggestions = vec![];
    for rel in details.related_anime.unwrap_or_default().into_iter() {
        suggestions.push(PartialMetadataWithoutId {
            lot: MediaLot::Anime,
            title: rel.node.title,
            source: MediaSource::Myanimelist,
            identifier: rel.node.id.to_string(),
            image: Some(rel.node.main_picture.large),
            ..Default::default()
        });
    }
    for rel in details.related_manga.unwrap_or_default().into_iter() {
        suggestions.push(PartialMetadataWithoutId {
            lot: MediaLot::Manga,
            title: rel.node.title,
            source: MediaSource::Myanimelist,
            identifier: rel.node.id.to_string(),
            image: Some(rel.node.main_picture.large),
            ..Default::default()
        });
    }
    for rel in details.recommendations.unwrap_or_default().into_iter() {
        suggestions.push(PartialMetadataWithoutId {
            lot,
            title: rel.node.title,
            source: MediaSource::Myanimelist,
            identifier: rel.node.id.to_string(),
            image: Some(rel.node.main_picture.large),
            ..Default::default()
        });
    }
    suggestions.shuffle(&mut rng());
    let is_nsfw = details.nsfw.map(|n| !matches!(n.as_str(), "white"));
    let identifier = details.id.to_string();
    let title = details.title;
    let data = MetadataDetails {
        lot,
        is_nsfw,
        suggestions,
        anime_specifics,
        manga_specifics,
        title: title.clone(),
        source: MediaSource::Myanimelist,
        description: details.synopsis,
        provider_rating: details.mean,
        identifier: identifier.clone(),
        source_url: Some(format!(
            "https://myanimelist.net/{}/{}/{}",
            media_type, identifier, title
        )),
        production_status: details.status.map(|s| s.to_case(Case::Title)),
        publish_date: details
            .start_date
            .clone()
            .and_then(|d| convert_string_to_date(&d)),
        publish_year: details
            .start_date
            .clone()
            .and_then(|d| convert_date_to_year(&d)),
        assets: EntityAssets {
            remote_images: vec![details.main_picture.large],
            ..Default::default()
        },
        genres: details
            .genres
            .unwrap_or_default()
            .into_iter()
            .map(|g| g.name)
            .collect(),
        ..Default::default()
    };
    Ok(data)
}
