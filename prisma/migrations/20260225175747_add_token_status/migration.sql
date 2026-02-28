-- CreateEnum
CREATE TYPE "TokenStatus" AS ENUM ('PENDING', 'ACTIVE', 'FAILED');

-- AlterTable
ALTER TABLE "Token" ADD COLUMN     "status" "TokenStatus" NOT NULL DEFAULT 'PENDING';
