export function createSnapshotVersion() {
  let revision = 0;
  let request = 0;
  return {
    changed() {
      revision++;
    },
    cancel() {
      request++;
    },
    begin() {
      const id = ++request;
      const version = revision;
      return {
        current: () => id === request,
        stale: () => version !== revision,
      };
    },
  };
}
