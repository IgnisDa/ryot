use anyhow::{anyhow, Result};
use async_trait::async_trait;
use rand::seq::SliceRandom;
use rand::thread_rng;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::json;
use surf::Client;

use crate::{
    config::{AnimeMalConfig, MangaMalConfig},
    migrator::{MetadataLot, MetadataSource},
    models::{
        media::{
            AnimeSpecifics, MangaSpecifics, MediaDetails, MediaSearchItem, MediaSpecifics,
            MetadataImage, MetadataImageLot, PartialMetadata,
        },
        NamedObject, SearchDetails, SearchResults, StoredUrl,
    },
    traits::{MediaProvider, MediaProviderLanguages},
    utils::{convert_date_to_year, convert_string_to_date, get_base_http_client},
};

static URL: &str = "https://api.myanimelist.net/v2/";

#[derive(Debug, Clone)]
pub struct MalService {
    client: Client,
    page_limit: i32,
}

impl MediaProviderLanguages for MalService {
    fn supported_languages() -> Vec<String> {
        ["us"].into_iter().map(String::from).collect()
    }

    fn default_language() -> String {
        "us".to_owned()
    }
}

#[derive(Debug, Clone)]
pub struct MalAnimeService {
    base: MalService,
}

impl MalAnimeService {
    pub async fn new(config: &AnimeMalConfig, page_limit: i32) -> Self {
        let client = get_client_config(URL, &config.client_id).await;
        Self {
            base: MalService { client, page_limit },
        }
    }
}

#[async_trait]
impl MediaProvider for MalAnimeService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let details = details(&self.base.client, "anime", identifier).await?;
        Ok(details)
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MediaSearchItem>> {
        let (items, total, next_page) = search(
            &self.base.client,
            "anime",
            query,
            page,
            self.base.page_limit,
        )
        .await?;
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
    pub async fn new(config: &MangaMalConfig, page_limit: i32) -> Self {
        let client = get_client_config(URL, &config.client_id).await;
        Self {
            base: MalService { client, page_limit },
        }
    }
}

#[async_trait]
impl MediaProvider for MalMangaService {
    async fn details(&self, identifier: &str) -> Result<MediaDetails> {
        let details = details(&self.base.client, "manga", identifier).await?;
        Ok(details)
    }

    async fn search(
        &self,
        query: &str,
        page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MediaSearchItem>> {
        let (items, total, next_page) = search(
            &self.base.client,
            "manga",
            query,
            page,
            self.base.page_limit,
        )
        .await?;
        Ok(SearchResults {
            details: SearchDetails { total, next_page },
            items,
        })
    }
}

async fn get_client_config(url: &str, client_id: &str) -> Client {
    get_base_http_client(url, vec![("X-MAL-CLIENT-ID", client_id)])
}

async fn search(
    client: &Client,
    media_type: &str,
    q: &str,
    page: Option<i32>,
    limit: i32,
) -> Result<(Vec<MediaSearchItem>, i32, Option<i32>)> {
    let page = page.unwrap_or(1);
    let offset = (page - 1) * limit;
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
        .get(media_type)
        .query(&json!({ "q": q, "limit": limit, "offset": offset, "fields": "start_date" }))
        .unwrap()
        .await
        .map_err(|e| anyhow!(e))?
        .body_json()
        .await
        .map_err(|e| anyhow!(e))?;
    let items = search
        .data
        .into_iter()
        .map(|d| MediaSearchItem {
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

async fn details(client: &Client, media_type: &str, id: &str) -> Result<MediaDetails> {
    let details: ItemNode = client
        .get(format!("{}/{}", media_type, id))
        .query(&json!({ "fields": "start_date,end_date,synopsis,genres,status,num_episodes,num_volumes,num_chapters,recommendations,related_manga,related_anime,mean,nsfw" }))
        .unwrap()
        .await
        .map_err(|e| anyhow!(e))?
        .body_json()
        .await
        .map_err(|e| anyhow!(e))?;
    let (lot, specifics) = match media_type {
        "manga" => (
            MetadataLot::Manga,
            MediaSpecifics::Manga(MangaSpecifics {
                chapters: details.num_chapters,
                volumes: details.num_volumes,
                url: None,
            }),
        ),
        "anime" => (
            MetadataLot::Anime,
            MediaSpecifics::Anime(AnimeSpecifics {
                episodes: details.num_episodes,
            }),
        ),
        _ => unreachable!(),
    };
    let mut suggestions = vec![];
    for rel in details.related_anime.unwrap_or_default().into_iter() {
        suggestions.push(PartialMetadata {
            identifier: rel.node.id.to_string(),
            title: rel.node.title,
            image: Some(rel.node.main_picture.large),
            source: MetadataSource::Mal,
            lot: MetadataLot::Anime,
        });
    }
    for rel in details.related_manga.unwrap_or_default().into_iter() {
        suggestions.push(PartialMetadata {
            identifier: rel.node.id.to_string(),
            title: rel.node.title,
            image: Some(rel.node.main_picture.large),
            source: MetadataSource::Mal,
            lot: MetadataLot::Manga,
        });
    }
    for rel in details.recommendations.unwrap_or_default().into_iter() {
        suggestions.push(PartialMetadata {
            identifier: rel.node.id.to_string(),
            title: rel.node.title,
            image: Some(rel.node.main_picture.large),
            source: MetadataSource::Mal,
            lot,
        });
    }
    suggestions.shuffle(&mut thread_rng());
    let is_nsfw = details.nsfw.map(|n| !matches!(n.as_str(), "white"));
    let data = MediaDetails {
        identifier: details.id.to_string(),
        title: details.title,
        source: MetadataSource::Mal,
        description: details.synopsis,
        lot,
        is_nsfw,
        production_status: details.status.unwrap_or_else(|| "Released".to_owned()),
        genres: details
            .genres
            .unwrap_or_default()
            .into_iter()
            .map(|g| g.name)
            .collect(),
        images: vec![MetadataImage {
            url: StoredUrl::Url(details.main_picture.large),
            lot: MetadataImageLot::Poster,
        }],
        specifics,
        publish_year: details
            .start_date
            .clone()
            .and_then(|d| convert_date_to_year(&d)),
        publish_date: details.start_date.and_then(|d| convert_string_to_date(&d)),
        suggestions,
        provider_rating: details.mean,
        creators: vec![],
        videos: vec![],
        groups: vec![],
    };
    Ok(data)
}
