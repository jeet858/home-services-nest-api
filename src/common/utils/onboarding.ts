import type { PrismaService } from '../../prisma/prisma.service';

export type OnboardingStep = 'profile' | 'address' | 'complete';

// Derived from stored data (not a flag), so an interrupted signup resumes at the right step.
export async function getOnboardingStep(prisma: PrismaService, userId: string): Promise<OnboardingStep> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, _count: { select: { addresses: true } } },
  });

  if (!user?.name?.trim() || !user.email?.trim()) {
    return 'profile';
  }

  return user._count.addresses > 0 ? 'complete' : 'address';
}
