import { z } from "zod";
import { MODES } from "@/core/types";

export const LIMITS = {
  title: 120,
  description: 1000,
  instructions: 4000,
  memory: 500,
  displayName: 60,
  customInstructions: 2000,
  passwordMin: 8,
  passwordMax: 200,
  search: 100,
} as const;

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const uuid = z.string().uuid();

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(LIMITS.passwordMin).max(LIMITS.passwordMax),
});

export const signUpSchema = credentialsSchema.extend({
  displayName: optionalText(LIMITS.displayName),
  acceptTerms: z.literal(true),
});

export const profilePatchSchema = z
  .object({
    displayName: optionalText(LIMITS.displayName),
    locale: z.enum(["ru", "en"]),
    theme: z.enum(["system", "light", "dark"]),
    defaultMode: z.enum(MODES),
    memoryEnabled: z.boolean(),
    customInstructions: optionalText(LIMITS.customInstructions),
  })
  .partial()
  .strict();

export const projectCreateSchema = z.object({
  title: trimmed(LIMITS.title),
  description: optionalText(LIMITS.description),
  instructions: optionalText(LIMITS.instructions),
});
export const projectPatchSchema = projectCreateSchema.extend({ archived: z.boolean() }).partial().strict();

export const conversationCreateSchema = z.object({
  title: trimmed(LIMITS.title).optional(),
  projectId: uuid.nullable().optional(),
  mode: z.enum(MODES).optional(),
});
export const conversationPatchSchema = z
  .object({ title: trimmed(LIMITS.title), favorite: z.boolean(), projectId: uuid.nullable(), mode: z.enum(MODES) })
  .partial()
  .strict();

export const memoryCreateSchema = z.object({
  content: trimmed(LIMITS.memory),
  projectId: uuid.nullable().optional(),
});
export const memoryPatchSchema = z.object({ content: trimmed(LIMITS.memory), consent: z.boolean() }).partial().strict();

export function chatRequestSchema(maxInputChars: number) {
  return z
    .object({
      conversationId: uuid.nullable().optional(),
      projectId: uuid.nullable().optional(),
      message: z.string().trim().min(1).max(maxInputChars).optional(),
      mode: z.enum(MODES).optional(),
      /** Replace the last assistant answer with a new one for the same user message. */
      regenerate: z.boolean().optional(),
    })
    .superRefine((v, ctx) => {
      if (v.regenerate) {
        if (!v.conversationId) ctx.addIssue({ code: "custom", path: ["conversationId"], message: "conversationId is required to regenerate" });
        if (v.message !== undefined) ctx.addIssue({ code: "custom", path: ["message"], message: "message must be omitted when regenerating" });
      } else if (v.message === undefined) {
        ctx.addIssue({ code: "custom", path: ["message"], message: "message is required" });
      }
    });
}

export function isUuid(v: string): boolean {
  return uuid.safeParse(v).success;
}

/** Title for a new conversation derived from its first message. */
export function deriveTitle(message: string): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  return oneLine.length <= 60 ? oneLine : oneLine.slice(0, 57).trimEnd() + "…";
}
