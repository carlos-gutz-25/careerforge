<script setup lang="ts">
import type {
  CitationSourceKind,
  ClaimProvenanceLaw,
  ClaimShapeRule,
  FitReportResponse,
  FitReportResumeDocumentResponse,
  ParseAuditReport,
  ResumeAuditFormat,
  ResumeClaimSection,
  ResumeComposeRunStatus,
  ResumeExportFormat,
  SkillLevel,
} from '@careerforge/core';
import { ApiError } from '../utils/api-error.ts';

// Resume Studio composed document (M6-04/M6-05, ADR-0018) - the PRIMARY,
// submittable resume assembled from verified evidence with per-claim provenance,
// distinct from the M2-10 tailoring GUIDE (ResumeVariantSection) rendered below
// it (the UI must never present one as the other; the composed doc is the real
// resume, the variant is an emphasis guide).
//
// Rendering law (M1-02, the house rule): claim `text` is the user's own
// composed-from-evidence prose and citation `sourceText` is the durable snapshot
// of cited verified evidence - both UNTRUSTED on display, rendered via
// {{ interpolation }} / <pre> text nodes ONLY (v-html is a lint error repo-wide).
// Contact links render as escaped TEXT, never an <a href> (S-02, the artifactUrl
// precedent). Contact / education / skills are the deterministic verified facts.
//
// Compose is review-gated (the fit report must be reviewed - the tailoring
// precedent) and a PAID LLM call (10-20 s, fire-once pending). A `flagged` gate
// violation or an `empty` zero-claim draft persists NOTHING (document null,
// run.status the discriminant) - the loud state. Redraft supersedes the current
// and drafts revision N+1 (another paid call). Export (5 formats) and the
// render-fidelity parse-audit are the reviewed-doc surfaces; export is
// reviewed + non-superseded only.
const props = defineProps<{ reportId: string; report: FitReportResponse }>();

const api = useApi();
// M10-04, D4: demo instances disable the compose + redraft LLM-draft POSTs
// (server enforces; the disabled buttons + demoAwareErrorMessage belt are the
// UI honesty layer).
const { demo } = useDemoMode();

// Deliberately LOCAL typed lists/records, not runtime imports of core's enums
// (the M1-11 vite-optimizer law keeps core's zod out of the bundle). A
// `Record<Enum, ...>` makes a new core member a typecheck error here; the
// component test pins each list/map complete against core's runtime array too.
// ONE documented exception: RUN_STATUS_LABELS below is deliberately Partial and
// reads through a fallback (M15-03) - see the reasoning at its declaration.
const CLAIM_SECTIONS: ResumeClaimSection[] = ['summary', 'experience', 'project'];
const SECTION_LABELS: Record<ResumeClaimSection, string> = {
  summary: 'Summary',
  experience: 'Experience',
  project: 'Projects',
};
const SKILL_LEVEL_LABELS: Record<SkillLevel, string> = {
  expert: 'Expert',
  solid: 'Solid',
  rusty: 'Rusty',
  learning: 'Learning',
};
const CITATION_SOURCE_LABELS: Record<CitationSourceKind, string> = {
  experience_bullet: 'Experience',
  mastery_evidence: 'Mastery evidence',
  project: 'Project',
  summary: 'Summary',
};
// The non-persisting compose terminals (a `flagged` gate violation, an `empty`
// zero-claim draft, or an LLM transport failure) each get an honest label.
//
// M15-03: this map is deliberately PARTIAL over the status vocabulary, and every
// read goes through `runStatusLabel` below. This is a knowing departure from the
// local-typed-Record convention documented above, for two reasons:
//
//   1. It used to be `Record<ResumeComposeRunStatus, string>` - exhaustive - so an
//      unlabelled status was a compile error IN THIS FILE. That turned any widening
//      of the shared `RESUME_COMPOSE_RUN_STATUSES` enum into a CROSS-LANE BUILD
//      BREAK: the lane adding a status could not land green without editing this
//      component. A shared enum consumed by an exhaustive Record in another lane's
//      surface is a build coupling, and this is the decoupling (Carlos's ruling,
//      2026-08-13). The convention still holds for the other maps here.
//   2. Exhaustiveness never protected the RUNTIME anyway. A server that knows a
//      status this bundle does not - deploy skew, not a hypothetical - indexed the
//      map to `undefined` and rendered a BLANK where the status belongs:
//      "The last compose did not produce a resume (status: )." That live defect on
//      main is what this change fixes; the enum widening merely surfaced it.
//
// The tripwire that is lost (a new core status failing typecheck here) is traded
// for the fallback below plus its two tests. A new status therefore renders
// HONESTLY but genericly until this lane gives it a curated label - which is the
// intended sequence, not an oversight.
const RUN_STATUS_LABELS: Partial<Record<ResumeComposeRunStatus, string>> = {
  ok: 'ok',
  schema_failed: 'invalid structure',
  refusal: 'declined',
  max_tokens: 'truncated',
  error: 'error',
  flagged: 'flagged',
  empty: 'empty',
};

