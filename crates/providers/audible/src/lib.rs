use anyhow::Result;
use async_trait::async_trait;
use common_models::{EntityAssets, NamedObject, PersonSourceSpecifics, SearchDetails};
use common_utils::get_base_http_client;
use common_utils::{PAGE_SIZE, compute_next_page, convert_date_to_year, convert_string_to_date};
use config_definition::AudibleLocale;
use convert_case::{Case, Casing};
use database_models::metadata_group::MetadataGroupWithoutId;
use dependent_models::{MetadataSearchSourceSpecifics, PersonDetails, SearchResults};
use educe::Educe;
use enum_models::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    AudioBookSpecifics, CommitMetadataGroupInput, MetadataDetails, MetadataFreeCreator,
    MetadataSearchItem, PartialMetadataPerson, PartialMetadataWithoutId, PeopleSearchItem,
    UniqueMediaIdentifier,
};
use paginate::Pages;
use reqwest::Client;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use strum::{Display, EnumIter, IntoEnumIterator};
use traits::MediaProvider;

static AUDNEX_URL: &str = "https://api.audnex.us";

#[derive(EnumIter, Display)]
enum AudibleSimilarityType {
    InTheSameSeries,
    RawSimilarities,
    ByTheSameAuthor,
    NextInSameSeries,
    ByTheSameNarrator,
}

#[derive(Serialize, Deserialize, Educe)]
#[educe(Default)]
struct PrimaryQuery {
    #[educe(Default = "2400")]
    image_sizes: String,
    #[educe(
        Default = "contributors,category_ladders,media,product_attrs,product_extended_attrs,series,relationships,rating"
    )]
    response_groups: String,
}

