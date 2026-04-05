import "server-only";
import { prisma } from "@/lib/prisma";
import { UserPlan } from "@/lib/generated/prisma/client";
import { AppError } from "@/server/errors";
import { usageFeeService } from "@/server/services/usage-fee.service";
import { withActionLock, withIdempotency } from "@/server/security/api-abuse";
import {
  WEEKLY_DEVELOPER_PRICE_SOL,
  WEEKLY_PRO_PRICE_SOL,
  WEEKLY_DURATION_DAYS,
  DEVELOPER_FEE_DISCOUNT_RATE,
} from "@/lib/config/subscription.config";

const HISTORY_LIMIT = 20;

type UserPlanWriter = Pick<typeof prisma, "user">;

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function isPaidPlanActive(
  paidPlanExpiresAt: Date | null | undefined,
  now = new Date()
) {
  return Boolean(
    paidPlanExpiresAt && paidPlanExpiresAt.getTime() > now.getTime()
  );
}

export function resolveEffectiveUserPlan(
  storedPlan: UserPlan,
  paidPlanExpiresAt: Date | null | undefined,
  now = new Date()
): UserPlan {
  if (storedPlan === UserPlan.FREE) return UserPlan.FREE;
  return isPaidPlanActive(paidPlanExpiresAt, now) ? storedPlan : UserPlan.FREE;
}

export function resolveSubscriptionStatus(
  storedPlan: UserPlan,
  paidPlanExpiresAt: Date | null | undefined,
  now = new Date()
) {
  if (isPaidPlanActive(paidPlanExpiresAt, now)) {
    return "ACTIVE" as const;
  }
  return paidPlanExpiresAt ? ("EXPIRED" as const) : ("FREE" as const);
}

export async function syncUserPlanState(
  writer: UserPlanWriter,
  userId: string,
  currentPlan: UserPlan,
  paidPlanExpiresAt: Date | null | undefined,
  now = new Date()
) {
  const effectivePlan = resolveEffectiveUserPlan(
    currentPlan,
    paidPlanExpiresAt,
    now
  );
  if (effectivePlan !== currentPlan) {
    await writer.user.update({
      where: { id: userId },
      data: { plan: effectivePlan },
    });
  }
  return effectivePlan;
}

function getPlanPrice(plan: UserPlan): number {
  if (plan === UserPlan.DEVELOPER) return WEEKLY_DEVELOPER_PRICE_SOL;
  if (plan === UserPlan.PRO) return WEEKLY_PRO_PRICE_SOL;
  return 0;
}

function getBillingReason(plan: UserPlan): string {
  if (plan === UserPlan.DEVELOPER) return "developer.weekly";
  return "pro.weekly";
}

function calculateUpgradeCredit(
  paidPlanExpiresAt: Date | null | undefined,
  now: Date
): number {
  if (!paidPlanExpiresAt) return 0;
  const remainingMs = paidPlanExpiresAt.getTime() - now.getTime();
  if (remainingMs <= 0) return 0;
  const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
  return (remainingDays / WEEKLY_DURATION_DAYS) * WEEKLY_DEVELOPER_PRICE_SOL;
}

