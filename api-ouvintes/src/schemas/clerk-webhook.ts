import { z } from "zod";

const verificationSchema = z
  .object({ status: z.string().optional() })
  .passthrough()
  .nullable()
  .optional();

const emailAddressSchema = z
  .object({
    id: z.string().min(1),
    email_address: z.string().min(1),
    verification: verificationSchema,
  })
  .passthrough();

const phoneNumberSchema = z
  .object({
    id: z.string().min(1),
    phone_number: z.string().min(1),
    verification: verificationSchema,
  })
  .passthrough();

export const clerkUserWebhookDataSchema = z
  .object({
    id: z.string().min(1),
    primary_email_address_id: z.string().nullable().optional(),
    primary_phone_number_id: z.string().nullable().optional(),
    email_addresses: z.array(emailAddressSchema).default([]),
    phone_numbers: z.array(phoneNumberSchema).default([]),
    created_at: z.number().finite().optional(),
    updated_at: z.number().finite().optional(),
  })
  .passthrough();

export const clerkDeletedUserWebhookDataSchema = z
  .object({
    id: z.string().min(1),
    deleted: z.boolean().optional(),
  })
  .passthrough();

export type ClerkUserWebhookData = z.infer<typeof clerkUserWebhookDataSchema>;
export type ClerkDeletedUserWebhookData = z.infer<
  typeof clerkDeletedUserWebhookDataSchema
>;

export type ClerkWebhookType = "user.created" | "user.updated" | "user.deleted";

export function isSupportedClerkWebhookType(value: string): value is ClerkWebhookType {
  return value === "user.created" || value === "user.updated" || value === "user.deleted";
}

export function isVerifiedContact(
  verification: { status?: string } | null | undefined,
): boolean {
  return verification?.status === "verified";
}

export function getPrimaryVerifiedEmail(data: ClerkUserWebhookData): string | null {
  if (!data.primary_email_address_id) return null;

  const email = data.email_addresses.find(
    (item) => item.id === data.primary_email_address_id && isVerifiedContact(item.verification),
  );
  return email?.email_address.trim().toLowerCase() || null;
}

export function getPrimaryVerifiedPhone(data: ClerkUserWebhookData): string | null {
  if (!data.primary_phone_number_id) return null;

  const phone = data.phone_numbers.find(
    (item) => item.id === data.primary_phone_number_id && isVerifiedContact(item.verification),
  );
  return phone?.phone_number.trim() || null;
}

export function toDateFromClerkTimestamp(value: number | undefined): Date | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date;
}
