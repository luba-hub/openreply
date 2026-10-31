-- es-funnel: additive only. A campaign may collect a lead; one open ask per person per account.
-- CreateEnum
CREATE TYPE "LeadState" AS ENUM ('ASKED', 'REASKED', 'SYNCED', 'DONE', 'STOPPED');

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "collectLead" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "state" "LeadState" NOT NULL DEFAULT 'ASKED',
    "askedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" TIMESTAMP(3),
    "blueprintSentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_automationId_idx" ON "Lead"("automationId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_instagramAccountId_igUserId_key" ON "Lead"("instagramAccountId", "igUserId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

