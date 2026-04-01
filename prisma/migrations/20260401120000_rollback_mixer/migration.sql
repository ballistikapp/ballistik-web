ALTER TABLE "MixerOrder" DROP CONSTRAINT IF EXISTS "MixerOrder_mixerOperationId_fkey";
ALTER TABLE "MixerOperation" DROP CONSTRAINT IF EXISTS "MixerOperation_userId_fkey";
ALTER TABLE "MixerOperation" DROP CONSTRAINT IF EXISTS "MixerOperation_tokenPublicKey_fkey";

DROP TABLE IF EXISTS "MixerOrder";
DROP TABLE IF EXISTS "MixerOperation";

DROP TYPE IF EXISTS "MixerOrderStatus";
DROP TYPE IF EXISTS "MixerOperationStatus";
DROP TYPE IF EXISTS "MixerDirection";