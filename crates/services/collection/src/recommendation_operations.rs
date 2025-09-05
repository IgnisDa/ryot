use std::{collections::HashSet, sync::Arc};

use anyhow::Result;
use common_models::SearchDetails;
use common_utils::{MEDIA_SOURCES_WITHOUT_RECOMMENDATIONS, ryot_log};
use database_models::{
    collection_to_entity, metadata,
    prelude::{CollectionToEntity, Metadata},
};
use database_utils::{apply_columns_search, extract_pagination_params};
use dependent_entity_utils::generic_metadata;
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CollectionRecommendationsCachedInput,
    CollectionRecommendationsInput, SearchResults,
};
use dependent_notification_utils::update_metadata_and_notify_users;
use sea_orm::{
    ColumnTrait, EntityTrait, ItemsAndPagesNumber, Order, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, QueryTrait,
    sea_query::{Expr, Func},
};
use supporting_service::SupportingService;

pub async fn collection_recommendations(
    user_id: &String,
    input: CollectionRecommendationsInput,
    ss: &Arc<SupportingService>,
) -> Result<SearchResults<String>> {
    let cached_response = cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::CollectionRecommendations(CollectionRecommendationsCachedInput {
            collection_id: input.collection_id.clone(),
        }),
        ApplicationCacheValue::CollectionRecommendations,
        || async {
            let mut data = vec![];
            let media_items: HashSet<String> = HashSet::from_iter(
                CollectionToEntity::find()
                    .select_only()
                    .inner_join(Metadata)
                    .column(collection_to_entity::Column::MetadataId)
                    .filter(collection_to_entity::Column::MetadataId.is_not_null())
                    .filter(
                        metadata::Column::Source.is_not_in(MEDIA_SOURCES_WITHOUT_RECOMMENDATIONS),
                    )
                    .filter(
                        collection_to_entity::Column::CollectionId.eq(input.collection_id.clone()),
                    )
                    .limit(10)
                    .order_by(Expr::expr(Func::random()), Order::Asc)
                    .into_tuple::<String>()
                    .all(&ss.db)
                    .await?
                    .into_iter(),
            );
            ryot_log!(debug, "Media items: {:?}", media_items);
            for item in media_items {
                update_metadata_and_notify_users(&item, ss).await?;
                let generic = generic_metadata(&item, ss, None).await?;
                data.extend(generic.suggestions);
            }
            Ok(data)
        },
    )
    .await?;
    let required_set = cached_response.response;

    if required_set.is_empty() {
        return Ok(SearchResults::default());
    }

    ryot_log!(debug, "Required set: {:?}", required_set);

    let (take, page) = extract_pagination_params(input.search.clone(), user_id, ss).await?;

    let paginator = Metadata::find()
        .select_only()
        .column(metadata::Column::Id)
        .filter(metadata::Column::Id.is_in(required_set))
        .apply_if(input.search.and_then(|s| s.query), |query, v| {
            apply_columns_search(
                &v,
                query,
                [
                    Expr::col(metadata::Column::Title),
                    Expr::col(metadata::Column::Description),
                ],
            )
        })
        .into_tuple::<String>()
        .paginate(&ss.db, take);

    let ItemsAndPagesNumber {
        number_of_items,
        number_of_pages,
    } = paginator.num_items_and_pages().await?;

    Ok(SearchResults {
        items: paginator.fetch_page(page - 1).await?,
        details: SearchDetails {
            total_items: number_of_items,
            next_page: (page < number_of_pages).then(|| page + 1),
        },
    })
}
