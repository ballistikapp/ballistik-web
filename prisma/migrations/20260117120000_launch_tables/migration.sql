CREATE TYPE "LaunchStatus" AS ENUM ('PENDING', 'RUNNING', 'CANCELED', 'FAILED', 'SUCCEEDED');

CREATE TYPE "LaunchLogLevel" AS ENUM ('INFO', 'WARN', 'ERROR', 'STEP');

CREATE TABLE "Launch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "LaunchStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "input" JSONB NOT NULL,
    "result" JSONB,
    "tokenPublicKey" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Launch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LaunchLog" (
    "id" TEXT NOT NULL,
    "launchId" TEXT NOT NULL,
    "level" "LaunchLogLevel" NOT NULL,
    "message" TEXT NOT NULL,
    "step" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LaunchLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VanityMint" (
    "id" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "reservedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "tokenPublicKey" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VanityMint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VanityMint_publicKey_key" ON "VanityMint"("publicKey");

CREATE UNIQUE INDEX "VanityMint_privateKey_key" ON "VanityMint"("privateKey");

ALTER TABLE "Launch" ADD CONSTRAINT "Launch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Launch" ADD CONSTRAINT "Launch_tokenPublicKey_fkey" FOREIGN KEY ("tokenPublicKey") REFERENCES "Token"("publicKey") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LaunchLog" ADD CONSTRAINT "LaunchLog_launchId_fkey" FOREIGN KEY ("launchId") REFERENCES "Launch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VanityMint" ADD CONSTRAINT "VanityMint_tokenPublicKey_fkey" FOREIGN KEY ("tokenPublicKey") REFERENCES "Token"("publicKey") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VanityMint" ADD CONSTRAINT "VanityMint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