// Never render a blank status. An unlabelled status falls back to its own raw
// token, which is honest (it is the value the API actually reported), debuggable,
// and safe to render: run statuses are a closed server-side vocabulary validated
// at the boundary, not posting-derived text, and this is a `{{ }}` text node.
// Inventing a friendly word for a status we do not recognise would be the system
// claiming to understand something it does not.
function runStatusLabel(status: ResumeComposeRunStatus): string {
  return RUN_STATUS_LABELS[status] ?? status;
}
// M15-02 - the flagged-run banner names what actually failed. The gate reports a
// closed vocabulary of law ids (M15-01); this maps them to plain sentences.
//
// Every label states a STRUCTURAL FACT about the draft and never a judgment
// about the person: the incident that motivated this story was a summary that
// ran 84 characters long, and the old copy called it a fabrication.
//
// Caps are LOCAL numbers, not runtime imports of core's constants: core's
// resume-compose module builds zod schemas at import time, so a value import
// would pull zod into the client bundle (the M1-11 zod-free-client law, same
// cost the CreateLearningPlanSection precedent already paid). The component test
// value-imports core's constants and asserts these equal them, so a cap changed
// in core turns the test RED instead of quietly producing a lying banner.
const SUMMARY_TOTAL_CAP = 600;
const CLAIM_TEXT_CAP = 300;
const MAX_CLAIMS = 40;
const MAX_CLAIMS_PER_EXPERIENCE = 6;
const MAX_CLAIMS_PER_PROJECT = 4;
// ORDER is load-bearing, not cosmetic: violations arrive sorted by claimIndex
// FIRST (law rank only breaks ties within one claim), so rendering distinct laws
// in law order requires this re-sort. The test pins these deep-equal to core's
// arrays as SEQUENCES - membership alone would pass on a permuted list.
const LAW_ORDER: ClaimProvenanceLaw[] = [
  'citation_membership',
  'numeric',
  'vocabulary',
  'provenance_class',
  'external_pointer',
  'shape',
];
const SHAPE_RULE_ORDER: ClaimShapeRule[] = [
  'entity_ref_forbidden',
  'entity_ref_missing',
  'entity_ref_unknown',
  'claim_text_cap',
  'claim_count_cap',
  'experience_claim_cap',
  'project_claim_cap',
  'summary_total_cap',
];
const LAW_LABELS: Record<ClaimProvenanceLaw, string> = {
  citation_membership:
    'A claim cited evidence that was not part of what the model was given, so the citation did not resolve.',
  numeric: 'A number in a claim was not backed by the evidence it cited.',
  vocabulary:
    'A skill phrase in a claim was not backed by the evidence it cited. Short or common skill names over-flag here by design, so this one is often a false alarm.',
  provenance_class:
    'Evidence from one role, or from personal work, was cited under a different one.',
  external_pointer:
    'A claim carried a link, an email address, or a domain. Those belong in the contact header, not in resume prose.',
  shape: 'The draft broke a structural limit.',
};
// The `shape` law's sub-rules say WHICH structure failed. The last four are
// aggregate caps: no single claim is defective, the SET is too large.
const SHAPE_RULE_LABELS: Record<ClaimShapeRule, string> = {
  entity_ref_forbidden:
    'A summary claim was attached to a specific role or project. Summary claims stand on their own.',
  entity_ref_missing: 'A claim was not attached to any role or project.',
  entity_ref_unknown:
    'A claim was attached to a role or project that was not part of what the model was given.',
  claim_text_cap: `One claim ran past the ${CLAIM_TEXT_CAP} character limit for a single claim.`,
  claim_count_cap: `The draft held more than the ${MAX_CLAIMS} claim limit.`,
  experience_claim_cap: `One role carried more than the ${MAX_CLAIMS_PER_EXPERIENCE} claim limit for a single role.`,
  project_claim_cap: `One project carried more than the ${MAX_CLAIMS_PER_PROJECT} claim limit for a single project.`,
  summary_total_cap: `The summary ran past its ${SUMMARY_TOTAL_CAP} character total.`,
};
const EXPORT_FORMATS: ResumeExportFormat[] = ['pdf', 'docx', 'markdown', 'plaintext', 'json'];
const EXPORT_FORMAT_LABELS: Record<ResumeExportFormat, string> = {
  pdf: 'PDF',
  docx: 'Word (.docx)',
  markdown: 'Markdown',
  plaintext: 'Plain text',
  json: 'JSON',
};
const AUDIT_FORMATS: ResumeAuditFormat[] = ['pdf', 'docx'];

