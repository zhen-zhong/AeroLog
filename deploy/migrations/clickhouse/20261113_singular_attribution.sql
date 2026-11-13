-- 为已有神策 Singular 事件补齐统一 MMP 渠道字段。
-- 幂等：已有统一字段不会被覆盖；仅处理携带 mmp_singular_* 属性的事件。
ALTER TABLE events
UPDATE properties =
    JSONMergePatch(
        JSONMergePatch(
            JSONMergePatch(
                JSONMergePatch(
                    JSONMergePatch(
                        JSONMergePatch(
                            JSONMergePatch(
                                JSONMergePatch(
                                    properties,
                                    if(JSONExtractRaw(properties, 'mmp_media_source') = '' AND JSONExtractRaw(properties, 'mmp_singular_network_name') != '', concat('{"mmp_media_source":', JSONExtractRaw(properties, 'mmp_singular_network_name'), '}'), '{}')
                                ),
                                if(JSONExtractRaw(properties, 'mmp_campaign_name') = '' AND JSONExtractRaw(properties, 'mmp_singular_campaign_name') != '', concat('{"mmp_campaign_name":', JSONExtractRaw(properties, 'mmp_singular_campaign_name'), '}'), '{}')
                            ),
                            if(JSONExtractRaw(properties, 'mmp_campaign_id') = '' AND JSONExtractRaw(properties, 'mmp_singular_campaign_id') != '', concat('{"mmp_campaign_id":', JSONExtractRaw(properties, 'mmp_singular_campaign_id'), '}'), '{}')
                        ),
                        if(JSONExtractRaw(properties, 'mmp_ad_group_name') = '' AND JSONExtractRaw(properties, 'mmp_singular_subcampaign_name') != '', concat('{"mmp_ad_group_name":', JSONExtractRaw(properties, 'mmp_singular_subcampaign_name'), '}'), '{}')
                    ),
                    if(JSONExtractRaw(properties, 'mmp_ad_group_id') = '' AND JSONExtractRaw(properties, 'mmp_singular_subcampaign_id') != '', concat('{"mmp_ad_group_id":', JSONExtractRaw(properties, 'mmp_singular_subcampaign_id'), '}'), '{}')
                ),
                if(JSONExtractRaw(properties, 'mmp_creative_name') = '' AND JSONExtractRaw(properties, 'mmp_singular_creative_name') != '', concat('{"mmp_creative_name":', JSONExtractRaw(properties, 'mmp_singular_creative_name'), '}'), '{}')
            ),
            if(JSONExtractRaw(properties, 'mmp_creative_id') = '' AND JSONExtractRaw(properties, 'mmp_singular_creative_id') != '', concat('{"mmp_creative_id":', JSONExtractRaw(properties, 'mmp_singular_creative_id'), '}'), '{}')
        ),
        if(JSONExtractRaw(properties, 'mmp_country') = '' AND JSONExtractRaw(properties, 'mmp_singular_attribution_country') != '', concat('{"mmp_country":', JSONExtractRaw(properties, 'mmp_singular_attribution_country'), '}'), '{}')
    )
WHERE JSONExtractRaw(properties, 'mmp_singular_network_name') != ''
   OR JSONExtractRaw(properties, 'mmp_singular_campaign_name') != ''
   OR JSONExtractRaw(properties, 'mmp_singular_campaign_id') != ''
   OR JSONExtractRaw(properties, 'mmp_singular_subcampaign_name') != ''
   OR JSONExtractRaw(properties, 'mmp_singular_subcampaign_id') != ''
   OR JSONExtractRaw(properties, 'mmp_singular_creative_name') != ''
   OR JSONExtractRaw(properties, 'mmp_singular_creative_id') != ''
   OR JSONExtractRaw(properties, 'mmp_singular_attribution_country') != '';
