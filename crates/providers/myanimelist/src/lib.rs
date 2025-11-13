use anyhow::Result;
use async_trait::async_trait;
use common_models::{EntityAssets, NamedObject, SearchDetails};
use common_utils::get_base_http_client;
use common_utils::{PAGE_SIZE, convert_date_to_year, convert_string_to_date};
use convert_case::{Case, Casing};
use dependent_models::{MetadataSearchSourceSpecifics, SearchResults};
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
pub struct MalAnimeService(MalService);

impl MalAnimeService {
    pub async fn new(config: &config_definition::MalConfig) -> Result<Self> {
        let client = get_client_config(&config.client_id).await;
        Ok(Self(MalService { client }))
    }
}

#[async_trait]
impl MediaProvider for MalAnimeService {
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let details = details(&self.0.client, "anime", identifier).await?;
        Ok(details)
    }

    async fn metadata_search(
        &self,
        page: u64,
        query: &str,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let (items, total_items, next_page) = search(&self.0.client, "anime", query, page).await?;
        Ok(SearchResults {
            items,
            details: SearchDetails {
                next_page,
                total_items,
            },
        })
    }
}

#[derive(Debug, Clone)]
pub struct MalMangaService(MalService);

impl MalMangaService {
    pub async fn new(config: &config_definition::MalConfig) -> Result<Self> {
        let client = get_client_config(&config.client_id).await;
        Ok(Self(MalService { client }))
    }
}

#[async_trait]
impl MediaProvider for MalMangaService {
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let details = details(&self.0.client, "manga", identifier).await?;
        Ok(details)
    }

    async fn metadata_search(
        &self,
        page: u64,
        query: &str,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let (items, total_items, next_page) = search(&self.0.client, "manga", query, page).await?;
        Ok(SearchResults {
            items,
            details: SearchDetails {
                next_page,
                total_items,
            },
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
    page: u64,
) -> Result<(Vec<MetadataSearchItem>, u64, Option<u64>)> {
    let offset = page.saturating_sub(1) * PAGE_SIZE;
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
        .get(format!("{URL}/{media_type}"))
        .query(&[
            ("q", query),
            ("fields", "start_date"),
            ("offset", &offset.to_string()),
            ("limit", &PAGE_SIZE.to_string()),
        ])
        .send()
        .await?
        .json()
        .await?;
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
        .get(format!("{URL}/{media_type}/{id}"))
        .query(&[("fields", "start_date,end_date,synopsis,genres,status,num_episodes,num_volumes,num_chapters,recommendations,related_manga,related_anime,mean,nsfw")])
        .send()
        .await
        ?
        .json()
        .await
        ?;
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
        is_nsfw,
        suggestions,
        anime_specifics,
        manga_specifics,
        title: title.clone(),
        description: details.synopsis,
        provider_rating: details.mean,
        source_url: Some(format!(
            "https://myanimelist.net/{media_type}/{identifier}/{title}"
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
