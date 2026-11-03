-- CreateTable
CREATE TABLE "app_metadata" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "app_metadata_pkey" PRIMARY KEY ("key")
);
