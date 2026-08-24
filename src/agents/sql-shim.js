// A D1-shaped facade over a Durable Object's SQLite storage.
//
// This exists so src/lib/db.js can move into the per-user agent without
// being rewritten: every function there already takes a D1-ish handle as
// its first argument and uses only prepare/bind/first/all/run/batch, so
// pointing it at this object instead of `env.DB` re-homes the entire data
// layer with no change to its SQL or its row mapping. See
// docs/superpowers/plans/2026-08-24-agent-data-migration.md (decision D1)
// for why mechanical re-pointing beat rewriting ~23 statements onto the
// Agents SDK's tagged-template `sql` helper -- which, being synchronous and
// template-only, also can't express db.js's one dynamically-built UPDATE.
//
// Verified against @cloudflare/workers-types: SqlStorage.exec(query,
// ...bindings) returns a SqlStorageCursor exposing toArray()/one()/next(),
// and DurableObjectStorage.transactionSync(closure) takes a synchronous
// closure. Only the subset db.js actually calls is implemented; anything
// else should fail loudly rather than silently pretend to be D1.

class Stmt {
  constructor(sql, query, values = []) {
    this.sql = sql;
    this.query = query;
    this.values = values;
  }

  bind(...values) {
    return new Stmt(this.sql, this.query, values);
  }

  exec() {
    return this.sql.exec(this.query, ...this.values).toArray();
  }

  // async to match D1's contract; the underlying exec is synchronous.
  async first() {
    return this.exec()[0] ?? null;
  }

  async all() {
    return { results: this.exec(), success: true };
  }

  async run() {
    this.exec();
    return { success: true };
  }
}

export function d1Shim(sqlStorage, storage) {
  return {
    prepare: (query) => new Stmt(sqlStorage, query),

    // D1's batch() is implicitly transactional. transactionSync() is the
    // Durable Object equivalent and is in fact stronger: a real SQLite
    // transaction inside a single-threaded object, so nothing can
    // interleave. The closure must stay synchronous, which is why it calls
    // Stmt.exec() directly rather than awaiting the async wrappers above.
    async batch(stmts) {
      return storage.transactionSync(() =>
        stmts.map((s) => ({ results: s.exec(), success: true }))
      );
    },
  };
}
