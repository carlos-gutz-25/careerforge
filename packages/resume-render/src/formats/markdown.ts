import { type ResumeLayout } from '../layout.ts';

// Markdown renderer. Dynamic strings are backslash-escaped so a claim/label/url
// containing markdown metacharacters renders as LITERAL TEXT, never markup (the
// untrusted-text rendering-side law, ADR-0018 sec 70). We construct every
// heading/bullet ourselves; dynamic text only ever appears AFTER a `# `/`## `/
// `- ` prefix (never at absolute line start), so block constructs can't trigger
// - but we escape the inline-significant set anyway (plus the block leaders, in
// case composed prose carries an embedded newline). Backslash-escaping any ASCII
// punctuation renders it literally in CommonMark, so this can only over-escape,
// never under-escape.
const MD_META = /[\\`*_{}[\]()#+.!<>|~-]/g;

export function escapeMarkdown(value: string): string {
  return value.replace(MD_META, '\\$&');
}

export function renderMarkdown(layout: ResumeLayout): string {
  const lines: string[] = [];
  lines.push(`# ${escapeMarkdown(layout.name)}`);
  if (layout.headline) lines.push('', escapeMarkdown(layout.headline));
  if (layout.contactLine) lines.push('', escapeMarkdown(layout.contactLine));
  for (const link of layout.links) {
    lines.push(`${escapeMarkdown(link.label)}: ${escapeMarkdown(link.url)}`);
  }

  for (const section of layout.sections) {
    lines.push('', `## ${escapeMarkdown(section.heading)}`);
    for (const group of section.groups) {
      if (group.subheading) lines.push('', `### ${escapeMarkdown(group.subheading)}`);
      for (const line of group.lines) lines.push(`- ${escapeMarkdown(line)}`);
    }
  }

  return `${lines.join('\n')}\n`;
}
