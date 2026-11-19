import { logger } from '../common/logger/logger';

// Push delivery is wired but off: it only runs once FCM_PROJECT_ID and FCM_ACCESS_TOKEN are set.
// The in-app inbox (Notification rows + polling) is the source of truth either way.
export class FcmSender {
  private get config() {
    const projectId = process.env.FCM_PROJECT_ID;
    const accessToken = process.env.FCM_ACCESS_TOKEN;
    return projectId && accessToken ? { projectId, accessToken } : null;
  }

  get enabled() {
    return this.config !== null;
  }

  async send(token: string | null | undefined, title: string, body: string, data: Record<string, string> = {}) {
    const config = this.config;
    if (!config || !token) return;
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.accessToken}` },
        body: JSON.stringify({ message: { token, notification: { title, body }, data } }),
      });
      if (!res.ok) logger.warn('FCM send failed', { status: res.status });
    } catch (error) {
      logger.warn('FCM send error', { error: (error as Error).message });
    }
  }
}
