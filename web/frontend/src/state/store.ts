// Minimal pub/sub store base. State modules extend this to notify subscribers
// on change, replacing the old dashboard.html pattern of "mutate global then
// manually call render()".
export type Listener = () => void

export class Store {
  private listeners = new Set<Listener>()

  subscribe(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  protected notify(): void {
    for (const l of this.listeners) {
      try {
        l()
      } catch {
        // ignore
      }
    }
  }
}
