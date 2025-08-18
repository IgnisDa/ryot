use std::{cmp::Reverse, collections::HashMap, sync::Arc};

use anyhow::{Result, anyhow};
use common_models::SearchDetails;
use database_models::{
    entity_to_entity,
    prelude::{EntityToEntity, Genre, MetadataGroup, Person},
};
use database_utils::{transform_entity_assets, user_by_id};
use dependent_entity_utils::generic_metadata;
use dependent_models::{
    GenreDetails, GraphqlPersonDetails, MetadataBaseData, MetadataGroupDetails, SearchResults,
};
use futures::{TryFutureExt, try_join};
use itertools::Itertools;
use media_models::{
    GenreDetailsInput, GenreListItem, GraphqlMetadataDetails, GraphqlMetadataGroup,
    PersonDetailsGroupedByRole, PersonDetailsItemWithCharacter,
};
use sea_orm::{
    ColumnTrait, EntityTrait, ItemsAndPagesNumber, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect,
};
use supporting_service::SupportingService;

pub async fn person_details(
    person_id: String,
    ss: &Arc<SupportingService>,
) -> Result<GraphqlPersonDetails> {
    let mut details = Person::find_by_id(person_id.clone())
        .one(&ss.db)
        .await?
        .unwrap();
    transform_entity_assets(&mut details.assets, ss).await?;
    let metadata_associations = EntityToEntity::find()
        .filter(entity_to_entity::Column::ToPersonId.eq(&person_id))
        .order_by_asc(entity_to_entity::Column::IndexPosition)
        .all(&ss.db)
        .await?;
    let mut metadata_contents: HashMap<_, Vec<_>> = HashMap::new();
    for assoc in metadata_associations {
        if let Some(metadata_id) = assoc.from_metadata_id {
            let to_push = PersonDetailsItemWithCharacter {
                character: assoc.character_name,
                entity_id: metadata_id,
            };
            metadata_contents
                .entry(assoc.relation)
                .and_modify(|e| e.push(to_push.clone()))
                .or_insert(vec![to_push]);
        }
    }
    let associated_metadata = metadata_contents
        .into_iter()
        .map(|(name, items)| PersonDetailsGroupedByRole { name, items })
        .sorted_by_key(|f| Reverse(f.items.len()))
        .collect_vec();
    let associated_metadata_groups = EntityToEntity::find()
        .filter(entity_to_entity::Column::ToPersonId.eq(person_id))
        .filter(entity_to_entity::Column::FromMetadataGroupId.is_not_null())
        .order_by_asc(entity_to_entity::Column::IndexPosition)
        .all(&ss.db)
        .await?;
    let mut metadata_group_contents: HashMap<_, Vec<_>> = HashMap::new();
    for assoc in associated_metadata_groups {
        if let Some(metadata_group_id) = assoc.from_metadata_group_id {
            let to_push = PersonDetailsItemWithCharacter {
                entity_id: metadata_group_id,
                ..Default::default()
            };
            metadata_group_contents
                .entry(assoc.relation)
                .and_modify(|e| e.push(to_push.clone()))
                .or_insert(vec![to_push]);
        }
    }
    let associated_metadata_groups = metadata_group_contents
        .into_iter()
        .map(|(name, items)| PersonDetailsGroupedByRole { name, items })
        .sorted_by_key(|f| Reverse(f.items.len()))
        .collect_vec();
    Ok(GraphqlPersonDetails {
        details,
        associated_metadata,
        associated_metadata_groups,
    })
}

pub async fn genre_details(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: GenreDetailsInput,
) -> Result<GenreDetails> {
    let page = input.page.unwrap_or(1);
    let genre = Genre::find_by_id(input.genre_id.clone())
        .one(&ss.db)
        .await?
        .unwrap();
    let preferences = user_by_id(&user_id, ss).await?.preferences;
    let paginator = EntityToEntity::find()
        .filter(entity_to_entity::Column::ToGenreId.eq(input.genre_id))
        .filter(entity_to_entity::Column::FromMetadataId.is_not_null())
        .paginate(&ss.db, preferences.general.list_page_size);
    let ItemsAndPagesNumber {
        number_of_items,
        number_of_pages,
    } = paginator.num_items_and_pages().await?;
    let mut contents = vec![];
    for association_items in paginator.fetch_page(page - 1).await? {
        if let Some(metadata_id) = association_items.from_metadata_id {
            contents.push(metadata_id);
        }
    }
    Ok(GenreDetails {
        details: GenreListItem {
            id: genre.id,
            name: genre.name,
            num_items: Some(number_of_items.try_into().unwrap()),
        },
        contents: SearchResults {
            items: contents,
            details: SearchDetails {
                total: number_of_items.try_into().unwrap(),
                next_page: (page < number_of_pages).then(|| (page + 1).try_into().unwrap()),
            },
        },
    })
}

