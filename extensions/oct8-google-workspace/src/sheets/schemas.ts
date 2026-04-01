import { Type } from "@sinclair/typebox";

export const SheetsGetMetadataSchema = Type.Object(
  { spreadsheetId: Type.String({ description: "Spreadsheet ID" }) },
  { additionalProperties: false },
);

export const SheetsReadRangeSchema = Type.Object(
  {
    spreadsheetId: Type.String({ description: "Spreadsheet ID" }),
    range: Type.String({ description: "A1 notation range (e.g. 'Sheet1!A1:D10')" }),
  },
  { additionalProperties: false },
);

export const SheetsWriteRangeSchema = Type.Object(
  {
    spreadsheetId: Type.String({ description: "Spreadsheet ID" }),
    range: Type.String({ description: "A1 notation range to write to" }),
    values: Type.Array(Type.Array(Type.Unknown(), { description: "Row of cell values" }), {
      description: "2D array of values (rows × columns)",
    }),
  },
  { additionalProperties: false },
);

export const SheetsAppendRowsSchema = Type.Object(
  {
    spreadsheetId: Type.String({ description: "Spreadsheet ID" }),
    range: Type.String({ description: "A1 notation range to append after (e.g. 'Sheet1!A:C')" }),
    values: Type.Array(Type.Array(Type.Unknown(), { description: "Row of cell values" }), {
      description: "2D array of rows to append",
    }),
  },
  { additionalProperties: false },
);

export const SheetsClearRangeSchema = Type.Object(
  {
    spreadsheetId: Type.String({ description: "Spreadsheet ID" }),
    range: Type.String({ description: "A1 notation range to clear" }),
  },
  { additionalProperties: false },
);
