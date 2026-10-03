import handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';
import { prisma } from './prisma.service';
import { logger } from './logger.service';
import { EMAIL_TEMPLATE_KEY } from '../constants/tracking';

const TEMPLATE_DIR = path.join(process.cwd(), 'src', 'templates');

const fileTemplateCache = new Map<string, string>();

/**
 * Renders a template from the DB (`EmailTemplate`) first, falling back to the
 * bundled HTML file under `src/templates`. Unknown keys render as an empty string
 * and are logged rather than crashing the mail pipeline.
 */
export const renderTemplate = async (
  key: string,
  data: Record<string, any> = {},
  engine: 'handlebars' | 'none' = 'handlebars',
): Promise<{ subject: string; html: string; text: string }> => {
  const row = await prisma.emailTemplate.findUnique({ where: { key } });
  if (row) {
    return {
      subject: compile(engine, row.subject)(data),
      html: compile(engine, row.htmlBody)(data),
      text: compile(engine, row.textBody)(data),
    };
  }

  const fileName = `${key}.html`;
  const filePath = path.join(TEMPLATE_DIR, fileName);
  let html = fileTemplateCache.get(fileName);

  if (html === undefined) {
    try {
      html = fs.readFileSync(filePath, 'utf8');
      fileTemplateCache.set(fileName, html);
    } catch {
      html = '';
      logger.warn({ key }, '[email] template not found');
    }
  }

  return {
    subject: key.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    html: compile(engine, html)(data),
    text: '',
  };
};

const compile = (engine: 'handlebars' | 'none', source: string) => {
  if (!source) return () => '';
  if (engine === 'none') return () => source;
  try {
    return handlebars.compile(source, { noEscape: false });
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, '[email] template compile failed');
    return () => source;
  }
};

/** Renders a template synchronously for a known key (no DB hit). */
export const renderInline = (source: string, data: Record<string, any>): string =>
  compile('handlebars', source)(data);

export const clearTemplateCache = (): void => {
  fileTemplateCache.clear();
};

export { EMAIL_TEMPLATE_KEY };