pub async fn metadata_group_details(
    ss: &Arc<SupportingService>,
    metadata_group_id: String,
) -> Result<MetadataGroupDetails> {
    let mut model = MetadataGroup::find_by_id(&metadata_group_id)
        .one(&ss.db)
        .await?
        .unwrap();
    transform_entity_assets(&mut model.assets, ss).await?;
    let contents = EntityToEntity::find()
        .select_only()
        .column(entity_to_entity::Column::FromMetadataId)
        .filter(entity_to_entity::Column::ToMetadataGroupId.eq(metadata_group_id))
        .filter(entity_to_entity::Column::FromMetadataId.is_not_null())
        .order_by_asc(entity_to_entity::Column::Part)
        .into_tuple::<Option<String>>()
        .all(&ss.db)
        .await?;
    let contents: Vec<String> = contents.into_iter().flatten().collect();
    Ok(MetadataGroupDetails {
        contents,
        details: model,
    })
}

pub async fn metadata_details(
    ss: &Arc<SupportingService>,
    metadata_id: &String,
    ensure_updated: Option<bool>,
) -> Result<GraphqlMetadataDetails> {
    let (
        MetadataBaseData {
            model,
            genres,
            creators,
            suggestions,
        },
        associations,
    ) = try_join!(
        generic_metadata(metadata_id, ss, ensure_updated),
        async {
            let associations = EntityToEntity::find()
                .filter(entity_to_entity::Column::FromMetadataId.eq(metadata_id))
                .filter(entity_to_entity::Column::ToMetadataGroupId.is_not_null())
                .all(&ss.db)
                .await?;

            let mut result = vec![];
            for assoc in associations {
                if let Some(group_id) = &assoc.to_metadata_group_id {
                    if let Some(group) = MetadataGroup::find_by_id(group_id).one(&ss.db).await? {
                        result.push((assoc, Some(group)));
                    } else {
                        result.push((assoc, None));
                    }
                }
            }
            Ok::<
                Vec<(
                    entity_to_entity::Model,
                    Option<database_models::metadata_group::Model>,
                )>,
                sea_orm::DbErr,
            >(result)
        }
        .map_err(|_| anyhow!("Failed to fetch metadata associations"))
    )?;

    let mut group = vec![];
    for (assoc, grp_opt) in associations {
        if let Some(grp) = grp_opt {
            group.push(GraphqlMetadataGroup {
                id: grp.id,
                name: grp.title,
                part: assoc.part.unwrap_or(0),
            });
        }
    }

    let watch_providers = model.watch_providers.unwrap_or_default();

    let resp = GraphqlMetadataDetails {
        group,
        genres,
        creators,
        suggestions,
        id: model.id,
        lot: model.lot,
        watch_providers,
        title: model.title,
        assets: model.assets,
        source: model.source,
        is_nsfw: model.is_nsfw,
        source_url: model.source_url,
        is_partial: model.is_partial,
        identifier: model.identifier,
        description: model.description,
        publish_date: model.publish_date,
        publish_year: model.publish_year,
        book_specifics: model.book_specifics,
        show_specifics: model.show_specifics,
        movie_specifics: model.movie_specifics,
        music_specifics: model.music_specifics,
        manga_specifics: model.manga_specifics,
        anime_specifics: model.anime_specifics,
        provider_rating: model.provider_rating,
        production_status: model.production_status,
        original_language: model.original_language,
        podcast_specifics: model.podcast_specifics,
        created_by_user_id: model.created_by_user_id,
        external_identifiers: model.external_identifiers,
        video_game_specifics: model.video_game_specifics,
        audio_book_specifics: model.audio_book_specifics,
        visual_novel_specifics: model.visual_novel_specifics,
    };
    Ok(resp)
}
