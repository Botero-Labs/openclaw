import { Type } from "@sinclair/typebox";

function stringEnum<T extends readonly string[]>(values: T, description: string) {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values], description });
}

export const ContactsListSchema = Type.Object(
  {
    pageSize: Type.Optional(
      Type.Number({ description: "Max contacts to return (1-1000)", minimum: 1, maximum: 1000 }),
    ),
    pageToken: Type.Optional(Type.String({ description: "Page token for pagination" })),
    sortOrder: Type.Optional(
      stringEnum(
        [
          "LAST_MODIFIED_ASCENDING",
          "LAST_MODIFIED_DESCENDING",
          "FIRST_NAME_ASCENDING",
          "LAST_NAME_ASCENDING",
        ] as const,
        "Sort order for results",
      ),
    ),
  },
  { additionalProperties: false },
);

export const ContactsSearchSchema = Type.Object(
  {
    query: Type.String({
      description: "Search query — prefix-matches against names, emails, phones, organizations",
    }),
    pageSize: Type.Optional(
      Type.Number({ description: "Max results (1-30)", minimum: 1, maximum: 30 }),
    ),
  },
  { additionalProperties: false },
);

export const ContactsGetSchema = Type.Object(
  {
    resourceName: Type.String({ description: "Contact resource name (e.g. 'people/c1234567890')" }),
  },
  { additionalProperties: false },
);

export const ContactsCreateSchema = Type.Object(
  {
    givenName: Type.String({ description: "First name" }),
    familyName: Type.Optional(Type.String({ description: "Last name" })),
    email: Type.Optional(Type.String({ description: "Email address" })),
    emailType: Type.Optional(Type.String({ description: "Email type (e.g. 'work', 'home')" })),
    phone: Type.Optional(Type.String({ description: "Phone number" })),
    phoneType: Type.Optional(Type.String({ description: "Phone type (e.g. 'mobile', 'work')" })),
    organization: Type.Optional(Type.String({ description: "Organization/company name" })),
    title: Type.Optional(Type.String({ description: "Job title" })),
  },
  { additionalProperties: false },
);

export const ContactsUpdateSchema = Type.Object(
  {
    resourceName: Type.String({ description: "Contact resource name (e.g. 'people/c1234567890')" }),
    givenName: Type.Optional(Type.String({ description: "Updated first name" })),
    familyName: Type.Optional(Type.String({ description: "Updated last name" })),
    email: Type.Optional(Type.String({ description: "Updated email address" })),
    emailType: Type.Optional(Type.String({ description: "Email type" })),
    phone: Type.Optional(Type.String({ description: "Updated phone number" })),
    phoneType: Type.Optional(Type.String({ description: "Phone type" })),
    organization: Type.Optional(Type.String({ description: "Updated organization" })),
    title: Type.Optional(Type.String({ description: "Updated job title" })),
  },
  { additionalProperties: false },
);