const { data, status, error, refresh } = useAsyncData(
  `fit-report-${props.reportId}-resume-document`,
  () => api.getResumeDocument(props.reportId),
);

// The current persisted document comes from the GET (source of truth); the last
// compose/redraft POST outcome is kept locally because GET always returns
// `run: null`, so a `flagged`/`empty` terminal (document null) would otherwise
// vanish on refresh. Run telemetry likewise lives only on the POST response.
const lastOutcome = ref<FitReportResumeDocumentResponse | null>(null);
const doc = computed(() => data.value?.document ?? null);
const lastRun = computed(() => lastOutcome.value?.run ?? null);
// A non-ok run with no document is the loud non-persisting terminal.
const failedRun = computed(() =>
  doc.value === null && lastRun.value !== null && lastRun.value.status !== 'ok'
    ? lastRun.value
    : null,
);

// M15-02, D1 - the banner says only what the payload supports. `gateViolations`
// has exactly three states and never `undefined` (M15-01's wire contract):
//   null  - the gate never verdicted this run, or the row predates the column
//   []    - a contradiction on a flagged run; the API rejects it for new rows,
//           so treat it as "not recorded" rather than rendering an empty list
//   items - the laws that actually fired
// Both empty cases yield NO sentences, and the template says so honestly instead
// of guessing. Guessing is exactly the defect this story exists to remove.
const gateLawSentences = computed<string[]>(() => {
  const violations = failedRun.value?.gateViolations ?? null;
  if (violations === null || violations.length === 0) return [];
  const laws = new Set(violations.map((violation) => violation.law));
  const shapeRules = new Set(
    violations.flatMap((violation) => (violation.law === 'shape' ? (violation.detail ?? []) : [])),
  );
  return LAW_ORDER.filter((law) => laws.has(law)).flatMap((law) => {
    if (law !== 'shape') return [LAW_LABELS[law]];
    // A bare `shape` with no sub-rules still deserves a sentence.
    const rules = SHAPE_RULE_ORDER.filter((rule) => shapeRules.has(rule));
    return rules.length > 0 ? rules.map((rule) => SHAPE_RULE_LABELS[rule]) : [LAW_LABELS.shape];
  });
});
const gateLawText = computed(() => gateLawSentences.value.join(' '));

