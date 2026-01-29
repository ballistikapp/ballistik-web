-- CreateTable
CREATE TABLE "VolumeBotPreset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolumeBotPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VolumeBotPreset_userId_updatedAt_idx" ON "VolumeBotPreset"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VolumeBotPreset_userId_name_key" ON "VolumeBotPreset"("userId", "name");

-- AddForeignKey
ALTER TABLE "VolumeBotPreset" ADD CONSTRAINT "VolumeBotPreset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
