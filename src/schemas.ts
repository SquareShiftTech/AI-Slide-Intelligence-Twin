import { z } from 'zod';

export const CreatePresentationArgsSchema = z.object({
  title: z.string().min(1, { message: '"title" (string) is required.' }),
});
export type CreatePresentationArgs = z.infer<typeof CreatePresentationArgsSchema>;

export const GetPresentationArgsSchema = z.object({
  presentationId: z.string().min(1, { message: '"presentationId" (string) is required.' }),
  fields: z.string().optional(),
});
export type GetPresentationArgs = z.infer<typeof GetPresentationArgsSchema>;

// Using z.any() for complex Google Slides API structures for simplicity in this context.
// For stricter typing, these could be defined more precisely based on the Google Slides API.
const GoogleSlidesRequestSchema = z.any();
const GoogleSlidesWriteControlSchema = z.any();

export const BatchUpdatePresentationArgsSchema = z.object({
  presentationId: z.string().min(1, { message: '"presentationId" (string) is required.' }),
  requests: z.array(GoogleSlidesRequestSchema).min(1, { message: '"requests" (array) is required.' }),
  writeControl: GoogleSlidesWriteControlSchema.optional(),
});
export type BatchUpdatePresentationArgs = z.infer<typeof BatchUpdatePresentationArgsSchema>;

export const GetPageArgsSchema = z.object({
  presentationId: z.string().min(1, { message: '"presentationId" (string) is required.' }),
  pageObjectId: z.string().min(1, { message: '"pageObjectId" (string) is required.' }),
});
export type GetPageArgs = z.infer<typeof GetPageArgsSchema>;

export const SummarizePresentationArgsSchema = z.object({
  presentationId: z.string().min(1, { message: '"presentationId" (string) is required.' }),
  include_notes: z.boolean().optional(),
});
export type SummarizePresentationArgs = z.infer<typeof SummarizePresentationArgsSchema>;

// HTTP POST /slides body: create presentation from agent-provided content
export const SlideContentSchema = z.object({
  slideNumber: z.number().int().min(1).optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  body: z.string().optional(),
  bullets: z.array(z.string()).optional(),
  notes: z.string().optional(),
});
export type SlideContent = z.infer<typeof SlideContentSchema>;

export const CreatePresentationFromContentSchema = z.object({
  title: z.string().min(1, { message: '"title" is required.' }),
  slides: z.array(SlideContentSchema).min(1, { message: '"slides" array with at least one slide is required.' }),
  /** Optional. Google Slides presentation ID to use as template. Copy is made and filled with content; preserves template theme and layout. */
  templatePresentationId: z.string().min(1).optional(),
});
export type CreatePresentationFromContent = z.infer<typeof CreatePresentationFromContentSchema>;
