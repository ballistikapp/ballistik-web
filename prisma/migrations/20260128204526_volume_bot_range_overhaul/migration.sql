-- AlterEnum
ALTER TYPE "VolumeBotSessionStatus" ADD VALUE 'SCHEDULED';

-- AlterTable
ALTER TABLE "VolumeBotSession" ADD COLUMN     "scheduledStartAt" TIMESTAMP(3);
