import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth/jwt';
import { prisma } from '@/lib/prisma';
import type { User } from '@/lib/generated/prisma/client';

export async function getServerUser(): Promise<User | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;

    if (!token) {
      return null;
    }

    const payload = verifyToken(token);
    if (!payload) {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        mainWallet: true,
      },
    });

    return user;
  } catch (error) {
    console.error('Error getting server user:', error);
    return null;
  }
}

export async function getServerUserFromCookies(cookieStore: Awaited<ReturnType<typeof cookies>>): Promise<User | null> {
  try {
    const token = cookieStore.get('auth-token')?.value;

    if (!token) {
      return null;
    }

    const payload = verifyToken(token);
    if (!payload) {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        mainWallet: true,
      },
    });

    return user;
  } catch (error) {
    console.error('Error getting server user from cookies:', error);
    return null;
  }
}

