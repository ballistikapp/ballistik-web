-- CreateTable
CREATE TABLE "LaunchPlannedMint" (
    "id" TEXT NOT NULL,
    "launchId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "vanityMintId" TEXT,
    "consumedAt" TIMESTAMP(3),
    "abandonedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaunchPlannedMint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LaunchPlannedMint_launchId_key" ON "LaunchPlannedMint"("launchId");

-- CreateIndex
CREATE INDEX "LaunchPlannedMint_vanityMintId_idx" ON "LaunchPlannedMint"("vanityMintId");

-- AddForeignKey
ALTER TABLE "LaunchPlannedMint" ADD CONSTRAINT "LaunchPlannedMint_launchId_fkey" FOREIGN KEY ("launchId") REFERENCES "Launch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchPlannedMint" ADD CONSTRAINT "LaunchPlannedMint_vanityMintId_fkey" FOREIGN KEY ("vanityMintId") REFERENCES "VanityMint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
