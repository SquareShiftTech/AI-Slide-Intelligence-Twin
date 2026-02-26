import { drive_v3, slides_v1 } from 'googleapis';
import { CreatePresentationFromContent, SlideContent } from '../schemas.js';
import { handleGoogleApiError } from '../utils/errorHandler.js';

/** Default template used when no templatePresentationId is provided. Override with GOOGLE_SLIDES_TEMPLATE_ID. */
const DEFAULT_TEMPLATE_ID = process.env.GOOGLE_SLIDES_TEMPLATE_ID ?? '<YOUR_TEMPLATE_ID>';

/** Template structure: slide 0 = title (title only), slide 1 = content layout (duplicated), last slide = thank you (left unchanged). */
const TEMPLATE_CONTENT_LAYOUT_INDEX = 1;

const PAGE_WIDTH_PT = 720;
const PAGE_HEIGHT_PT = 540;
const MARGIN_PT = 40;
const TITLE_HEIGHT_PT = 60;
const BODY_TOP_PT = 120;
const CONTENT_WIDTH_PT = PAGE_WIDTH_PT - 2 * MARGIN_PT;

function buildSlideBodyText(slide: SlideContent): string {
  const parts: string[] = [];
  if (slide.subtitle?.trim()) parts.push(slide.subtitle.trim());
  if (slide.body?.trim()) parts.push(slide.body.trim());
  if (slide.bullets?.length) parts.push(slide.bullets.map((b) => `• ${b.trim()}`).join('\n'));
  return parts.join('\n\n');
}

type PlaceholderInfo = { objectId: string; type: string };
function getTitleAndBodyPlaceholders(pageElements: slides_v1.Schema$PageElement[] | undefined): { title: PlaceholderInfo | null; body: PlaceholderInfo | null } {
  let title: PlaceholderInfo | null = null;
  let body: PlaceholderInfo | null = null;
  if (!pageElements) return { title, body };
  for (const el of pageElements) {
    const type = (el.shape as { placeholder?: { type?: string } })?.placeholder?.type;
    const objectId = el.objectId ?? null;
    if (!objectId) continue;
    if (type === 'TITLE') title = { objectId, type: 'TITLE' };
    if (type === 'BODY' || type === 'SUBTITLE') body = body ?? { objectId, type: type ?? 'BODY' };
  }
  if (!body && pageElements.length >= 2 && pageElements[1].objectId)
    body = { objectId: pageElements[1].objectId, type: 'BODY' };
  return { title, body };
}

/**
 * Create presentation from template: copy template, then
 * - Slide 0 (title): fill only the presentation title (args.title); no body/subtitle.
 * - Slides 1..N (content): duplicate template's slide 2 (content layout) so we have N slides; fill from user's slides[0]..slides[N-1].
 * - Last slide (thank you): left unchanged from template.
 */
