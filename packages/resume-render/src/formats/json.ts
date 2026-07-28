import { type CanonicalResumeDoc } from '@careerforge/core';

// JSON renderer: the canonical document as structured data (the consumer escapes
// on display - this format IS data, not markup). Deterministic by STABLE
// serialization: the output object is rebuilt in fixed CanonicalResumeDoc field
// order and pretty-printed, so the bytes never depend on incoming key order.
// This is the raw canonical snapshot, not the layout projection.
export function renderJson(doc: CanonicalResumeDoc): string {
  const stable = {
    contact: {
      fullName: doc.contact.fullName,
      headline: doc.contact.headline,
      email: doc.contact.email,
      phone: doc.contact.phone,
      location: doc.contact.location,
      links: doc.contact.links.map((link) => ({ label: link.label, url: link.url })),
    },
    education: doc.education.map((edu) => ({
      institution: edu.institution,
      credential: edu.credential,
      startYear: edu.startYear,
      endYear: edu.endYear,
    })),
    skills: doc.skills.map((skill) => ({ name: skill.name, level: skill.level })),
    claims: doc.claims.map((claim) => ({
      section: claim.section,
      entityRef: claim.entityRef,
      entityLabel: claim.entityLabel,
      text: claim.text,
      position: claim.position,
    })),
  };
  return `${JSON.stringify(stable, null, 2)}\n`;
}
