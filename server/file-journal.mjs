import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

// One server owns the persistent disk. The durable intent lets startup reconcile
// a folder rename with PostgreSQL after a crash, including an uncertain commit.
export function createFileJournal({ db, absolute, jobRelative }) {
  const directory = absolute(".operations");
  mkdirSync(directory, { recursive: true });
  const filename = (id) => path.join(directory, `job-${id}.json`);
  const pattern = /^job-([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\.json$/;

  async function recover(file, client = db) {
    const match = pattern.exec(path.basename(file));
    if (!match) throw new Error("Invalid file journal name");
    const record = JSON.parse(readFileSync(absolute(`.operations/${path.basename(file)}`), "utf8"));
    const stores = ["supersix", "fern", "gstation"];
    if (
      record.version !== 1 ||
      record.jobId !== match[1] ||
      !stores.includes(record.from) ||
      !stores.includes(record.to) ||
      record.from === record.to
    )
      throw new Error("Invalid file journal record");
    const job = await client.job.findUnique({ where: { id: record.jobId } });
    if (!job || ![record.from, record.to].includes(job.store))
      throw new Error("Cannot reconcile media journal with database; preserve disk for recovery");
    const source = absolute(jobRelative(job, record.from));
    const destination = absolute(jobRelative(job, record.to));
    const oldExists = existsSync(source);
    const newExists = existsSync(destination);
    if (oldExists === newExists)
      throw new Error("Ambiguous media folders; preserve disk for recovery");
    if (job.store === record.to && oldExists) {
      mkdirSync(path.dirname(destination), { recursive: true });
      renameSync(source, destination);
    } else if (job.store === record.from && newExists) {
      mkdirSync(path.dirname(source), { recursive: true });
      renameSync(destination, source);
    }
    unlinkSync(file);
  }

  return {
    async recoverAll() {
      for (const entry of readdirSync(directory))
        if (pattern.test(entry)) await recover(path.join(directory, entry));
    },
    async recoverJob(id, client) {
      if (existsSync(filename(id))) await recover(filename(id), client);
    },
    begin(job, nextStore) {
      const file = filename(job.id);
      writeFileSync(
        file,
        JSON.stringify({ version: 1, jobId: job.id, from: job.store, to: nextStore }),
        { encoding: "utf8", flag: "wx", flush: true },
      );
      return () => unlinkSync(file);
    },
  };
}
