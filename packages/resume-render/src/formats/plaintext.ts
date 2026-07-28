import { type ResumeLayout } from '../layout.ts';

// Plain-text renderer. No escaping (plain text is not markup); dynamic strings
// are emitted raw. Section headings are upper-cased for visual structure;
// entity groups get a subheading line; claims/skills/education are `- ` bullets.
export function renderPlaintext(layout: ResumeLayout): string {
  const lines: string[] = [];
  lines.push(layout.name);
  if (layout.headline) lines.push(layout.headline);
  if (layout.contactLine) lines.push(layout.contactLine);
  for (const link of layout.links) lines.push(`${link.label}: ${link.url}`);

  for (const section of layout.sections) {
    lines.push('', section.heading.toUpperCase());
    for (const group of section.groups) {
      if (group.subheading) lines.push(group.subheading);
      for (const line of group.lines) lines.push(`- ${line}`);
    }
  }

  return `${lines.join('\n')}\n`;
}
