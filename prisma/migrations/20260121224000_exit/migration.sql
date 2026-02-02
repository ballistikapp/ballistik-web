-- CreateEnum
CREATE TYPE "HoldingExitStatus" AS ENUM ('PENDING', 'RUNNING', 'FAILED', 'SUCCEEDED');

-- CreateEnum
CREATE TYPE "HoldingExitLogLevel" AS ENUM ('INFO', 'WARN', 'ERROR', 'STEP');

-- CreateTable
CREATE TABLE "HoldingExit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenPublicKey" TEXT NOT NULL,
    "status" "HoldingExitStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "input" JSONB NOT NULL,
    "result" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HoldingExit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HoldingExitLog" (
    "id" TEXT NOT NULL,
    "exitId" TEXT NOT NULL,
    "level" "HoldingExitLogLevel" NOT NULL,
    "message" TEXT NOT NULL,
    "step" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HoldingExitLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HoldingExit_userId_tokenPublicKey_status_idx" ON "HoldingExit"("userId", "tokenPublicKey", "status");

-- CreateIndex
CREATE INDEX "HoldingExitLog_exitId_createdAt_idx" ON "HoldingExitLog"("exitId", "createdAt");

-- AddForeignKey
ALTER TABLE "HoldingExit" ADD CONSTRAINT "HoldingExit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoldingExit" ADD CONSTRAINT "HoldingExit_tokenPublicKey_fkey" FOREIGN KEY ("tokenPublicKey") REFERENCES "Token"("publicKey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoldingExitLog" ADD CONSTRAINT "HoldingExitLog_exitId_fkey" FOREIGN KEY ("exitId") REFERENCES "HoldingExit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