export const subscriptionService = {
  async getSubscriptionOverview(userId: string, tokenPlan: UserPlan) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        plan: true,
        paidPlanStartedAt: true,
        paidPlanExpiresAt: true,
      },
    });

    if (!user) {
      throw new AppError("User not found", 404);
    }

    const now = new Date();
    const effectivePlan = resolveEffectiveUserPlan(
      user.plan,
      user.paidPlanExpiresAt,
      now
    );
    const status = resolveSubscriptionStatus(
      user.plan,
      user.paidPlanExpiresAt,
      now
    );

    const upgradeCredit =
      effectivePlan === UserPlan.DEVELOPER
        ? calculateUpgradeCredit(user.paidPlanExpiresAt, now)
        : 0;

    return {
      plan: effectivePlan,
      tokenPlan,
      status,
      paidPlanStartedAt: user.paidPlanStartedAt,
      paidPlanExpiresAt: user.paidPlanExpiresAt,
      developerPriceSol: WEEKLY_DEVELOPER_PRICE_SOL,
      proPriceSol: WEEKLY_PRO_PRICE_SOL,
      durationDays: WEEKLY_DURATION_DAYS,
      renewalAvailable: true,
      requiresTokenRefresh: tokenPlan !== effectivePlan,
      upgradeCredit:
        effectivePlan === UserPlan.DEVELOPER ? upgradeCredit : undefined,
      upgradeChargeSol:
        effectivePlan === UserPlan.DEVELOPER
          ? Math.max(0, WEEKLY_PRO_PRICE_SOL - upgradeCredit)
          : undefined,
    };
  },

  async listHistory(userId: string, limit = HISTORY_LIMIT) {
    return await prisma.subscriptionPayment.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, HISTORY_LIMIT),
    });
  },

  async purchaseSubscription(userId: string, targetPlan: UserPlan) {
    const actionKey = `billing:purchase-subscription:${userId}`;
    const idempotencyKey = `billing:purchase-subscription:${userId}`;

    return await withActionLock(actionKey, async () =>
      withIdempotency({
        key: idempotencyKey,
        ttlMs: 15_000,
        execute: async () => {
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
              id: true,
              plan: true,
              paidPlanStartedAt: true,
              paidPlanExpiresAt: true,
            },
          });

          if (!user) {
            throw new AppError("User not found", 404);
          }

          const now = new Date();
          const effectivePlan = resolveEffectiveUserPlan(
            user.plan,
            user.paidPlanExpiresAt,
            now
          );

          let chargeSol = getPlanPrice(targetPlan);
          let upgradeCredit = 0;

          const isUpgradeFromDeveloper =
            effectivePlan === UserPlan.DEVELOPER &&
            targetPlan === UserPlan.PRO;

          if (isUpgradeFromDeveloper) {
            upgradeCredit = calculateUpgradeCredit(
              user.paidPlanExpiresAt,
              now
            );
            chargeSol = Math.max(0, WEEKLY_PRO_PRICE_SOL - upgradeCredit);
          }

          if (
            effectivePlan === UserPlan.PRO &&
            targetPlan === UserPlan.DEVELOPER
          ) {
            throw new AppError(
              "Cannot downgrade from Pro to Developer while Pro is active",
              400
            );
          }

          const feeResult = await usageFeeService.collectFromMainWallet({
            userId,
            totalFeeSol: chargeSol,
            reason: getBillingReason(targetPlan),
          });

          const paymentSignature = feeResult.signature;
          if (feeResult.skipped || !paymentSignature) {
            throw new AppError("Failed to confirm subscription payment", 500);
          }

          const isRenewal =
            effectivePlan === targetPlan &&
            isPaidPlanActive(user.paidPlanExpiresAt, now);
          const startsAt =
            isRenewal && user.paidPlanExpiresAt
              ? user.paidPlanExpiresAt
              : now;
          const expiresAt = addDays(startsAt, WEEKLY_DURATION_DAYS);
          const paidPlanStartedAt =
            isRenewal && user.paidPlanStartedAt
              ? user.paidPlanStartedAt
              : now;

          const result = await prisma.$transaction(async (tx) => {
            const updatedUser = await tx.user.update({
              where: { id: user.id },
              data: {
                plan: targetPlan,
                paidPlanStartedAt,
                paidPlanExpiresAt: expiresAt,
              },
              select: {
                id: true,
                plan: true,
                paidPlanStartedAt: true,
                paidPlanExpiresAt: true,
              },
            });

            const payment = await tx.subscriptionPayment.create({
              data: {
                userId: user.id,
                plan: targetPlan,
                amountSol: chargeSol,
                txSignature: paymentSignature,
                startsAt,
                expiresAt,
              },
              select: {
                id: true,
                plan: true,
                amountSol: true,
                txSignature: true,
                startsAt: true,
                expiresAt: true,
                createdAt: true,
              },
            });

            return { updatedUser, payment };
          });

          return {
            plan: result.updatedUser.plan,
            paidPlanStartedAt: result.updatedUser.paidPlanStartedAt,
            paidPlanExpiresAt: result.updatedUser.paidPlanExpiresAt,
            payment: result.payment,
            fromPublicKey: feeResult.fromPublicKey,
            toPublicKey: feeResult.toPublicKey,
            upgradeCredit: isUpgradeFromDeveloper ? upgradeCredit : undefined,
          };
        },
      })
    );
  },
};