async function createFromTemplate(
  drive: drive_v3.Drive,
  slidesApi: slides_v1.Slides,
  args: CreatePresentationFromContent
): Promise<{ presentationId: string; editUrl: string; title: string }> {
  const { title, slides } = args;
  const templateId = args.templatePresentationId ?? DEFAULT_TEMPLATE_ID;

  const copyRes = await drive.files.copy({
    fileId: templateId,
    requestBody: { name: title },
  });
  const presentationId = copyRes.data.id ?? null;
  if (!presentationId) throw new Error('Drive copy did not return file id');

  const fieldsSlides = 'slides(objectId,pageElements(objectId,shape(placeholder(type))))';
  const getRes = await slidesApi.presentations.get({ presentationId, fields: fieldsSlides });
  const templateSlides = getRes.data.slides ?? [];
  if (templateSlides.length < 3) throw new Error('Default template must have at least 3 slides: title, content layout, thank you');

  const contentLayoutSlideId = templateSlides[TEMPLATE_CONTENT_LAYOUT_INDEX].objectId ?? null;
  if (!contentLayoutSlideId) throw new Error('Template content layout slide missing objectId');

  const N = slides.length;
  const requests: slides_v1.Schema$Request[] = [];

  // Duplicate template's slide 2 (content layout) so we have N content slides (1 original + (N-1) duplicates)
  const duplicateCount = N - 1;
  for (let i = 0; i < duplicateCount; i++) {
    requests.push({ duplicateObject: { objectId: contentLayoutSlideId } });
  }
  // Delete any template slides between content layout and thank you (indices 2 .. length-2)
  for (let i = 2; i < templateSlides.length - 1; i++) {
    const oid = templateSlides[i].objectId;
    if (oid) requests.push({ deleteObject: { objectId: oid } });
  }

  if (requests.length > 0) {
    await slidesApi.presentations.batchUpdate({ presentationId, requestBody: { requests } });
  }

  const getRes2 = await slidesApi.presentations.get({ presentationId, fields: fieldsSlides });
  const finalSlides = getRes2.data.slides ?? [];
  const expectedSlides = 1 + N + 1; // title + N content + thank you
  if (finalSlides.length < expectedSlides) throw new Error('Template restructuring did not produce enough slides');

  const fillRequests: slides_v1.Schema$Request[] = [];
  // First slide: only the presentation title (no body)
  const titlePageElements = finalSlides[0]?.pageElements as slides_v1.Schema$PageElement[] | undefined;
  const { title: titlePh } = getTitleAndBodyPlaceholders(titlePageElements);
  if (titlePh) {
    fillRequests.push({ deleteText: { objectId: titlePh.objectId, textRange: { type: 'ALL' } } });
    fillRequests.push({ insertText: { objectId: titlePh.objectId, text: title, insertionIndex: 0 } });
  }

  // Content slides (indices 1 .. N): same layout as template slide 2, filled from slides[0]..slides[N-1]
  for (let i = 0; i < N; i++) {
    const slideIndex = 1 + i;
    const slideContent = slides[i];
    const slideTitle = slideContent?.title?.trim() ?? '';
    const slideBody = buildSlideBodyText(slideContent ?? {});
    const pageElements = finalSlides[slideIndex]?.pageElements as slides_v1.Schema$PageElement[] | undefined;
    const { title: tPh, body: bPh } = getTitleAndBodyPlaceholders(pageElements);
    if (tPh) {
      fillRequests.push({ deleteText: { objectId: tPh.objectId, textRange: { type: 'ALL' } } });
      fillRequests.push({ insertText: { objectId: tPh.objectId, text: slideTitle, insertionIndex: 0 } });
    }
    if (bPh && slideBody) {
      fillRequests.push({ deleteText: { objectId: bPh.objectId, textRange: { type: 'ALL' } } });
      fillRequests.push({ insertText: { objectId: bPh.objectId, text: slideBody, insertionIndex: 0 } });
    }
  }
  // Last slide (thank you) is not filled; left as-is from template

  if (fillRequests.length > 0) {
    await slidesApi.presentations.batchUpdate({ presentationId, requestBody: { requests: fillRequests } });
  }

  const editUrl = `https://docs.google.com/presentation/d/${presentationId}/edit`;
  return { presentationId, editUrl, title };
}

export interface CreatePresentationFromContentOptions {
  drive?: drive_v3.Drive;
}

/**
 * Creates a Google Slides presentation from structured slide content and returns
 * presentationId and editUrl for the agent to display to the user.
 * If args.templatePresentationId and options.drive are set, copies the template and fills placeholders (preserves theme/layout).
 */
