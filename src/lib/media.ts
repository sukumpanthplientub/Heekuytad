const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

/** Some Windows file pickers omit MIME type. The server also checks file bytes. */
export function normalizeMediaFile(file: File): File {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const mime = MIME_BY_EXTENSION[extension];
  return (!file.type || file.type === "application/octet-stream") && mime
    ? new File([file], file.name, { type: mime, lastModified: file.lastModified })
    : file;
}
