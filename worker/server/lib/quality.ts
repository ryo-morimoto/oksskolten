/**
 * Structural quality score for articles.
 *
 * Weights adapted from Wikipedia's language-agnostic quality model
 * (https://arxiv.org/html/2404.09764v1) for technical blog content.
 */

export interface QualityInput {
  markdown: string;
  tokenCount?: number | undefined; // kuromoji token count (Japanese word count)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalize(value: number, min: number, max: number): number {
  return clamp((value - min) / (max - min), 0, 1);
}

function countWordsFallback(text: string): number {
  // Strip Markdown syntax for word counting
  const plain = text
    .replace(/```[\s\S]*?```/g, "") // remove code blocks
    .replace(/`[^`]+`/g, "") // remove inline code
    .replace(/!?\[.*?\]\(.*?\)/g, "") // remove links/images
    .replace(/#{1,6}\s/g, "") // remove heading markers
    .trim();
  return plain.split(/\s+/).filter(Boolean).length;
}

function countExternalLinks(markdown: string): number {
  const linkPattern = /\[.*?\]\((https?:\/\/[^)]+)\)/g;
  let count = 0;
  while (linkPattern.exec(markdown) !== null) {
    count++;
  }
  return count;
}

function countHeadings(markdown: string): {
  count: number;
  hasH2: boolean;
  hasH3: boolean;
  hasH4: boolean;
} {
  const lines = markdown.split("\n");
  let count = 0;
  let hasH2 = false;
  let hasH3 = false;
  let hasH4 = false;
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      count++;
      if (/^##\s/.test(line)) hasH2 = true;
      if (/^###\s/.test(line)) hasH3 = true;
      if (/^####\s/.test(line)) hasH4 = true;
    }
  }
  return { count, hasH2, hasH3, hasH4 };
}

function countImages(markdown: string): number {
  return (markdown.match(/!\[/g) || []).length;
}

function countCodeBlocks(markdown: string): number {
  return (markdown.match(/^```/gm) || []).length / 2; // opening + closing = 1 block
}

function medianParagraphLength(markdown: string): number {
  // Strip code blocks first
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, "");
  const paragraphs = withoutCode
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !/^#{1,6}\s/.test(p)); // exclude headings
  if (paragraphs.length === 0) return 0;
  const lengths = paragraphs.map((p) => p.split(/\s+/).length).sort((a, b) => a - b);
  const mid = Math.floor(lengths.length / 2);
  // lengths is guaranteed non-empty (early return above) and mid is within bounds
  return lengths.length % 2 === 0
    ? ((lengths[mid - 1] ?? 0) + (lengths[mid] ?? 0)) / 2
    : (lengths[mid] ?? 0);
}

export function computeQualityScore(input: QualityInput): number {
  const { markdown, tokenCount } = input;
  if (!markdown || markdown.length < 50) return 0;

  const wordCount = tokenCount ?? countWordsFallback(markdown);
  const externalLinks = countExternalLinks(markdown);
  const externalLinkDensity = wordCount > 0 ? (externalLinks / wordCount) * 1000 : 0;
  const headings = countHeadings(markdown);
  const headingDensity = wordCount > 0 ? (headings.count / wordCount) * 1000 : 0;
  const images = countImages(markdown);
  const codeBlocks = Math.floor(countCodeBlocks(markdown));
  const headingDepthBonus =
    headings.hasH2 && headings.hasH3 && headings.hasH4
      ? 1.0
      : headings.hasH2 && headings.hasH3
        ? 0.5
        : 0.0;
  const medParagraph = medianParagraphLength(markdown);

  return (
    0.3 * normalize(wordCount, 300, 5000) +
    0.2 * normalize(externalLinkDensity, 0, 10) +
    0.15 * normalize(headingDensity, 0, 8) +
    0.12 * normalize(images, 0, 8) +
    0.1 * normalize(codeBlocks, 0, 10) +
    0.08 * headingDepthBonus +
    0.05 * normalize(medParagraph, 30, 120)
  );
}
