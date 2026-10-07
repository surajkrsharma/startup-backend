-- Dead letter queue for background jobs that spent every attempt.

-- CreateTable
CREATE TABLE "FailedJob" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT NOT NULL DEFAULT '',
    "attemptsMade" INTEGER NOT NULL DEFAULT 0,
    "replayCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lastErrorAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replayedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FailedJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FailedJob_queue_jobId_key" ON "FailedJob"("queue", "jobId");

-- CreateIndex
CREATE INDEX "FailedJob_status_createdAt_idx" ON "FailedJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FailedJob_queue_idx" ON "FailedJob"("queue");

-- CreateIndex
CREATE INDEX "FailedJob_jobName_idx" ON "FailedJob"("jobName");

-- FlashSaleItem.createdById carried onDelete SetNull against a NOT NULL column,
-- so deleting the creating admin could not actually null the reference out.

-- AlterTable
ALTER TABLE "FlashSaleItem" ALTER COLUMN "createdById" DROP DEFAULT;

-- AlterTable
ALTER TABLE "FlashSaleItem" ALTER COLUMN "createdById" DROP NOT NULL;