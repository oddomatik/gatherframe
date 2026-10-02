export interface LaunchInput {
  total: number;
  visible: number;
  published: boolean;
  expiresAt: string | null;
  scopedOnly: boolean;
  usableInvitations: number;
}
export function projectLaunch(input: LaunchInput, now = Date.now()) {
  const open = input.published && (!input.expiresAt || Date.parse(input.expiresAt) > now);
  const steps = [
    { key: 'upload', title: 'Upload your photos', done: input.total > 0,
      detail: input.total ? `${input.total} photos imported.` : 'Start with a small set of photographer-authored exports.', action: 'Upload photos', target: 'upload' },
    { key: 'prepare', title: 'Prepare photos for guests', done: input.visible > 0,
      detail: input.visible ? `${input.visible} photos have ready previews in active collections.` : 'Wait for previews, then file photos in a collection. Photos in To sort alone stay private.', action: 'Organize photos', target: 'photos' },
    { key: 'publish', title: 'Open the gallery', done: open,
      detail: open ? 'The project is published and has not closed.' : input.published ? 'The gallery closing time has passed. Review the closing time before sharing.' : 'Review layout and download choices, then publish when you are ready.', action: 'Review settings', target: 'settings' },
    { key: 'access', title: 'Choose how guests enter', done: !input.scopedOnly || input.usableInvitations > 0,
      detail: input.scopedOnly ? `${input.usableInvitations} active scoped invitations include ready photos. Broad project links are disabled.` : 'The broad project link is enabled. For private client delivery, use scoped invitations and disable broad access.', action: 'Review sharing', target: 'sharing' }
  ] as const;
  return { steps, completed: steps.filter(s => s.done).length, ready: steps.every(s => s.done) };
}
