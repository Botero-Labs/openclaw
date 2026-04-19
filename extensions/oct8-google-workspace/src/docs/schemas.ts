import { Type } from "@sinclair/typebox";

function stringEnum<T extends readonly string[]>(values: T, description: string) {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], description });
}

export const DocsReadDocumentSchema = Type.Object(
  { documentId: Type.String({ description: "Google Doc ID" }) },
  { additionalProperties: false },
);

export const DocsExportDocumentSchema = Type.Object(
  {
    documentId: Type.String({ description: "Google Doc ID" }),
    exportMimeType: Type.Optional(
      stringEnum(
        [
          "text/plain",
          "text/markdown",
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "text/html",
          "application/epub+zip",
          "application/rtf",
        ] as const,
        "Export format (default: text/plain for readable output)",
      ),
    ),
  },
  { additionalProperties: false },
);
