import { prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/config/env";

const SHYFT_CALLBACK_API = "https://api.shyft.to/sol/v1/callback";

type CallbackType = "ACCOUNT" | "TRANSACTION";

type CreateCallbackInput = {
  type: CallbackType;
  address: string;
  callbackUrl: string;
  projectId?: string;
  events?: string[];
};

type ShyftCallbackResponse = {
  success: boolean;
  message: string;
  result?: {
    id: string;
    network: string;
    addresses: string[];
    callback_url: string;
    type: string;
    events?: string[];
  };
};

type ShyftListCallbackResponse = {
  success: boolean;
  message: string;
  result?: Array<{
    id: string;
    network: string;
    addresses: string[];
    callback_url: string;
    type: string;
    events?: string[];
  }>;
};

async function shyftFetch<T>(
  path: string,
  options: {
    method: string;
    body?: Record<string, unknown>;
  }
): Promise<T> {
  const { SHYFT_API_KEY } = getEnv();
  if (!SHYFT_API_KEY) {
    throw new Error("SHYFT_API_KEY is required for callback management");
  }

  const response = await fetch(`${SHYFT_CALLBACK_API}${path}`, {
    method: options.method,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": SHYFT_API_KEY,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Shyft API error (${response.status}): ${text}`
    );
  }

  return (await response.json()) as T;
}

export const shyftCallbackService = {
  async createAccountCallback(input: {
    address: string;
    callbackUrl: string;
    projectId?: string;
  }) {
    const result = await shyftFetch<ShyftCallbackResponse>("/create", {
      method: "POST",
      body: {
        network: "mainnet-beta",
        addresses: [input.address],
        callback_url: input.callbackUrl,
        type: "ACCOUNT",
        encoding: "PARSED",
      },
    });

    if (result.success && result.result) {
      await prisma.shyftCallback.create({
        data: {
          callbackId: result.result.id,
          type: "ACCOUNT",
          address: input.address,
          projectId: input.projectId,
        },
      });
    }

    return result;
  },

  async createTransactionCallback(input: {
    address: string;
    callbackUrl: string;
    projectId?: string;
    events?: string[];
  }) {
    const result = await shyftFetch<ShyftCallbackResponse>("/create", {
      method: "POST",
      body: {
        network: "mainnet-beta",
        addresses: [input.address],
        callback_url: input.callbackUrl,
        type: "TRANSACTION",
        events: input.events ?? ["SWAP", "TOKEN_TRANSFER", "SOL_TRANSFER"],
        encoding: "PARSED",
      },
    });

    if (result.success && result.result) {
      await prisma.shyftCallback.create({
        data: {
          callbackId: result.result.id,
          type: "TRANSACTION",
          address: input.address,
          projectId: input.projectId,
        },
      });
    }

    return result;
  },

  async removeCallback(callbackId: string) {
    await shyftFetch<{ success: boolean }>("/remove", {
      method: "DELETE",
      body: {
        id: callbackId,
      },
    });

    await prisma.shyftCallback.delete({
      where: { callbackId },
    }).catch(() => {
      // ignore if not found locally
    });
  },

  async removeCallbacksByAddress(address: string) {
    const callbacks = await prisma.shyftCallback.findMany({
      where: { address },
    });

    for (const callback of callbacks) {
      try {
        await this.removeCallback(callback.callbackId);
      } catch {
        // best-effort cleanup
      }
    }
  },

  async removeCallbacksByProject(projectId: string) {
    const callbacks = await prisma.shyftCallback.findMany({
      where: { projectId },
    });

    for (const callback of callbacks) {
      try {
        await this.removeCallback(callback.callbackId);
      } catch {
        // best-effort cleanup
      }
    }
  },

  async listCallbacks() {
    const result = await shyftFetch<ShyftListCallbackResponse>("/list", {
      method: "GET",
    });
    return result.result ?? [];
  },

  async listLocalCallbacks(options?: { projectId?: string; address?: string }) {
    return await prisma.shyftCallback.findMany({
      where: {
        ...(options?.projectId ? { projectId: options.projectId } : {}),
        ...(options?.address ? { address: options.address } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  },
};