const claimGroups = computed(() =>
  CLAIM_SECTIONS.map((section) => ({
    section,
    claims: (doc.value?.claims ?? []).filter((claim) => claim.section === section),
  })).filter((group) => group.claims.length > 0),
);

// Compose (fire-once pending; gated on report.reviewStatus==='reviewed'). On a
// persisting outcome we refresh the GET to pull the new current document; on a
// non-persisting terminal we keep the POST outcome to show the failed-run state.
const composing = ref(false);
const composeError = ref<string | null>(null);
async function compose() {
  if (composing.value) return;
  composeError.value = null;
  composing.value = true;
  try {
    const outcome = await api.composeResumeDocument(props.reportId);
    lastOutcome.value = outcome;
    if (outcome.document) await refresh();
  } catch (cause) {
    composeError.value = demoAwareErrorMessage(cause, 'Compose failed. Is the API running?');
  } finally {
    composing.value = false;
  }
}

// Redraft: supersede the current document and draft revision N+1 (another paid
// call). Available whenever a document exists.
const redrafting = ref(false);
const redraftError = ref<string | null>(null);
async function redraft() {
  if (!doc.value || redrafting.value) return;
  redraftError.value = null;
  redrafting.value = true;
  try {
    const outcome = await api.redraftResumeDocument(doc.value.id);
    lastOutcome.value = outcome;
    await refresh();
    // A flagged/empty redraft supersedes the old current, so the refresh returns
    // document null and the failed-run state takes over - honest either way.
  } catch (cause) {
    redraftError.value = demoAwareErrorMessage(cause, 'Redraft failed. Is the API running?');
  } finally {
    redrafting.value = false;
  }
}

// One-shot draft->reviewed CAS.
const reviewNotes = ref('');
const reviewing = ref(false);
const reviewError = ref<string | null>(null);
async function markReviewed() {
  if (!doc.value || reviewing.value) return;
  reviewError.value = null;
  reviewing.value = true;
  try {
    await api.reviewResumeDocument(doc.value.id, {
      notes: reviewNotes.value ? reviewNotes.value : null,
    });
    await refresh();
  } catch (cause) {
    reviewError.value =
      cause instanceof ApiError ? cause.message : 'Review failed. Is the API running?';
  } finally {
    reviewing.value = false;
  }
}

// Export = a browser download (reviewed + non-superseded only, re-derived
// server-side; the button is offered only on a reviewed current document).
const exportFormat = ref<ResumeExportFormat>('pdf');
const exporting = ref(false);
const exportError = ref<string | null>(null);
async function exportDocument() {
  if (!doc.value || exporting.value) return;
  exportError.value = null;
  exporting.value = true;
  try {
    await api.exportResumeDocument(doc.value.id, exportFormat.value);
  } catch (cause) {
    exportError.value =
      cause instanceof ApiError ? cause.message : 'Export failed. Is the API running?';
  } finally {
    exporting.value = false;
  }
}

// Parse-audit: a render-fidelity diagnostic (does the exported pdf/docx still
// contain every claim, in order). Draft-allowed - it helps the reviewer decide.
const auditFormat = ref<ResumeAuditFormat>('pdf');
const auditing = ref(false);
const auditError = ref<string | null>(null);
const auditReport = ref<ParseAuditReport | null>(null);
async function runParseAudit() {
  if (!doc.value || auditing.value) return;
  auditError.value = null;
  auditing.value = true;
  try {
    auditReport.value = await api.getResumeParseAudit(doc.value.id, auditFormat.value);
  } catch (cause) {
    auditError.value =
      cause instanceof ApiError ? cause.message : 'Parse audit failed. Is the API running?';
  } finally {
    auditing.value = false;
  }
}
</script>

