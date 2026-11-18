-- Prisma Migrate creates and selects the schema from the connection URL.
BEGIN;

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "store" TEXT NOT NULL DEFAULT 'supersix',
    "title" TEXT NOT NULL,
    "requester" TEXT NOT NULL DEFAULT '',
    "brief" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'image',
    "planned_date" TEXT NOT NULL DEFAULT '',
    "due_date" TEXT NOT NULL DEFAULT '',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "quantity" INTEGER,
    "work_status" TEXT NOT NULL DEFAULT 'todo',
    "post_status" TEXT NOT NULL DEFAULT 'unposted',
    "post_url" TEXT NOT NULL DEFAULT '',
    "post_date" TEXT NOT NULL DEFAULT '',
    "post_note" TEXT NOT NULL DEFAULT '',
    "reference_url" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "relative_path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "reel_anchor" TEXT NOT NULL DEFAULT '',
    "reel_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobs_created_idx" ON "jobs"("deleted_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "assets_relative_path_key" ON "assets"("relative_path");

-- CreateIndex
CREATE INDEX "assets_job_idx" ON "assets"("job_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "jobs" ADD CONSTRAINT "jobs_store_check" CHECK ("store" IN ('supersix', 'fern', 'gstation'));
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_type_check" CHECK ("type" IN ('image', 'reel'));
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_quantity_check" CHECK ("quantity" IS NULL OR "quantity" BETWEEN 1 AND 100000);
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_priority_check" CHECK ("priority" IN ('normal', 'high'));
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_work_status_check" CHECK ("work_status" IN ('todo', 'doing', 'done'));
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_post_status_check" CHECK ("post_status" IN ('unposted', 'scheduled', 'partial', 'posted'));
ALTER TABLE "assets" ADD CONSTRAINT "assets_size_check" CHECK ("size" > 0);
ALTER TABLE "assets" ADD CONSTRAINT "assets_kind_check" CHECK ("kind" IN ('image', 'video'));
ALTER TABLE "settings" ADD CONSTRAINT "settings_singleton_check" CHECK ("id" = 1);

-- Access goes through the authenticated Express API, never the publishable key.
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "jobs", "assets", "settings" FROM PUBLIC;
COMMIT;
