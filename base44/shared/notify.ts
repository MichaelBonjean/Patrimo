// Notification push — wrapper défensif autour de SendPushNotification.
// Échoue silencieusement (pas d'app mobile native, intégrations indisponibles…)
// sans jamais casser l'opération mère (ingestion / commit).

export async function sendPush(svc: any, userId: string, title: string, content: string, actionLabel?: string | null, actionUrl?: string | null) {
  try {
    const fn = svc?.integrations?.Core?.SendPushNotification;
    if (typeof fn !== 'function') return;
    await fn({
      user_id: userId,
      title,
      content,
      action_label: actionLabel || null,
      action_url: actionUrl || null,
    });
  } catch {
    /* best-effort : la push n'est jamais bloquante */
  }
}