<template>
  <section data-testid="resume-studio-section">
    <h2>Composed resume</h2>
    <p class="rs-blurb">
      Your real, submittable resume for this posting - composed from verified evidence with every
      claim cited. This is the primary artifact; the tailoring guide below only reorders and
      emphasizes.
    </p>

    <AppSkeleton v-if="status === 'pending'" :lines="5" />
    <p v-else-if="error" role="alert" data-testid="rs-load-error">
      Could not load the composed resume: {{ error.message }}
    </p>

    <template v-else>
      <p v-if="failedRun" class="rs-failed" role="alert" data-testid="rs-failed-run">
        The last compose did not produce a resume (status:
        {{ runStatusLabel(failedRun.status) }}).
        <template v-if="failedRun.status === 'flagged'">
          <template v-if="gateLawSentences.length > 0">
            <span data-testid="rs-gate-laws">{{ gateLawText }}</span>
          </template>
          <template v-else>
            <span data-testid="rs-gate-unrecorded">
              The draft did not pass one or more of the provenance checks. Which check is not
              recorded for this run.
            </span>
          </template>
          The whole draft was rejected rather than persist an unverifiable resume.
        </template>
        <template v-else-if="failedRun.status === 'empty'">
          The draft carried no claims, so nothing was saved.
        </template>
        Composing again is a fresh paid call.
      </p>

      <!-- No current document: review gate or the compose trigger. -->
      <template v-if="doc === null">
        <p v-if="report.reviewStatus !== 'reviewed'" data-testid="rs-review-gate">
          Review the fit report first - the composed resume draws from the reviewed classifications.
        </p>
        <template v-else>
          <button
            type="button"
            :disabled="composing || demo"
            data-testid="rs-compose-button"
            @click="compose"
          >
            {{ composing ? 'Composing… (10–20 s, one paid call)' : 'Compose resume' }}
          </button>
          <AppStateChip v-if="demo" variant="info" data-testid="rs-compose-demo-note">{{
            DEMO_DISABLED_CHIP
          }}</AppStateChip>
          <p v-if="composeError" role="alert" data-testid="rs-compose-error">{{ composeError }}</p>
        </template>
      </template>

      <!-- Current document: the composed resume + its review/export lifecycle. -->
      <template v-else>
        <p class="rs-meta" data-testid="rs-meta">
          <span class="rs-revision">revision {{ doc.revision }}</span>
          <AppStateChip
            :variant="doc.reviewStatus === 'reviewed' ? 'reviewed' : 'draft'"
            data-testid="rs-status-chip"
          >
            {{ doc.reviewStatus === 'reviewed' ? 'Reviewed' : 'Draft - review before exporting' }}
          </AppStateChip>
          <AppStateChip v-if="doc.stale" variant="info" data-testid="rs-stale-chip">
            profile changed since - redraft to refresh
          </AppStateChip>
        </p>

        <!-- Contact (deterministic verified facts). Links are escaped TEXT. -->
        <div class="rs-contact" data-testid="rs-contact">
          <h3 class="rs-name">{{ doc.canonicalDoc.contact.fullName }}</h3>
          <p v-if="doc.canonicalDoc.contact.headline" class="rs-headline">
            {{ doc.canonicalDoc.contact.headline }}
          </p>
          <p class="rs-contact-line">
            <span v-if="doc.canonicalDoc.contact.email">{{ doc.canonicalDoc.contact.email }}</span>
            <span v-if="doc.canonicalDoc.contact.phone">{{ doc.canonicalDoc.contact.phone }}</span>
            <span v-if="doc.canonicalDoc.contact.location">
              {{ doc.canonicalDoc.contact.location }}
            </span>
          </p>
          <ul
            v-if="doc.canonicalDoc.contact.links.length > 0"
            class="rs-links"
            data-testid="rs-links"
          >
            <li v-for="(link, i) in doc.canonicalDoc.contact.links" :key="i">
              {{ link.label }} - {{ link.url }}
            </li>
          </ul>
        </div>

        <!-- Claims grouped by section, each with its resolved entity + citations. -->
        <div v-for="group in claimGroups" :key="group.section" data-testid="rs-claim-group">
          <h3>{{ SECTION_LABELS[group.section] }}</h3>
          <ul class="rs-claim-list">
            <li v-for="claim in group.claims" :key="claim.id" data-testid="rs-claim">
              <p v-if="claim.entityLabel" class="rs-entity" data-testid="rs-claim-entity">
                {{ claim.entityLabel }}
              </p>
              <p class="rs-claim-text">{{ claim.text }}</p>
              <details v-if="claim.citations.length > 0" data-testid="rs-claim-citations">
                <summary>Evidence ({{ claim.citations.length }})</summary>
                <ul class="rs-citation-list">
                  <li v-for="(citation, i) in claim.citations" :key="i" class="rs-citation">
                    <span class="rs-citation-kind">{{
                      CITATION_SOURCE_LABELS[citation.sourceKind]
                    }}</span>
                    <span class="rs-citation-text">{{ citation.sourceText }}</span>
                  </li>
                </ul>
              </details>
            </li>
          </ul>
        </div>

        <!-- Education + skills (deterministic verified facts). -->
        <div v-if="doc.canonicalDoc.education.length > 0" data-testid="rs-education">
          <h3>Education</h3>
          <ul class="rs-edu-list">
            <li v-for="(edu, i) in doc.canonicalDoc.education" :key="i" class="rs-edu">
              <span class="rs-edu-inst">{{ edu.institution }}</span>
              <span v-if="edu.credential" class="rs-edu-cred">{{ edu.credential }}</span>
              <span v-if="edu.startYear || edu.endYear" class="rs-edu-years">
                {{ edu.startYear ?? '?' }}–{{ edu.endYear ?? '?' }}
              </span>
            </li>
          </ul>
        </div>
        <div v-if="doc.canonicalDoc.skills.length > 0" data-testid="rs-skills">
          <h3>Skills</h3>
          <ul class="rs-skill-list">
            <li v-for="(skill, i) in doc.canonicalDoc.skills" :key="i" class="rs-skill">
              {{ skill.name }}
              <span class="rs-skill-level">{{ SKILL_LEVEL_LABELS[skill.level] }}</span>
            </li>
          </ul>
        </div>

        <p v-if="doc.notes" class="rs-notes-shown" data-testid="rs-notes">{{ doc.notes }}</p>

        <!-- Draft: the review form. Reviewed: export + parse-audit. -->
        <div v-if="doc.reviewStatus === 'draft'" class="rs-review" data-testid="rs-review-form">
          <textarea
            v-model="reviewNotes"
            :disabled="reviewing"
            placeholder="Review notes (optional)"
            data-testid="rs-review-notes"
            aria-label="Composed resume review notes"
          ></textarea>
          <button
            type="button"
            :disabled="reviewing"
            data-testid="rs-mark-reviewed"
            @click="markReviewed"
          >
            {{ reviewing ? 'Saving…' : 'Mark reviewed' }}
          </button>
          <p v-if="reviewError" role="alert" data-testid="rs-review-error">{{ reviewError }}</p>
        </div>

        <div v-else class="rs-export" data-testid="rs-export-form">
          <div class="rs-export-row">
            <label class="rs-field-label" for="rs-export-format">Export format</label>
            <select
              id="rs-export-format"
              v-model="exportFormat"
              :disabled="exporting"
              data-testid="rs-export-format"
            >
              <option v-for="format in EXPORT_FORMATS" :key="format" :value="format">
                {{ EXPORT_FORMAT_LABELS[format] }}
              </option>
            </select>
            <button
              type="button"
              :disabled="exporting"
              data-testid="rs-export-button"
              @click="exportDocument"
            >
              {{ exporting ? 'Exporting…' : 'Export' }}
            </button>
          </div>
          <p v-if="exportError" role="alert" data-testid="rs-export-error">{{ exportError }}</p>

          <div class="rs-audit" data-testid="rs-audit">
            <p class="rs-audit-blurb">
              Render-fidelity check - does the exported file still contain every claim, in order?
              This is not an ATS or coverage prediction.
            </p>
            <div class="rs-export-row">
              <label class="rs-field-label" for="rs-audit-format">Audit format</label>
              <select
                id="rs-audit-format"
                v-model="auditFormat"
                :disabled="auditing"
                data-testid="rs-audit-format"
              >
                <option v-for="format in AUDIT_FORMATS" :key="format" :value="format">
                  {{ EXPORT_FORMAT_LABELS[format] }}
                </option>
              </select>
              <button
                type="button"
                :disabled="auditing"
                data-testid="rs-audit-button"
                @click="runParseAudit"
              >
                {{ auditing ? 'Checking…' : 'Check render fidelity' }}
              </button>
            </div>
            <p v-if="auditError" role="alert" data-testid="rs-audit-error">{{ auditError }}</p>
            <div v-if="auditReport" class="rs-audit-report" data-testid="rs-audit-report">
              <p>
                <AppStateChip
                  :variant="auditReport.parseIntegrity.ok ? 'reviewed' : 'danger'"
                  data-testid="rs-audit-structure"
                >
                  structure {{ auditReport.parseIntegrity.ok ? 'intact' : 'incomplete' }}
                </AppStateChip>
                <AppStateChip
                  :variant="auditReport.evidenceIntegrity.ok ? 'reviewed' : 'danger'"
                  data-testid="rs-audit-evidence"
                >
                  evidence {{ auditReport.evidenceIntegrity.ok ? 'intact' : 'incomplete' }}
                </AppStateChip>
              </p>
              <p v-if="auditReport.parseIntegrity.missing.length > 0" class="rs-audit-detail">
                Missing anchors: {{ auditReport.parseIntegrity.missing.join(', ') }}
              </p>
              <p v-if="auditReport.parseIntegrity.outOfOrder.length > 0" class="rs-audit-detail">
                Out of order: {{ auditReport.parseIntegrity.outOfOrder.join(', ') }}
              </p>
              <p
                v-if="auditReport.evidenceIntegrity.missingClaims.length > 0"
                class="rs-audit-detail"
              >
                Claims that did not survive (by position):
                {{ auditReport.evidenceIntegrity.missingClaims.join(', ') }}
              </p>
              <p class="rs-audit-honesty">{{ auditReport.honesty }}</p>
            </div>
          </div>
        </div>

        <!-- Redraft is available on any current document (a fresh paid call). -->
        <div class="rs-redraft" data-testid="rs-redraft-form">
          <button
            type="button"
            :disabled="redrafting || demo"
            data-testid="rs-redraft-button"
            @click="redraft"
          >
            {{ redrafting ? 'Redrafting…' : 'Redraft (new revision, one paid call)' }}
          </button>
          <AppStateChip v-if="demo" variant="info" data-testid="rs-redraft-demo-note">{{
            DEMO_DISABLED_CHIP
          }}</AppStateChip>
          <p v-if="redraftError" role="alert" data-testid="rs-redraft-error">{{ redraftError }}</p>
        </div>
      </template>

      <p v-if="lastRun" class="rs-telemetry" data-testid="rs-telemetry">
        {{ lastRun.model }} · {{ lastRun.promptId }} · {{ lastRun.inputTokens }}/{{
          lastRun.outputTokens
        }}
        tok · {{ lastRun.latencyMs }} ms · {{ runStatusLabel(lastRun.status) }} · attempt
        {{ lastRun.attempt }}
      </p>
    </template>
  </section>
