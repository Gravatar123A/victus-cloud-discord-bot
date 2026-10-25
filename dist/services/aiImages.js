const MAX_IMAGE_BYTES = 2_000_000;
const MAX_IMAGES = 3;
const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
export function hasAiImageAttachment(attachments) {
    return [...attachments].some((attachment) => {
        const byName = /\.(png|jpe?g|webp)$/i.test(attachment.name || '');
        return attachment.contentType?.startsWith('image/') === true || byName;
    });
}
function isDiscordAttachmentUrl(raw) {
    try {
        const url = new URL(raw);
        return url.protocol === 'https:'
            && ['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)
            && url.pathname.startsWith('/attachments/');
    }
    catch {
        return false;
    }
}
function hasImageSignature(mime, bytes) {
    if (mime === 'image/png')
        return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (mime === 'image/jpeg')
        return bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
    return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
}
/** Fetch only small Discord CDN images. The model receives verified bytes, not a filename. */
export async function loadAiImages(attachments) {
    const images = [];
    for (const attachment of attachments) {
        const byName = /\.(png|jpe?g|webp)$/i.exec(attachment.name || '')?.[1]?.toLowerCase();
        const mime = attachment.contentType?.split(';')[0]?.trim().toLowerCase()
            || (byName ? `image/${byName === 'jpg' ? 'jpeg' : byName}` : '');
        if (mime.startsWith('image/') && !MIME_TYPES.has(mime))
            throw new Error('Use a PNG, JPG, or WebP image for AI support.');
        if (!MIME_TYPES.has(mime))
            continue;
        if (!isDiscordAttachmentUrl(attachment.url))
            throw new Error('The image must be a Discord attachment.');
        if (attachment.size < 1 || attachment.size > MAX_IMAGE_BYTES)
            throw new Error('Each AI image must be under 2 MB.');
        const response = await fetch(attachment.url, {
            redirect: 'error',
            signal: AbortSignal.timeout(12_000),
        });
        if (!response.ok)
            throw new Error('Could not download an attached image from Discord.');
        const claimedSize = Number(response.headers.get('content-length') || 0);
        if (claimedSize > MAX_IMAGE_BYTES)
            throw new Error('An attached image exceeds 2 MB.');
        if (!response.body)
            throw new Error('Could not read an attached image from Discord.');
        const reader = response.body.getReader();
        const chunks = [];
        let total = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            total += value.length;
            if (total > MAX_IMAGE_BYTES) {
                await reader.cancel();
                throw new Error('An attached image exceeds 2 MB.');
            }
            chunks.push(value);
        }
        const bytes = Buffer.concat(chunks);
        if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || !hasImageSignature(mime, bytes))
            throw new Error('An attached image is invalid or exceeds 2 MB.');
        images.push({ name: attachment.name || 'image', dataUrl: `data:${mime};base64,${bytes.toString('base64')}` });
        if (images.length >= MAX_IMAGES)
            break;
    }
    return images;
}
