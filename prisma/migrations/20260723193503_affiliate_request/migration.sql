-- CreateEnum
CREATE TYPE "MarketerApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "MarketerApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "operatorNote" TEXT,
    "status" "MarketerApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketerApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketerApplication_status_createdAt_idx" ON "MarketerApplication"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketerApplication_userId_status_idx" ON "MarketerApplication"("userId", "status");

-- AddForeignKey
ALTER TABLE "MarketerApplication" ADD CONSTRAINT "MarketerApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