</template>

<style scoped>
.rs-blurb {
  color: var(--color-muted);
  margin: 0 0 var(--space-3);
  max-width: 42rem;
}
.rs-failed {
  background: var(--color-danger-bg);
  border: 1px solid var(--color-danger);
  padding: var(--space-2) var(--space-3);
  font-weight: 600;
  margin: 0 0 var(--space-3);
}
.rs-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin: 0 0 var(--space-3);
}
.rs-revision {
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  color: var(--color-muted);
}
.rs-contact {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-panel);
  padding: var(--space-3);
  margin: 0 0 var(--space-3);
}
.rs-name {
  margin: 0;
}
.rs-headline {
  margin: 0.1rem 0 0;
  color: var(--color-text);
}
.rs-contact-line {
  display: flex;
  gap: var(--space-1) var(--space-3);
  flex-wrap: wrap;
  margin: var(--space-2) 0 0;
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  color: var(--color-muted);
}
.rs-links {
  list-style: none;
  padding: 0;
  margin: var(--space-2) 0 0;
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  color: var(--color-muted);
}
.rs-links li {
  overflow-wrap: anywhere;
}
.rs-claim-list,
.rs-citation-list,
.rs-edu-list,
.rs-skill-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.rs-claim-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}
.rs-claim {
  border-left: 3px solid var(--color-border);
  padding-left: var(--space-3);
}
.rs-entity {
  margin: 0 0 0.1rem;
  font-weight: 600;
}
.rs-claim-text {
  margin: 0;
}
.rs-citation-list {
  margin-top: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.rs-citation {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
  font-size: var(--font-size-sm);
  color: var(--color-muted);
}
.rs-citation-kind {
  font-family: var(--font-mono);
  color: var(--color-accent);
  flex-shrink: 0;
}
.rs-citation-text {
  overflow-wrap: anywhere;
}
.rs-edu-list,
.rs-skill-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-bottom: var(--space-2);
}
.rs-skill-list {
  flex-direction: row;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.rs-edu-inst {
  font-weight: 600;
}
.rs-edu-cred,
.rs-edu-years,
.rs-skill-level {
  color: var(--color-muted);
  font-size: var(--font-size-sm);
  margin-left: var(--space-2);
}
.rs-skill {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
}
.rs-skill-level {
  font-family: var(--font-mono);
  margin-left: var(--space-1);
}
.rs-notes-shown {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  background: var(--color-panel);
  border-left: 3px solid var(--color-border);
  padding: var(--space-2) var(--space-3);
  margin: var(--space-3) 0;
  color: var(--color-text);
}
.rs-review {
  margin-top: var(--space-3);
}
.rs-review textarea {
  display: block;
  width: 100%;
  max-width: 32rem;
  min-height: 4rem;
  margin-bottom: var(--space-2);
}
.rs-export {
  margin-top: var(--space-3);
}
.rs-export-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.rs-field-label {
  color: var(--color-muted);
  font-size: var(--font-size-sm);
}
.rs-audit {
  margin-top: var(--space-4);
  border-top: 1px solid var(--color-border);
  padding-top: var(--space-3);
}
.rs-audit-blurb {
  color: var(--color-muted);
  font-size: var(--font-size-sm);
  margin: 0 0 var(--space-2);
  max-width: 42rem;
}
.rs-audit-report {
  margin-top: var(--space-2);
}
.rs-audit-report p {
  margin: 0 0 var(--space-1);
}
.rs-audit-detail {
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  color: var(--color-danger);
  overflow-wrap: anywhere;
}
.rs-audit-honesty {
  color: var(--color-muted);
  font-size: var(--font-size-sm);
  font-style: italic;
}
.rs-redraft {
  margin-top: var(--space-4);
}
.rs-telemetry {
  color: var(--color-muted);
  font-size: var(--font-size-sm);
  font-family: var(--font-mono);
  border-top: 1px solid var(--color-border);
  padding-top: var(--space-2);
  margin-top: var(--space-4);
}
</style>
