// ── Layering reference: SERVICE ─────────────────────────────────────────
// Services hold the domain rules. They depend on repository interfaces
// (injected at the composition root in app.ts) and know nothing about HTTP
// or storage. Domain errors carry statusCode/code so the centralized error
// handler can translate them without a mapping table.

import { type ExampleItem, type ExampleRepository } from './example.repository.ts';

export class NotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
}

export interface ExampleService {
  getItem(id: string): Promise<ExampleItem>;
  listItems(): Promise<ExampleItem[]>;
}

export function createExampleService(repository: ExampleRepository): ExampleService {
  return {
    async getItem(id) {
      const item = await repository.findById(id);
      if (!item) throw new NotFoundError(`example item '${id}' not found`);
      return item;
    },
    listItems: () => repository.list(),
  };
}
