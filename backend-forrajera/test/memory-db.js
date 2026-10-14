// Adaptador transaccional exclusivo de las pruebas. No conecta con Firebase.
const clone = value => structuredClone(value);
class Snapshot {
  constructor(ref, value) { this.ref = ref; this.id = ref.id; this.exists = value !== undefined; this.value = value; }
  data() { return clone(this.value); }
}
class Query {
  constructor(db, collection, filters = [], order = null, count = Infinity) { Object.assign(this, { db, collection, filters, order, count }); }
  where(field, op, value) { return new Query(this.db, this.collection, [...this.filters, [field, op, value]], this.order, this.count); }
  orderBy(field, direction = 'asc') { return new Query(this.db, this.collection, this.filters, [field, direction], this.count); }
  limit(count) { return new Query(this.db, this.collection, this.filters, this.order, count); }
  snapshot(data) {
    let docs = [...data.entries()].filter(([key]) => key.startsWith(this.collection + '/')).map(([key, value]) => new Snapshot(new Ref(this.db, this.collection, key.split('/')[1]), value));
    for (const [field, op, expected] of this.filters) docs = docs.filter(s => {
      const actual = s.data()[field];
      if (op === '==') return actual === expected;
      if (op === '>=') return actual >= expected;
      if (op === '<') return actual < expected;
      throw new Error(`Operador de prueba no implementado: ${op}`);
    });
    if (this.order) {
      const [field, direction] = this.order;
      docs = docs.filter(s => s.data()[field] !== undefined).sort((a, b) => {
        const av = a.data()[field], bv = b.data()[field];
        return (av > bv ? 1 : av < bv ? -1 : 0) * (direction === 'desc' ? -1 : 1);
      });
    }
    docs = docs.slice(0, this.count);
    return { docs, size: docs.length, empty: !docs.length, forEach(fn) { docs.forEach(fn); } };
  }
  async get() { return this.snapshot(this.db.data); }
}
class Collection extends Query {
  doc(id) { return new Ref(this.db, this.collection, id); }
}
class Ref {
  constructor(db, collection, id) { Object.assign(this, { db, collection, id }); this.key = `${collection}/${id}`; this.parent = new Collection(db, collection); }
  async get() { return new Snapshot(this, this.db.data.get(this.key)); }
  async set(value) { this.db.data.set(this.key, clone(value)); }
  async update(value) { if (!this.db.data.has(this.key)) throw new Error('Documento inexistente'); this.db.data.set(this.key, { ...this.db.data.get(this.key), ...clone(value) }); }
  async delete() { this.db.data.delete(this.key); }
}
class MemoryDB {
  constructor() { this.data = new Map(); this.queue = Promise.resolve(); this.retryNext = false; }
  collection(name) { return new Collection(this, name); }
  async runTransaction(fn) {
    const run = this.queue.then(async () => {
      const attempt = async () => {
        const next = clone(this.data); let writes = false;
        const tx = {
          get: async target => {
            if (writes) throw new Error('Una transacción de Firestore no puede leer después de escribir.');
            return target instanceof Ref ? new Snapshot(target, next.get(target.key)) : target.snapshot(next);
          },
          set: (target, value) => { writes = true; next.set(target.key, clone(value)); },
          update: (target, value) => { writes = true; if (!next.has(target.key)) throw new Error('Documento inexistente'); next.set(target.key, { ...next.get(target.key), ...clone(value) }); },
          delete: target => { writes = true; next.delete(target.key); }
        };
        const result = await fn(tx);
        return { next, result };
      };
      if (this.retryNext) { this.retryNext = false; await attempt(); }
      const { next, result } = await attempt(); this.data = next; return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
module.exports = { MemoryDB };