#[derive(Serialize, Deserialize)]
struct SearchQuery {
    page: u64,
    title: String,
    num_results: u64,
    #[serde(flatten)]
    primary: PrimaryQuery,
    products_sort_by: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AudiblePoster {
    #[serde(rename = "500")]
    image_500: Option<String>,
    #[serde(rename = "2400")]
    image_2400: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AudibleCategoryLadderCollection {
    ladder: Vec<NamedObject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AudibleRelationshipItem {
    asin: String,
    sort: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AudibleRating {
    display_average_rating: Option<Decimal>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AudibleRatings {
    num_reviews: i32,
    overall_distribution: AudibleRating,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AudibleAuthor {
    name: String,
    asin: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AudibleItem {
    asin: String,
    title: String,
    release_date: Option<String>,
    rating: Option<AudibleRatings>,
    is_adult_product: Option<bool>,
    runtime_length_min: Option<i32>,
    series: Option<Vec<AudibleItem>>,
    publisher_summary: Option<String>,
    authors: Option<Vec<AudibleAuthor>>,
    narrators: Option<Vec<NamedObject>>,
    product_images: Option<AudiblePoster>,
    merchandising_summary: Option<String>,
    relationships: Option<Vec<AudibleRelationshipItem>>,
    category_ladders: Option<Vec<AudibleCategoryLadderCollection>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct AudnexResponse {
    asin: String,
    name: String,
    image: Option<String>,
    description: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct AudibleItemResponse {
    product: AudibleItem,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct AudibleItemSimResponse {
    similar_products: Vec<AudibleItem>,
}

#[derive(Debug, Clone)]
pub struct AudibleService {
    url: String,
    client: Client,
    locale: AudibleLocale,
}

impl AudibleService {
    fn url_from_locale(locale: &AudibleLocale) -> String {
        let suffix = match locale {
            AudibleLocale::ES => "es",
            AudibleLocale::IT => "it",
            AudibleLocale::CA => "ca",
            AudibleLocale::FR => "fr",
            AudibleLocale::DE => "de",
            AudibleLocale::US => "com",
            AudibleLocale::JP => "co.jp",
            AudibleLocale::IN => "co.in",
            AudibleLocale::AU => "com.au",
            AudibleLocale::GB | AudibleLocale::UK => "co.uk",
        };
        format!("https://api.audible.{suffix}/1.0/catalog/products")
    }

    pub async fn new(config: &config_definition::AudibleConfig) -> Result<Self> {
        let url = Self::url_from_locale(&config.locale);
        let client = get_base_http_client(None);
        Ok(Self {
            url,
            client,
            locale: config.locale.clone(),
        })
    }

    pub fn get_all_languages(&self) -> Vec<String> {
        AudibleLocale::iter().map(|l| l.to_string()).collect()
    }

    pub fn get_default_language(&self) -> String {
        AudibleLocale::US.to_string()
    }
}

#[async_trait]
impl MediaProvider for AudibleService {
    async fn people_search(
        &self,
        page: u64,
        query: &str,
        _display_nsfw: bool,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let internal_page: usize = page.try_into().unwrap();
        let req_internal_page = internal_page.saturating_sub(1);
        let data: Vec<AudibleAuthor> = self
            .client
            .get(format!("{AUDNEX_URL}/authors"))
            .query(&[("name", query), ("region", &self.locale.to_string())])
            .send()
            .await?
            .json()
            .await?;
        let data = data
            .into_iter()
            .map(|a| PeopleSearchItem {
                identifier: a.asin.unwrap_or_default(),
                name: a.name,
                ..Default::default()
            })
            .collect_vec();
        let total_items = data.len();
        let pages = Pages::new(total_items, PAGE_SIZE.try_into().unwrap());
        let selected_page = pages.with_offset(req_internal_page);
        let items = data[selected_page.start..selected_page.end + 1].to_vec();
        let has_next_page = pages.page_count() > internal_page;
        Ok(SearchResults {
            items,
            details: SearchDetails {
                total_items: total_items.try_into().unwrap(),
                next_page: has_next_page.then(|| (internal_page + 1).try_into().unwrap()),
            },
        })
    }

    async fn person_details(
        &self,
        identity: &str,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
        let data: AudnexResponse = self
            .client
            .get(format!("{AUDNEX_URL}/authors/{identity}"))
            .query(&[("region", &self.locale.to_string())])
            .send()
            .await?
            .json()
            .await?;
        let name = data.name;
        Ok(PersonDetails {
            name: name.clone(),
            description: data.description,
            assets: EntityAssets {
                remote_images: Vec::from_iter(data.image),
                ..Default::default()
            },
            source_url: Some(format!("https://www.audible.com/author/{name}/{identity}")),
            ..Default::default()
        })
    }

    async fn metadata_group_details(
        &self,
        identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
        let data: AudibleItemResponse = self
            .client
            .get(format!("{}/{}", self.url, identifier))
            .query(&PrimaryQuery::default())
            .send()
            .await?
            .json()
            .await?;
        let items = data
            .product
            .relationships
            .unwrap()
            .into_iter()
            .sorted_by_key(|f| f.sort.parse::<i32>().unwrap())
            .map(|i| i.asin)
            .collect_vec();
        let mut collection_contents = vec![];
        for i in items {
            let rsp = self
                .client
                .get(format!("{}/{}", self.url, i))
                .query(&PrimaryQuery::default())
                .send()
                .await?;
            let data: AudibleItemResponse = rsp.json().await?;
            collection_contents.push(PartialMetadataWithoutId {
                identifier: i,
                lot: MediaLot::AudioBook,
                title: data.product.title,
                source: MediaSource::Audible,
                image: data.product.product_images.and_then(|i| i.image_2400),
                ..Default::default()
            });
        }
        let title = data.product.title;
        Ok((
            MetadataGroupWithoutId {
                title: title.clone(),
                lot: MediaLot::AudioBook,
                source: MediaSource::Audible,
                identifier: identifier.to_owned(),
                parts: collection_contents.len().try_into().unwrap(),
                source_url: Some(format!(
                    "https://www.audible.com/series/{identifier}/{title}"
                )),
                ..Default::default()
            },
            collection_contents,
        ))
    }

    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let rsp = self
            .client
            .get(format!("{}/{}", self.url, identifier))
            .query(&PrimaryQuery::default())
            .send()
            .await?;
        let data: AudibleItemResponse = rsp.json().await?;
        let mut item = self.audible_response_to_search_response(data.product.clone());
        let mut groups = vec![];
        let mut suggestions = vec![];
        for s in data.product.series.unwrap_or_default() {
            groups.push(CommitMetadataGroupInput {
                name: s.title,
                unique: UniqueMediaIdentifier {
                    identifier: s.asin,
                    lot: MediaLot::AudioBook,
                    source: MediaSource::Audible,
                },
                ..Default::default()
            });
        }
        for sim_type in AudibleSimilarityType::iter() {
            let data: AudibleItemSimResponse = self
                .client
                .get(format!("{}/{}/sims", self.url, identifier))
                .query(&[
                    ("response_groups", "media"),
                    ("similarity_type", sim_type.to_string().as_str()),
                ])
                .send()
                .await?
                .json()
                .await?;
            for sim in data.similar_products.into_iter() {
                suggestions.push(PartialMetadataWithoutId {
                    title: sim.title,
                    identifier: sim.asin,
                    lot: MediaLot::AudioBook,
                    source: MediaSource::Audible,
                    image: sim.product_images.and_then(|i| i.image_500),
                    ..Default::default()
                });
            }
        }
        item.groups = groups;
        item.suggestions = suggestions.into_iter().unique().collect();
        Ok(item)
    }

    async fn metadata_search(
        &self,
        page: u64,
        query: &str,
        _display_nsfw: bool,
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        #[derive(Serialize, Deserialize, Debug)]
        struct AudibleSearchResponse {
            total_results: u64,
            products: Vec<AudibleItem>,
        }
        let rsp = self
            .client
            .get(&self.url)
            .query(&SearchQuery {
                num_results: PAGE_SIZE,
                title: query.to_owned(),
                page: page.saturating_sub(1),
                primary: PrimaryQuery::default(),
                products_sort_by: "Relevance".to_owned(),
            })
            .send()
            .await?;
        let search: AudibleSearchResponse = rsp.json().await?;
        let resp = search
            .products
            .into_iter()
            .map(|d| {
                let a = self.audible_response_to_search_response(d.clone());
                MetadataSearchItem {
                    title: a.title,
                    identifier: d.asin,
                    publish_year: a.publish_year,
                    image: a.assets.remote_images.first().cloned(),
                }
            })
            .collect_vec();
        let next_page = compute_next_page(page, PAGE_SIZE, search.total_results);
        Ok(SearchResults {
            items: resp,
            details: SearchDetails {
                next_page,
                total_items: search.total_results,
            },
        })
    }
}

impl AudibleService {
    fn audible_response_to_search_response(&self, item: AudibleItem) -> MetadataDetails {
        let images = Vec::from_iter(item.product_images.and_then(|i| i.image_2400));
        let release_date = item.release_date.unwrap_or_default();
        let people = item
            .authors
            .unwrap_or_default()
            .into_iter()
            .filter_map(|a| {
                a.asin.map(|au| PartialMetadataPerson {
                    name: a.name,
                    identifier: au,
                    role: "Author".to_owned(),
                    source: MediaSource::Audible,
                    ..Default::default()
                })
            })
            .collect_vec();
        let creators = item
            .narrators
            .unwrap_or_default()
            .into_iter()
            .map(|a| MetadataFreeCreator {
                name: a.name,
                role: "Narrator".to_owned(),
            })
            .collect_vec();
        let description = item.publisher_summary.or(item.merchandising_summary);
        let rating = match item.rating {
            Some(r) if r.num_reviews > 0 => r.overall_distribution.display_average_rating,
            _ => None,
        };
        let assets = EntityAssets {
            remote_images: images,
            ..Default::default()
        };
        MetadataDetails {
            people,
            creators,
            description,
            assets,
            provider_rating: rating,
            title: item.title.clone(),
            is_nsfw: item.is_adult_product,
            source_url: Some(format!(
                "https://www.audible.com/pd/{}/{}",
                item.title, item.asin
            )),
            genres: item
                .category_ladders
                .unwrap_or_default()
                .into_iter()
                .flat_map(|c| {
                    c.ladder
                        .into_iter()
                        .map(|l| l.name)
                        .flat_map(|c| c.split(" & ").map(|g| g.to_case(Case::Title)).collect_vec())
                })
                .unique()
                .collect(),
            publish_year: convert_date_to_year(&release_date),
            publish_date: convert_string_to_date(&release_date),
            audio_book_specifics: Some(AudioBookSpecifics {
                runtime: item.runtime_length_min,
            }),
            ..Default::default()
        }
    }
}
