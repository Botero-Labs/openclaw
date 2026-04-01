import { Type } from "@sinclair/typebox";

function stringEnum<T extends readonly string[]>(values: T, description: string) {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], description });
}

export const DriveSearchFilesSchema = Type.Object(
  {
    query: Type.String({
      description:
        "Drive search query (e.g. \"name contains 'report' and mimeType = 'application/pdf'\")",
    }),
    pageSize: Type.Optional(
      Type.Number({ description: "Max files to return per page", minimum: 1, maximum: 1000 }),
    ),
    pageToken: Type.Optional(Type.String({ description: "Page token for pagination" })),
    orderBy: Type.Optional(
      Type.String({ description: "Sort order (e.g. 'modifiedTime desc', 'name')" }),
    ),
  },
  { additionalProperties: false },
);

export const DriveGetFileSchema = Type.Object(
  {
    fileId: Type.String({ description: "Drive file ID" }),
  },
  { additionalProperties: false },
);

export const DriveDownloadFileSchema = Type.Object(
  {
    fileId: Type.String({ description: "Drive file ID to download" }),
  },
  { additionalProperties: false },
);

export const DriveUploadFileSchema = Type.Object(
  {
    name: Type.String({ description: "File name (e.g. 'report.pdf')" }),
    content: Type.String({ description: "File content (text)" }),
    mimeType: Type.String({ description: "MIME type (e.g. 'text/plain', 'application/json')" }),
    parentId: Type.Optional(
      Type.String({ description: "Parent folder ID (uploads to root if omitted)" }),
    ),
    description: Type.Optional(Type.String({ description: "File description" })),
  },
  { additionalProperties: false },
);

export const DriveExportFileSchema = Type.Object(
  {
    fileId: Type.String({ description: "Google Workspace file ID to export" }),
    exportMimeType: Type.Optional(
      stringEnum(
        [
          "application/pdf",
          "text/plain",
          "text/markdown",
          "text/csv",
          "text/tab-separated-values",
          "text/html",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "application/rtf",
          "application/epub+zip",
        ] as const,
        "Export format (default: application/pdf). Use text/plain or text/markdown for readable text.",
      ),
    ),
  },
  { additionalProperties: false },
);
