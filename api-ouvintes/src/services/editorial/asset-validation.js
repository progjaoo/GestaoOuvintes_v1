import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { extractEditorialAssetIds } from "../../schemas/editorial.js";
export function assertEditorialAssetUsage(content, assets) {
    const assertType = (id, type) => {
        const asset = assets.get(id);
        if (!asset || asset.status !== "ready" || asset.media_type !== type || !asset.private_object_key.startsWith(`feed-private/${env.FEED_NAMESPACE}/${id}/validated-`)) {
            throw new AppError(422, "FEED_MEDIA_NOT_READY", "Midia ausente, de outro ambiente ou incompativel com o bloco.");
        }
    };
    assertType(content.coverAssetId, "image");
    assertType(content.openingAssetId ?? content.coverAssetId, "image");
    for (const block of content.blocks) {
        if (block.type === "image")
            assertType(block.assetId, "image");
        if (block.type === "gallery")
            for (const item of block.items)
                assertType(item.assetId, "image");
        if (block.type === "gif") {
            assertType(block.assetId, "gif");
            if (block.posterAssetId)
                assertType(block.posterAssetId, "image");
        }
        if (block.type === "video") {
            if (block.source.kind === "asset") {
                assertType(block.source.assetId, "video");
                if (!block.posterAssetId)
                    throw new AppError(422, "FEED_VIDEO_POSTER_REQUIRED", "Video proprio exige poster.");
            }
            if (block.posterAssetId)
                assertType(block.posterAssetId, "image");
            if (block.captionsAssetId)
                throw new AppError(422, "FEED_CAPTIONS_UNSUPPORTED", "Upload de legendas ainda nao e suportado.");
        }
    }
    return extractEditorialAssetIds(content);
}
