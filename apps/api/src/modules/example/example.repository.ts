// ── Layering reference: REPOSITORY ──────────────────────────────────────
// The repository is the only layer that touches persistence, and services
// depend on this interface, never an implementation. This in-memory stub is
// the placeholder until M0-06, when packages/db provides the Drizzle-backed
// implementation (the only place SQL is allowed) and replaces it at the
// composition root in app.ts.

export interface ExampleItem {
  id: string;
  name: string;
}

export interface ExampleRepository {
  findById(id: string): Promise<ExampleItem | undefined>;
  list(): Promise<ExampleItem[]>;
}

const DEMO_ITEMS: ExampleItem[] = [
  { id: 'one', name: 'First example item' },
  { id: 'two', name: 'Second example item' },
];

export function createInMemoryExampleRepository(
  seed: ExampleItem[] = DEMO_ITEMS,
): ExampleRepository {
  const items = new Map(seed.map((item) => [item.id, item]));
  return {
    findById: (id) => Promise.resolve(items.get(id)),
    list: () => Promise.resolve([...items.values()]),
  };
}
