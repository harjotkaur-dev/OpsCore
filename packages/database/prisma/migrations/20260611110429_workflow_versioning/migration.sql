/*
  Warnings:

  - You are about to drop the column `workflow_id` on the `executions` table. All the data in the column will be lost.
  - You are about to drop the column `trigger_event_type_id` on the `workflows` table. All the data in the column will be lost.
  - You are about to drop the column `version` on the `workflows` table. All the data in the column will be lost.
  - You are about to drop the `workflow_actions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `workflow_rules` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `workflow_version_id` to the `executions` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "executions" DROP CONSTRAINT "executions_workflow_id_fkey";

-- DropForeignKey
ALTER TABLE "workflow_actions" DROP CONSTRAINT "workflow_actions_workflow_id_fkey";

-- DropForeignKey
ALTER TABLE "workflow_rules" DROP CONSTRAINT "workflow_rules_workflow_id_fkey";

-- DropForeignKey
ALTER TABLE "workflows" DROP CONSTRAINT "workflows_trigger_event_type_id_fkey";

-- DropIndex
DROP INDEX "executions_organization_id_workflow_id_idx";

-- DropIndex
DROP INDEX "workflows_trigger_event_type_id_idx";

-- AlterTable
ALTER TABLE "executions" DROP COLUMN "workflow_id",
ADD COLUMN     "workflow_version_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "workflows" DROP COLUMN "trigger_event_type_id",
DROP COLUMN "version",
ADD COLUMN     "current_version_id" UUID,
ADD COLUMN     "deleted_at" TIMESTAMPTZ,
ALTER COLUMN "status" SET DEFAULT 'active';

-- DropTable
DROP TABLE "workflow_actions";

-- DropTable
DROP TABLE "workflow_rules";

-- CreateTable
CREATE TABLE "workflow_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workflow_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "definition" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_versions_workflow_id_idx" ON "workflow_versions"("workflow_id");

-- CreateIndex
CREATE INDEX "workflow_versions_organization_id_idx" ON "workflow_versions"("organization_id");

-- CreateIndex
CREATE INDEX "workflow_versions_organization_id_status_idx" ON "workflow_versions"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_versions_workflow_id_version_key" ON "workflow_versions"("workflow_id", "version");

-- CreateIndex
CREATE INDEX "executions_organization_id_workflow_version_id_idx" ON "executions"("organization_id", "workflow_version_id");

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "workflow_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executions" ADD CONSTRAINT "executions_workflow_version_id_fkey" FOREIGN KEY ("workflow_version_id") REFERENCES "workflow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
