import {
  type Application,
  type ApplicationCreateBody,
  type ApplicationCreateResponse,
  type ApplicationDetail,
  type ApplicationEvent,
  type ApplicationEventCreateBody,
  type ApplicationStage,
  type ApplicationStageUpdateBody,
  type ApplicationWithPosting,
} from '@careerforge/core';
import {
  type ApplicationEventInsert,
  type ApplicationEventRow,
  type ApplicationRow,
  type ApplicationsRepository,
  type ApplicationWithPostingRow,
  type PostingsRepository,
} from '@careerforge/db';

import { PostingNotFoundError } from '../postings/postings.service.ts';

export class ApplicationNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    // Deliberately id-free (the posting-404 precedent): application ids are
    // caller-supplied path input, and 4xx messages pass through in every env.
    super('application not found');
  }
}

export class InvalidStageTransitionError extends Error {
  readonly statusCode = 409;
  readonly code = 'INVALID_STAGE_TRANSITION';
}

export interface ApplicationsService {
  create(userId: string, body: ApplicationCreateBody): Promise<ApplicationCreateResponse>;
  list(
    userId: string,
    filter: { stage?: ApplicationStage; postingId?: string },
  ): Promise<ApplicationWithPosting[]>;
  getDetail(userId: string, id: string): Promise<ApplicationDetail>;
  updateStage(userId: string, id: string, body: ApplicationStageUpdateBody): Promise<Application>;
  addEvent(userId: string, id: string, body: ApplicationEventCreateBody): Promise<ApplicationEvent>;
}

/** The packages/core wire shape; userId/updatedAt stay off the response (the
 *  serializer strips undeclared fields as defense-in-depth, per postings). */
function toWire(row: ApplicationRow): Application {
  return {
    id: row.id,
    postingId: row.postingId,
    stage: row.stage,
    appliedOn: row.appliedOn,
    createdAt: row.createdAt.toISOString(),
  };
}

function toWireWithPosting(row: ApplicationWithPostingRow): ApplicationWithPosting {
  return {
    ...toWire(row),
    posting: { company: row.posting.company, title: row.posting.title },
  };
}

function eventToWire(row: ApplicationEventRow): ApplicationEvent {
  return {
    id: row.id,
    kind: row.kind,
    detail: row.detail,
    occurredOn: row.occurredOn,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createApplicationsService(deps: {
  applications: ApplicationsRepository;
  /** Ownership check on create: the tracked posting must be the user's. */
  postings: PostingsRepository;
  /** occurredOn default seam (auth-service precedent). */
  now?: () => Date;
}): ApplicationsService {
  const { applications, postings } = deps;
  const now = deps.now ?? (() => new Date());

  /**
   * THE event constructor (M1-03 one-writer rule, service layer): every event
   * the service emits — system stage_change and user note/outcome alike — is
   * shaped here. occurredOn defaults to today (UTC date — accepted for a
   * personal tracker; the web form always sends it explicitly).
   */
  function eventInsert(
    kind: ApplicationEventInsert['kind'],
    detail: string,
    occurredOn: string | undefined,
  ): ApplicationEventInsert {
    return {
      kind,
      detail: detail.trim(),
      occurredOn: occurredOn ?? now().toISOString().slice(0, 10),
    };
  }

  return {
    async create(userId, body) {
      // Missing and foreign postings are the same 404 on purpose (user-scoped
      // read; existence of another user's posting is not observable). The
      // repository's ON CONFLICT create is then race-safe on its own.
      const posting = await postings.findForUser(userId, body.postingId);
      if (!posting) throw new PostingNotFoundError();
      const { application, created } = await applications.create(userId, body.postingId);
      return { application: toWire(application), duplicate: !created };
    },

    async list(userId, filter) {
      const rows = await applications.listForUser(userId, filter);
      return rows.map(toWireWithPosting);
    },

    async getDetail(userId, id) {
      const row = await applications.findForUser(userId, id);
      if (!row) throw new ApplicationNotFoundError();
      const events = await applications.listEvents(userId, id);
      return { ...toWireWithPosting(row), events: events.map(eventToWire) };
    },

    async updateStage(userId, id, body) {
      const row = await applications.findForUser(userId, id);
      if (!row) throw new ApplicationNotFoundError();
      // Same-stage PATCH is a 409, deliberately diverging from M1-02's
      // tolerated no-op (new → new): this PATCH has an event side effect, and
      // rejecting the no-op preserves "every successful PATCH emits exactly
      // one stage_change event" — no `applied → applied` trail garbage.
      // Value-safe: names only stages (a closed enum), never user input.
      if (row.stage === body.stage) {
        throw new InvalidStageTransitionError(`already in stage '${body.stage}'`);
      }
      const occurredOn = body.occurredOn ?? now().toISOString().slice(0, 10);
      // First transition INTO 'applied' sets appliedOn from the TRANSITION's
      // occurredOn — never server-now: a backdated applied must not record
      // today's date (approval amendment). First-entry-wins: never overwritten
      // on re-entry. Safe on a stale read — the conditional update below
      // yields zero rows and this decision is discarded with it.
      const appliedOn = body.stage === 'applied' && row.appliedOn === null ? occurredOn : undefined;
      const updated = await applications.transitionStage(
        userId,
        id,
        row.stage,
        { stage: body.stage, ...(appliedOn ? { appliedOn } : {}) },
        eventInsert('stage_change', `${row.stage} → ${body.stage}`, occurredOn),
      );
      if (!updated) {
        throw new InvalidStageTransitionError('application stage changed concurrently — reload');
      }
      return toWire(updated);
    },

    async addEvent(userId, id, body) {
      const row = await applications.findForUser(userId, id);
      if (!row) throw new ApplicationNotFoundError();
      const event = await applications.addEvent(
        userId,
        id,
        eventInsert(body.kind, body.detail, body.occurredOn),
      );
      return eventToWire(event);
    },
  };
}