export async function createPresentationFromContent(
  slidesApi: slides_v1.Slides,
  args: CreatePresentationFromContent,
  options?: CreatePresentationFromContentOptions
): Promise<{ presentationId: string; editUrl: string; title: string }> {
  try {
    // Use template by default when Drive is available (default or explicit templatePresentationId).
    if (options?.drive) {
      return createFromTemplate(options.drive, slidesApi, args);
    }

    const { title, slides } = args;
    const createRes = await slidesApi.presentations.create({
      requestBody: { title },
    });
    const presentationId = createRes.data.presentationId;
    if (!presentationId) {
      throw new Error('Google API did not return presentationId');
    }

    const fields =
      'slides(objectId,pageElements(objectId,shape(placeholder(type))))';
    const getRes = await slidesApi.presentations.get({
      presentationId,
      fields,
    });
    const firstSlide = getRes.data.slides?.[0];
    const pageElements = firstSlide?.pageElements ?? [];
    let titleObjectId: string | null = null;
    let bodyObjectId: string | null = null;
    for (const el of pageElements) {
      const type = (el.shape as { placeholder?: { type?: string } })?.placeholder?.type;
      if (type === 'TITLE') titleObjectId = el.objectId ?? null;
      if (type === 'BODY' || type === 'SUBTITLE') bodyObjectId = el.objectId ?? bodyObjectId ?? null;
    }
    if (!bodyObjectId && pageElements.length >= 2) {
      bodyObjectId = pageElements[1].objectId ?? null;
    }

    const requests: slides_v1.Schema$Request[] = [];

    const first = slides[0];
    const firstTitle = first?.title?.trim() ?? title;
    const firstBody = buildSlideBodyText(first ?? {});

    if (titleObjectId) {
      requests.push({
        insertText: {
          objectId: titleObjectId,
          text: firstTitle,
          insertionIndex: 0,
        },
      });
    }
    if (bodyObjectId && firstBody) {
      requests.push({
        insertText: {
          objectId: bodyObjectId,
          text: firstBody,
          insertionIndex: 0,
        },
      });
    }

    for (let i = 1; i < slides.length; i++) {
      const slide = slides[i];
      const slideId = `slide_${i + 1}`;
      const titleBoxId = `title_${i + 1}`;
      const bodyBoxId = `body_${i + 1}`;
      const slideTitle = slide.title?.trim() ?? '';
      const slideBody = buildSlideBodyText(slide);

      requests.push({
        createSlide: {
          objectId: slideId,
          insertionIndex: i,
          slideLayoutReference: { predefinedLayout: 'BLANK' },
        },
      });
      requests.push({
        createShape: {
          objectId: titleBoxId,
          shapeType: 'TEXT_BOX',
          elementProperties: {
            pageObjectId: slideId,
            size: {
              width: { magnitude: CONTENT_WIDTH_PT, unit: 'PT' },
              height: { magnitude: TITLE_HEIGHT_PT, unit: 'PT' },
            },
            transform: {
              scaleX: 1,
              scaleY: 1,
              translateX: MARGIN_PT,
              translateY: MARGIN_PT,
              unit: 'PT',
            },
          },
        },
      });
      requests.push({
        createShape: {
          objectId: bodyBoxId,
          shapeType: 'TEXT_BOX',
          elementProperties: {
            pageObjectId: slideId,
            size: {
              width: { magnitude: CONTENT_WIDTH_PT, unit: 'PT' },
              height: { magnitude: PAGE_HEIGHT_PT - BODY_TOP_PT - MARGIN_PT, unit: 'PT' },
            },
            transform: {
              scaleX: 1,
              scaleY: 1,
              translateX: MARGIN_PT,
              translateY: BODY_TOP_PT,
              unit: 'PT',
            },
          },
        },
      });
      if (slideTitle) {
        requests.push({
          insertText: {
            objectId: titleBoxId,
            text: slideTitle,
            insertionIndex: 0,
          },
        });
      }
      if (slideBody) {
        requests.push({
          insertText: {
            objectId: bodyBoxId,
            text: slideBody,
            insertionIndex: 0,
          },
        });
      }
    }

    if (requests.length > 0) {
      await slidesApi.presentations.batchUpdate({
        presentationId,
        requestBody: { requests },
      });
    }

    const editUrl = `https://docs.google.com/presentation/d/${presentationId}/edit`;
    return { presentationId, editUrl, title };
  } catch (error: unknown) {
    throw handleGoogleApiError(error, 'create_presentation_from_content');
  }
}
